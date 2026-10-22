import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enqueue, getJob, PermanentJobError, registerJob, retryDelayMs, runDueJobs } from "@/lib/jobs";
import { useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
beforeEach(() => {
  ctx = useTempDataDir();
});
afterEach(() => ctx.cleanup());

describe("job queue", () => {
  it("runs due jobs with their payload, oldest first, and marks them done", async () => {
    const seen: unknown[] = [];
    registerJob("test.record", async (payload) => {
      seen.push(payload);
    });
    const a = enqueue("test.record", { n: 1 });
    const b = enqueue("test.record", { n: 2 });
    expect(await runDueJobs()).toBe(2);
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
    expect(getJob(a.id)!.status).toBe("done");
    expect(getJob(b.id)!.attempts).toBe(1);
  });

  it("leaves jobs scheduled for later alone", async () => {
    registerJob("test.later", async () => undefined);
    const job = enqueue("test.later", null, { runAt: new Date(Date.now() + 60_000) });
    expect(await runDueJobs()).toBe(0);
    expect(await runDueJobs({ now: () => new Date(Date.now() + 61_000) })).toBe(1);
    expect(getJob(job.id)!.status).toBe("done");
  });

  it("retries failures with backoff, then gives up", async () => {
    let calls = 0;
    registerJob("test.flaky", async () => {
      calls++;
      throw new Error(`boom ${calls}`);
    });
    const job = enqueue("test.flaky", null, { maxAttempts: 2 });
    const t0 = Date.now();
    await runDueJobs({ now: () => new Date(t0) });
    let row = getJob(job.id)!;
    expect(row).toMatchObject({ status: "queued", attempts: 1, lastError: "boom 1" });
    expect(row.runAt.getTime()).toBe(t0 + retryDelayMs(1));

    // Not due yet.
    expect(await runDueJobs({ now: () => new Date(t0 + 1000) })).toBe(0);
    await runDueJobs({ now: () => new Date(t0 + retryDelayMs(1)) });
    row = getJob(job.id)!;
    expect(row).toMatchObject({ status: "failed", attempts: 2, lastError: "boom 2" });
  });

  it("does not retry a permanent error", async () => {
    registerJob("test.permanent", async () => {
      throw new PermanentJobError("bad input");
    });
    const job = enqueue("test.permanent", null, { maxAttempts: 5 });
    await runDueJobs();
    expect(getJob(job.id)).toMatchObject({ status: "failed", attempts: 1, lastError: "bad input" });
  });

  it("fails jobs nobody handles", async () => {
    const job = enqueue("test.unknown-type", null);
    await runDueJobs();
    expect(getJob(job.id)!.status).toBe("failed");
  });

  it("backs off 30 s, 2 min, 8 min … up to 6 h", () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(120_000);
    expect(retryDelayMs(3)).toBe(480_000);
    expect(retryDelayMs(20)).toBe(6 * 60 * 60 * 1000);
  });
});
