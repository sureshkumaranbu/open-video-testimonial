import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AiError, aiEnabled, aiForProject, aiJson, aiStatus, quotedFrom, setAiStub, trimForAi } from "@/lib/ai";
import { systemStatus } from "@/lib/system";
import { useTempDataDir } from "./helpers";

/**
 * The shared AI client (src/lib/ai.ts) against a stand-in OpenAI-compatible
 * provider on 127.0.0.1. Its users (case studies, insights, surveys, OCR and
 * the brand scan's fallback) have their own tests; these name the M17 IDs
 * that first need it.
 */

const ENV = ["AI_API_URL", "AI_API_KEY", "AI_MODEL"];
let ctx: ReturnType<typeof useTempDataDir>;
let server: http.Server | null = null;
let seen: { url: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }[];
/** What the stand-in answers next: a status and a body, or nothing at all (a hung provider). */
let answer: (() => { status?: number; headers?: Record<string, string>; body?: string } | null) | null;

const reply = (content: string) => () => ({ body: JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }) });

beforeEach(async () => {
  ctx = useTempDataDir();
  seen = [];
  answer = reply('{"ok": true}');
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      seen.push({ url: req.url ?? "", headers: req.headers, body: JSON.parse(raw || "{}") });
      const a = answer?.();
      if (!a) return; // never answers
      res.writeHead(a.status ?? 200, { "content-type": "application/json", ...a.headers }).end(a.body ?? "");
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
});
afterEach(async () => {
  for (const k of ENV) delete process.env[k];
  setAiStub(null);
  server?.closeAllConnections();
  if (server) await new Promise((r) => server!.close(r));
  server = null;
  ctx.cleanup();
});

function turnOn() {
  process.env.AI_API_URL = `http://127.0.0.1:${(server!.address() as AddressInfo).port}/v1/`;
  process.env.AI_API_KEY = "ai-key";
  process.env.AI_MODEL = "test-model";
}

const shape = z.object({ ok: z.boolean() });

describe("the shared AI client", () => {
  it("SHARE-04 AI is off unless AI_MODEL is set (the key is optional), and Settings → This server says which", async () => {
    expect(aiEnabled()).toBe(false);
    expect((await systemStatus()).ai).toEqual({ enabled: false, model: null, host: null });
    await expect(aiJson({ system: "s", user: "u", schema: shape })).rejects.toThrow(/AI_MODEL/);
    process.env.AI_API_KEY = "ai-key";
    expect(aiEnabled()).toBe(false);
    delete process.env.AI_API_KEY;
    process.env.AI_MODEL = "test-model";
    // A local model needs no key.
    expect(aiEnabled()).toBe(true);
    // OpenAI's address unless AI_API_URL says otherwise.
    expect(aiStatus()).toEqual({ enabled: true, model: "test-model", host: "api.openai.com" });
    // A project can keep its testimonials away from the provider.
    expect(aiForProject({ aiEnabled: true })).toBe(true);
    expect(aiForProject({ aiEnabled: false })).toBe(false);
    delete process.env.AI_MODEL;
    expect(aiForProject({ aiEnabled: true })).toBe(false);
    expect(seen).toHaveLength(0);
  });

  it("SHARE-04 asks for one JSON object with the owner's key and model, and checks the answer with zod", async () => {
    turnOn();
    answer = reply('```json\n{"ok": true, "extra": "dropped"}\n```');
    expect(await aiJson({ system: "You answer in JSON.", user: "Are you there?", schema: shape, maxTokens: 50 })).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("/v1/chat/completions");
    expect(seen[0].headers.authorization).toBe("Bearer ai-key");
    expect(seen[0].body).toEqual({
      model: "test-model",
      temperature: 0,
      max_tokens: 50,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You answer in JSON." },
        { role: "user", content: "Are you there?" },
      ],
    });
    expect((await systemStatus()).ai).toMatchObject({ enabled: true, model: "test-model", host: expect.stringMatching(/^127\.0\.0\.1:\d+$/) });
    // Without a key, no Authorization header at all.
    delete process.env.AI_API_KEY;
    await aiJson({ system: "s", user: "u", schema: shape });
    expect(seen[1].headers.authorization).toBeUndefined();
  });

  it("IMP-07 an image goes as a vision message (a data: URI), only PNG, JPEG or WebP, and size-capped", async () => {
    turnOn();
    const png = `data:image/png;base64,${Buffer.from("fake").toString("base64")}`;
    await aiJson({ system: "s", user: "Read this.", images: [png], schema: shape });
    expect((seen[0].body.messages as { content: unknown }[])[1].content).toEqual([
      { type: "text", text: "Read this." },
      { type: "image_url", image_url: { url: png } },
    ]);
    await expect(aiJson({ system: "s", user: "u", images: ["https://example.com/x.png"], schema: shape })).rejects.toThrow(/PNG, JPEG or WebP data only/);
    await expect(aiJson({ system: "s", user: "u", images: ["data:image/svg+xml;base64,AAAA"], schema: shape })).rejects.toThrow(/PNG, JPEG or WebP/);
    await expect(aiJson({ system: "s", user: "u", images: [`data:image/png;base64,${"A".repeat(7 * 1024 * 1024)}`], schema: shape })).rejects.toThrow(/too large/);
    expect(seen).toHaveLength(1);
  });

  it("SHARE-04 a failing, rambling, wrongly shaped, redirecting or oversized answer is an AiError", async () => {
    turnOn();
    const cases: [NonNullable<typeof answer>, RegExp][] = [
      [() => ({ status: 503, body: "overloaded" }), /answered 503/],
      [reply("Sure! Here you go: ok"), /wasn't JSON/],
      [reply('{"ok": "yes"}'), /expected shape/],
      [() => ({ status: 302, headers: { location: "http://169.254.169.254/" } }), /couldn't reach/],
      [() => ({ body: JSON.stringify({ choices: [{ message: { content: "x".repeat(2 * 1024 * 1024) } }] }) }), /too large/],
    ];
    for (const [a, message] of cases) {
      answer = a;
      const err = await aiJson({ system: "s", user: "u", schema: shape }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AiError);
      expect((err as Error).message).toMatch(message);
    }
  });

  it("VOC-01 the wait is capped, and so is what may be sent; text is trimmed before it goes", async () => {
    turnOn();
    answer = () => null;
    const started = Date.now();
    await expect(aiJson({ system: "s", user: "u", schema: shape, timeoutMs: 600 })).rejects.toBeInstanceOf(AiError);
    expect(Date.now() - started).toBeLessThan(5000);
    const before = seen.length;
    await expect(aiJson({ system: "s", user: "x".repeat(20_000), schema: shape })).rejects.toThrow(/over 16000 characters/);
    await expect(aiJson({ system: "s", user: "x".repeat(2000), schema: shape, maxInputChars: 1000 })).rejects.toThrow(/over 1000 characters/);
    expect(seen.length).toBe(before); // nothing sent
    expect(trimForAi("  a\u0000b \t\t c\n\n\n\nd  ", 100)).toBe("a b c\n\nd");
    expect(trimForAi("abcdef", 3)).toBe("abc");
    expect(quotedFrom("“Best tool, ever!”", "We think it's the best tool ever. Truly.")).toBe(true);
    expect(quotedFrom("Worst tool", "We think it's the best tool ever.")).toBe(false);
  });

  it("NPS-01 a test stub stands in for the provider and goes through the same checks", async () => {
    setAiStub((req) => (req.user === "bad" ? "not json" : { ok: true }));
    expect(aiEnabled()).toBe(true);
    expect(await aiJson({ system: "s", user: "good", schema: shape })).toEqual({ ok: true });
    await expect(aiJson({ system: "s", user: "bad", schema: shape })).rejects.toThrow(/wasn't JSON/);
    setAiStub(() => new Promise(() => {}));
    await expect(aiJson({ system: "s", user: "u", schema: shape, timeoutMs: 500 })).rejects.toThrow(/within 1 s/);
    expect(seen).toHaveLength(0);
  });
});
