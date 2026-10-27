import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as submitRoute } from "@/app/api/projects/[slug]/forms/[form]/submissions/route";
import { DELETE as deleteRoute, PUT as putRoute } from "@/app/api/admin/testimonials/[id]/translations/[lang]/route";
import { GET as listRoute, POST as machineRoute } from "@/app/api/admin/testimonials/[id]/translations/route";
import { GET as feedRoute } from "@/app/api/widget/[slug]/route";
import { getDb, schema } from "@/db";
import { createForm, updateForm } from "@/lib/forms";
import { formPagesSchema, parseFormRow } from "@/lib/forms/schema";
import { BulkError, bulkUpdate } from "@/lib/inbox";
import { runDueJobs } from "@/lib/jobs";
import { setHighlights } from "@/lib/highlights";
import { resetRateLimits } from "@/lib/rate-limit";
import { testimonialPage } from "@/lib/testimonial-page";
import { createProject, createTestimonial, updateTestimonial } from "@/lib/testimonials";
import { translateTexts, translationEnabled } from "@/lib/translate";
import { listTranslations, saveTranslation, visitorLang } from "@/lib/translations";
import { createWidget } from "@/lib/widgets";
import { registerJobs } from "@/lib/worker";
import { adminHeaders, formSubmission, params, submitFormRequest, useTempDataDir } from "./helpers";

let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;
let server: http.Server | null = null;
let seen: { url: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }[];

const ENV = ["TRANSLATE_PROVIDER", "TRANSLATE_API_URL", "TRANSLATE_API_KEY", "TRANSLATE_MODEL", "PLAUDIT_FEATURES"];

beforeEach(() => {
  ctx = useTempDataDir();
  registerJobs();
  resetRateLimits();
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  seen = [];
});
afterEach(async () => {
  for (const k of ENV) delete process.env[k];
  if (server) await new Promise((r) => server!.close(r));
  server = null;
  ctx.cleanup();
});

/** A stand-in provider on 127.0.0.1 that "translates" by prefixing the language, in the shape of each provider. */
async function provider(kind: "deepl" | "libretranslate" | "openai") {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      seen.push({ url: req.url ?? "", headers: req.headers, body });
      res.setHeader("content-type", "application/json");
      if (kind === "deepl") res.end(JSON.stringify({ translations: (body.text as string[]).map((t) => ({ text: `[${body.target_lang}] ${t}` })) }));
      else if (kind === "libretranslate") res.end(JSON.stringify({ translatedText: (body.q as string[]).map((t) => `[${body.target}] ${t}`) }));
      else {
        const texts = JSON.parse(body.messages[1].content) as string[];
        res.end(JSON.stringify({ choices: [{ message: { content: "```json\n" + JSON.stringify(texts.map((t) => `[oa] ${t}`)) + "\n```" } }] }));
      }
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  process.env.TRANSLATE_PROVIDER = kind;
  process.env.TRANSLATE_API_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}${kind === "openai" ? "/v1" : ""}`;
  process.env.TRANSLATE_API_KEY = "tr-key";
  if (kind === "openai") process.env.TRANSLATE_MODEL = "test-model";
}

const json = (body: unknown, method = "PUT") => ({ method, headers: { ...adminHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
const approved = (o: Parameters<typeof createTestimonial>[1] = { name: "Ada", text: "Great product", headline: "Love it" }) => {
  const id = createTestimonial(projectId, o).id;
  updateTestimonial(id, { status: "approved" }, { quiet: true });
  return id;
};

describe("INBOX-13 translations by hand", () => {
  it("INBOX-13 adds, edits and removes a translation per language, with history, and checks the code", async () => {
    const id = approved();
    const url = (lang: string) => `http://localhost/api/admin/testimonials/${id}/translations/${lang}`;
    const put = await putRoute(new Request(url("FR"), json({ headline: "J’adore", text: "Super produit" })), params({ id, lang: "FR" }));
    expect(put.status).toBe(200);
    expect((await put.json()).translation).toMatchObject({ lang: "fr", headline: "J’adore", text: "Super produit", machine: false });
    await putRoute(new Request(url("fr"), json({ text: "Très bon produit" })), params({ id, lang: "fr" }));
    expect(listTranslations(id).map((t) => [t.lang, t.text])).toEqual([["fr", "Très bon produit"]]);
    expect((await putRoute(new Request(url("french!"), json({ text: "x" })), params({ id, lang: "french!" }))).status).toBe(400);
    expect((await putRoute(new Request(url("de"), json({ text: "" })), params({ id, lang: "de" }))).status).toBe(400);
    const listed = await (await listRoute(new Request(`http://localhost/x`, { headers: adminHeaders() }), params({ id }))).json();
    expect(listed).toMatchObject({ provider: null, translations: [{ lang: "fr" }] });
    expect((await deleteRoute(new Request(url("fr"), { method: "DELETE", headers: adminHeaders() }), params({ id, lang: "fr" }))).status).toBe(204);
    expect((await deleteRoute(new Request(url("fr"), { method: "DELETE", headers: adminHeaders() }), params({ id, lang: "fr" }))).status).toBe(404);
    const history = getDb().select().from(schema.testimonialHistory).all().filter((h) => h.action === "translation");
    expect(history).toHaveLength(3);
    expect((await putRoute(new Request(url("fr"), json({ text: "x" })), params({ id: "nope", lang: "fr" }))).status).toBe(404);
  });

  it("INBOX-13 without a provider nothing is sent anywhere and machine translation says how to set it up", async () => {
    const id = approved();
    expect(translationEnabled()).toBe(false);
    process.env.TRANSLATE_PROVIDER = "openai";
    expect(translationEnabled()).toBe(false); // no model yet
    delete process.env.TRANSLATE_PROVIDER;
    const res = await machineRoute(new Request("http://localhost/x", json({ lang: "fr" }, "POST")), params({ id }));
    expect(res.status).toBe(409);
    expect(visitorLang("fr_CA")).toBe("fr-ca");
    expect(visitorLang("<script>")).toBeNull();
  });
});

describe("INBOX-13 machine translation with the owner's provider", () => {
  it("INBOX-13 DeepL: the key in its header, its target codes, both fields in one call", async () => {
    await provider("deepl");
    const id = approved();
    const res = await machineRoute(new Request("http://localhost/x", json({ lang: "de" }, "POST")), params({ id }));
    expect(res.status).toBe(201);
    expect((await res.json()).translation).toMatchObject({ lang: "de", headline: "[DE] Love it", text: "[DE] Great product", machine: true });
    expect(seen[0]).toMatchObject({ url: "/v2/translate", body: { text: ["Love it", "Great product"], target_lang: "DE" } });
    expect(seen[0].headers.authorization).toBe("DeepL-Auth-Key tr-key");
    expect(await translateTexts(["", "Hi"], "en")).toEqual(["", "[EN-GB] Hi"]);
  });

  it("INBOX-13 LibreTranslate and an OpenAI-compatible endpoint", async () => {
    await provider("libretranslate");
    expect(await translateTexts(["Hello"], "pt-br")).toEqual(["[pt] Hello"]);
    expect(seen[0].body).toMatchObject({ q: ["Hello"], source: "auto", target: "pt", api_key: "tr-key" });
    await new Promise((r) => server!.close(r));
    await provider("openai");
    expect(await translateTexts(["Hello", "World"], "fr")).toEqual(["[oa] Hello", "[oa] World"]);
    expect(seen.at(-1)!.url).toBe("/v1/chat/completions");
    expect(seen.at(-1)!.body.model).toBe("test-model");
    expect(seen.at(-1)!.headers.authorization).toBe("Bearer tr-key");
  });

  it("INBOX-13 a form's auto-translate languages translate each new submission, skipping its own language", async () => {
    await provider("libretranslate");
    const form = createForm(projectId, { name: "Shop", slug: "shop" });
    const cfg = parseFormRow(form);
    updateForm(form.id, {
      pages: formPagesSchema.parse([{ type: "question", key: "q1", primary: true, title: "What changed?", mode: "text" }, { type: "consent" }, { type: "about_you" }, { type: "thank_you" }]),
      settings: { ...cfg.settings, autoTranslate: ["fr", "en"] },
      language: "en",
    });
    const res = await submitRoute(
      submitFormRequest("acme", "shop", formSubmission({ answers: [{ key: "q1", text: "We ship faster." }], person: { name: "Ada" }, consent: { agreed: true } })),
      params({ slug: "acme", form: "shop" }),
    );
    expect(res.status).toBe(201);
    const { id } = await res.json();
    for (let i = 0; i < 10; i++) if ((await runDueJobs()) === 0) break;
    expect(listTranslations(id).map((t) => [t.lang, t.text, t.machine])).toEqual([["fr", "[fr] We ship faster.", true]]);
  });

  it("INBOX-13 bulk Translate queues one job per testimonial and keeps translations written by hand", async () => {
    const a = approved();
    const b = approved({ name: "Bo", text: "Nice" });
    await expect(bulkUpdate(projectId, [a, b], "translate", { langs: ["fr"] })).rejects.toBeInstanceOf(BulkError);
    await provider("libretranslate");
    saveTranslation(a, "fr", { headline: null, text: "Écrit à la main" });
    const result = await bulkUpdate(projectId, [a, b, "nope"], "translate", { langs: ["fr"] });
    expect(result.updated).toEqual([a, b]);
    expect(result.skipped.map((s) => s.id)).toEqual(["nope"]);
    for (let i = 0; i < 10; i++) if ((await runDueJobs()) === 0) break;
    expect(listTranslations(a)[0]).toMatchObject({ text: "Écrit à la main", machine: false });
    expect(listTranslations(b)[0]).toMatchObject({ text: "[fr] Nice", machine: true });
  });
});

describe("INBOX-13 widgets by visitor language", () => {
  it("INBOX-13 a widget set to the visitor's language shows the stored translation of public rows only, without calling the provider", async () => {
    await provider("libretranslate");
    const a = approved({ name: "Ada", text: "Great product", headline: "Love it" });
    setHighlights(a, [{ answerId: null, start: 0, end: 5 }]);
    saveTranslation(a, "fr", { headline: "J’adore", text: "Super produit" });
    const pending = createTestimonial(projectId, { name: "Pending", text: "Not yet" }).id;
    saveTranslation(pending, "fr", { headline: null, text: "Pas encore" });
    const on = createWidget(projectId, { name: "Translated", layout: "grid", config: { design: { translations: "visitor" } } });
    const off = createWidget(projectId, { name: "Plain", layout: "grid" });
    const feed = async (id: string, l?: string) => (await feedRoute(new Request(`http://localhost/api/widget/${id}${l ? `?l=${l}` : ""}`), params({ slug: id }))).json();

    const fr = await feed(on.id, "fr-FR");
    expect(fr.testimonials.map((t: { text: string }) => t.text)).toEqual(["Super produit"]);
    expect(fr.testimonials[0].extra).toMatchObject({ headline: "J’adore", highlights: [] });
    expect("translations" in fr.widget.design).toBe(false);
    expect((await feed(on.id, "de")).testimonials[0].text).toBe("Great product");
    expect((await feed(on.id)).testimonials[0].extra.highlights).toEqual([{ start: 0, end: 5 }]);
    expect((await feed(off.id, "fr")).testimonials[0].text).toBe("Great product");
    expect(JSON.stringify(fr)).not.toContain("Pas encore");
    expect(seen).toHaveLength(0);
  });

  it("INBOX-13 a testimonial's own page takes ?lang= the same way", () => {
    const a = approved({ name: "Ada", text: "Great product", language: "en" });
    saveTranslation(a, "fr", { headline: null, text: "Super produit" });
    expect(testimonialPage(a, { lang: "fr" })!.item.text).toBe("Super produit");
    expect(testimonialPage(a, { lang: "en" })!.item.text).toBe("Great product");
    expect(testimonialPage(a)!.item.text).toBe("Great product");
  });
});
