import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, schema } from "@/db";
import { POST as ocrRoute } from "@/app/api/admin/projects/[id]/ocr/route";
import { POST as manualRoute } from "@/app/api/admin/projects/[id]/testimonials/manual/route";
import { POST as teamInvite } from "@/app/api/admin/team/route";
import { setAiStub, type AiRequest } from "@/lib/ai";
import { createSessionToken, sessionCookieName } from "@/lib/auth";
import { findDate, MAX_OCR_BYTES, ocrForProject, ocrStatus, parseOcrText, readScreenshot } from "@/lib/ocr";
import { systemStatus } from "@/lib/system";
import { createProject, getProjectById } from "@/lib/testimonials";
import { ADMIN_EMAIL, adminHeaders, params, PNG_BYTES, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

const FAKE_TESSERACT = path.resolve(__dirname, "../e2e/fixtures/fake-tesseract.mjs");
const png = (extra = 64) => Buffer.concat([Buffer.from(PNG_BYTES), Buffer.alloc(extra)]);
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00", "latin1");

beforeEach(() => {
  ctx = useTempDataDir();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
});
afterEach(() => {
  setAiStub(null);
  for (const k of ["OCR_PROVIDER", "OCR_COMMAND", "PLAUDIT_FEATURES"]) delete process.env[k];
  ctx.cleanup();
});

const useCommand = () => {
  process.env.OCR_PROVIDER = "command";
  process.env.OCR_COMMAND = `"${process.execPath}" "${FAKE_TESSERACT}" {input}`;
};

function ocrRequest(file: Blob | null, email?: string) {
  const form = new FormData();
  if (file) form.set("image", file, "shot.png");
  const headers: Record<string, string> = { "sec-fetch-site": "same-origin" };
  headers.cookie = !email || email === ADMIN_EMAIL ? adminHeaders().cookie : `${sessionCookieName()}=${createSessionToken(email)}`;
  return new Request(`http://localhost/api/admin/projects/${projectId}/ocr`, { method: "POST", headers, body: form });
}

describe("IMP-07 reading a screenshot", () => {
  it("IMP-07 splits plain OCR text into the quote, the name and the date, without the stars and buttons", () => {
    expect(parseOcrText("Jamie Rivera\n★★★★★\nPosted on May 3, 2026\nGreat service.\nWould buy again!\nHelpful\nReply")).toEqual({
      text: "Great service. Would buy again!",
      name: "Jamie Rivera",
      date: "2026-05-03",
    });
    // "— Name, Company" at the end, and a day-month date.
    expect(parseOcrText("“It changed how we hire.”\n— Priya Shah, Contoso\n12 March 2025")).toEqual({ text: "It changed how we hire.", name: "Priya Shah", date: "2025-03-12" });
    // No name or date to be found: just the words.
    expect(parseOcrText("this is great\nreally")).toEqual({ text: "this is great really", name: null, date: null });
    expect(findDate("2026-02-30")).toBeNull();
    expect(findDate("on 01/02/2026")).toBeNull();
    expect(findDate("Sept 9th, 2024")).toBe("2024-09-09");
  });

  it("IMP-07 is off unless OCR_PROVIDER is set, and Settings → This server says so", async () => {
    expect(ocrStatus()).toEqual({ enabled: false, provider: "off", problem: null });
    expect((await systemStatus()).ocr.enabled).toBe(false);
    await expect(readScreenshot(getProjectById(projectId)!, png())).rejects.toMatchObject({ status: 503 });
    process.env.OCR_PROVIDER = "command";
    expect(ocrStatus()).toMatchObject({ enabled: false, problem: "OCR_COMMAND isn't set" });
    process.env.OCR_PROVIDER = "ai";
    expect(ocrStatus()).toMatchObject({ enabled: false, problem: "OCR_PROVIDER=ai needs AI_MODEL" });
    expect((await ocrRoute(ocrRequest(new Blob([png()])), params({ id: projectId }))).status).toBe(503);
  });

  it("IMP-07 OCR_PROVIDER=command runs the program on the image (no shell) and reads what it prints", async () => {
    useCommand();
    expect(ocrStatus()).toEqual({ enabled: true, provider: "command", problem: null });
    const read = await readScreenshot(getProjectById(projectId)!, png());
    expect(read).toEqual({
      provider: "command",
      name: "Jamie Rivera",
      date: "2026-05-03",
      text: "Collecting reviews used to take us a week of emails. Now our customers reply in minutes and we share the best ones the same day.",
    });
    // A failing program is a 502 with its message.
    process.env.OCR_COMMAND = `"${process.execPath}" -e "process.stderr.write('no model'); process.exit(3)" {input}`;
    await expect(readScreenshot(getProjectById(projectId)!, png())).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/no model/) });
  });

  it("IMP-07 only PNG, JPEG and WebP up to 4 MB are read", async () => {
    useCommand();
    const project = getProjectById(projectId)!;
    await expect(readScreenshot(project, GIF)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/PNG, JPEG or WebP/) });
    await expect(readScreenshot(project, Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).rejects.toMatchObject({ status: 400 });
    await expect(readScreenshot(project, Buffer.alloc(0))).rejects.toMatchObject({ status: 400 });
    await expect(readScreenshot(project, png(MAX_OCR_BYTES))).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/4 MB/) });
    expect((await ocrRoute(ocrRequest(new Blob([png(MAX_OCR_BYTES + 128 * 1024)])), params({ id: projectId }))).status).toBe(413);
    expect((await ocrRoute(ocrRequest(null), params({ id: projectId }))).status).toBe(400);
  });

  it("IMP-07 OCR_PROVIDER=ai sends the image as a data URI to the AI client, and a project with AI off isn't read", async () => {
    process.env.OCR_PROVIDER = "ai";
    const sent: AiRequest[] = [];
    setAiStub((r) => {
      sent.push(r);
      return { text: "Five stars, would recommend.", name: "Sam Lee", date: "2026-04-01" };
    });
    const read = await readScreenshot(getProjectById(projectId)!, png());
    expect(read).toEqual({ provider: "ai", text: "Five stars, would recommend.", name: "Sam Lee", date: "2026-04-01" });
    expect(sent[0].images).toEqual([`data:image/png;base64,${png().toString("base64")}`]);
    // A date that isn't one is dropped; the rest is kept.
    setAiStub((r) => {
      sent.push(r);
      return { text: "Nice.", name: null, date: "2026-13-45" };
    });
    expect(await readScreenshot(getProjectById(projectId)!, png())).toMatchObject({ text: "Nice.", date: null });
    getDb().update(schema.projects).set({ aiEnabled: false }).where(eq(schema.projects.id, projectId)).run();
    expect(ocrForProject(getProjectById(projectId)!)).toBe(false);
    await expect(readScreenshot(getProjectById(projectId)!, png())).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/AI is turned off/) });
    // The project with AI off reached no provider at all.
    expect(sent).toHaveLength(2);
  });

  it("IMP-07 only editors may read a screenshot; what they then add keeps the image as its screenshot", async () => {
    useCommand();
    const res = await ocrRoute(ocrRequest(new Blob([png()], { type: "image/png" })), params({ id: projectId }));
    expect(res.status).toBe(200);
    const { read } = await res.json();
    expect(read).toMatchObject({ name: "Jamie Rivera", date: "2026-05-03" });

    process.env.PLAUDIT_FEATURES = "all";
    const invite = await teamInvite(new Request("http://localhost/api/admin/team", { method: "POST", headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify({ email: "vera@team.example", role: "viewer", projectIds: null }) }));
    expect(invite.status).toBe(201);
    expect((await ocrRoute(ocrRequest(new Blob([png()]), "vera@team.example"), params({ id: projectId }))).status).toBe(403);

    // The owner checks the fields, then adds it with the screenshot attached.
    const form = new FormData();
    form.set("payload", JSON.stringify({ kind: "image", name: read.name, text: read.text, sourceDate: read.date }));
    form.append("images", new File([png()], "shot.png", { type: "image/png" }));
    const added = await manualRoute(new Request(`http://localhost/x`, { method: "POST", headers: adminHeaders(), body: form }), params({ id: projectId }));
    expect(added.status).toBe(201);
    const { testimonial } = await added.json();
    expect(testimonial).toMatchObject({ authorName: "Jamie Rivera", text: read.text });
    const images = getDb().select().from(schema.testimonialImages).where(eq(schema.testimonialImages.testimonialId, testimonial.id)).all();
    expect(images).toHaveLength(1);
    expect(images[0].questionKey).toBeNull();
  });
});
