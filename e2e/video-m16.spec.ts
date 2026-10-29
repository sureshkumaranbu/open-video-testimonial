import fs from "node:fs";
import path from "node:path";
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { formProject } from "./form-helpers";
import { adminApi, createProject, FIXTURES, freshIp, seed, signIn, skipLinuxWebkitMedia, useFreshIp } from "./helpers";

/**
 * M16 video, part 2: a multiclip of a submission's answers (VID-05), an HLS
 * copy that follows the MP4's privacy (VID-06), a social clip (VID-07), a
 * highlight reel built by selecting transcript words (VID-08), and the
 * owner's own welcome video on a form (FORM-17).
 */

const RUN = Date.now().toString(36);
const RENDER_MS = 120_000;
const SAMPLE = fs.readFileSync(path.join(FIXTURES, "sample.webm"));
// Conversion, transcription and a render can each take a while on a busy machine: the 60 s default is too tight.
test.describe.configure({ timeout: RENDER_MS * 2 });

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

type Row = { mediaStatus: string; transcriptStatus: string; hlsKey: string | null; videoKey: string | null };
const detail = async (api: APIRequestContext, id: string) => (await (await api.get(`/api/admin/testimonials/${id}/detail`)).json()).testimonial as Row;

/** Skips unless the server has ffmpeg and, where asked, transcription or HLS (a plain container has neither). */
async function needFfmpeg(api: APIRequestContext, needs: { transcription?: boolean; hls?: boolean } = {}) {
  const system = await (await api.get("/api/admin/system")).json();
  test.skip(!system.ffmpeg, "ffmpeg isn't installed on this server");
  test.skip(Boolean(needs.transcription) && !system.transcription?.enabled, "transcription isn't set up on this server");
  test.skip(Boolean(needs.hls) && !system.hls, "VIDEO_HLS is off on this server");
}

/** A converted, approved video testimonial with its transcript made (the suite's stand-in transcriber). */
async function readyVideo(api: APIRequestContext, slug: string, name: string) {
  const [id] = await seed(api, slug, [{ name, video: true, status: "approved" }]);
  await expect.poll(async () => (await detail(api, id)).mediaStatus, { timeout: 60_000 }).toBe("ready");
  await expect.poll(async () => (await detail(api, id)).transcriptStatus, { timeout: 60_000 }).toBe("ready");
  return id;
}

/** Uploads the sample through the public resumable endpoint, as the form's recorder does. */
async function publicUpload(api: APIRequestContext, slug: string) {
  const made = await api.post(`/api/projects/${slug}/uploads`, { data: { size: SAMPLE.byteLength }, headers: { "x-forwarded-for": freshIp() } });
  expect(made.status(), await made.text()).toBe(201);
  const { id, token } = await made.json();
  const put = await api.put(`/api/uploads/${id}?offset=0`, { data: SAMPLE, headers: { "x-upload-token": token, "content-type": "application/octet-stream" } });
  expect(put.ok(), await put.text()).toBe(true);
  return { id, token };
}

test("VID-05 the owner makes a multiclip of a submission's video answers in the drawer and downloads it", async ({ page, baseURL, browserName }) => {
  skipLinuxWebkitMedia(browserName);
  const api = await adminApi(baseURL!);
  await needFfmpeg(api);
  const { project } = await formProject(api, "Multiclip Co", {
    pages: [
      { type: "question", key: "q1", primary: true, title: "What changed for you?", mode: "video" },
      { type: "question", key: "q2", title: "Who would you recommend us to?", mode: "video" },
      { type: "consent" },
      { type: "about_you" },
      { type: "thank_you" },
    ],
  });
  const a = await publicUpload(api, project.slug);
  const b = await publicUpload(api, project.slug);
  const payload = {
    answers: [
      { key: "q1", videoUpload: a.id, videoUploadToken: a.token },
      { key: "q2", videoUpload: b.id, videoUploadToken: b.token },
    ],
    person: { name: "Mia Multi" },
    consent: { agreed: true },
  };
  const sent = await api.post(`/api/projects/${project.slug}/forms/stories/submissions`, { multipart: { payload: JSON.stringify(payload) }, headers: { "x-forwarded-for": freshIp() } });
  expect(sent.status(), await sent.text()).toBe(201);
  const { id } = await sent.json();
  await expect.poll(async () => (await detail(api, id)).mediaStatus, { timeout: 60_000 }).toBe("ready");

  await signIn(page);
  await page.goto(`/admin/projects/${project.id}?open=${id}`);
  const studio = page.getByTestId("video-studio");
  await expect(studio.getByTestId("multiclip")).toContainText("Joins all 2 video answers");
  await studio.getByTestId("multiclip-make").click();
  const render = studio.getByTestId("multiclip-render");
  await expect(render).toHaveAttribute("data-status", "ready", { timeout: RENDER_MS });
  await expect(render.locator("video")).toHaveAttribute("src", /\/api\/media\/videos\/.+\.mp4$/);
  const [download] = await Promise.all([page.waitForEvent("download"), render.getByTestId("multiclip-download").click()]);
  expect(download.suggestedFilename()).toBe("mia-multi-multiclip.mp4");
  const file = await download.path();
  expect(fs.statSync(file!).size).toBeGreaterThan(10_000);
  expect(fs.readFileSync(file!).subarray(4, 8).toString("ascii")).toBe("ftyp");
});

test("VID-07 the owner renders a square social clip in a chosen look and downloads it", async ({ page, baseURL, browserName }) => {
  skipLinuxWebkitMedia(browserName);
  const api = await adminApi(baseURL!);
  await needFfmpeg(api, { transcription: true });
  const p = await createProject(api, `Social ${RUN}`, `social-${RUN}`);
  const id = await readyVideo(api, p.slug, "Sam Social");
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}?open=${id}`);
  const studio = page.getByTestId("video-studio");
  const clip = studio.getByTestId("social-clip");
  await clip.getByTestId("social-format").selectOption("square");
  await clip.getByTestId("social-look-bold").check();
  await expect(clip).toContainText("Big captions a few words at a time");
  await clip.getByTestId("social-make").click();
  const render = studio.getByTestId("social-render").first();
  await expect(render).toHaveAttribute("data-status", "ready", { timeout: RENDER_MS });
  await expect(render).toContainText("Bold, square");
  await expect(render).toContainText("1080×1080");
  const [download] = await Promise.all([page.waitForEvent("download"), render.getByTestId("social-download").click()]);
  expect(download.suggestedFilename()).toBe("sam-social-square-clip.mp4");
  expect(fs.statSync((await download.path())!).size).toBeGreaterThan(10_000);
});

test("VID-08 the owner builds a highlight reel by selecting transcript words, renders it with music and downloads it", async ({ page, baseURL, browserName }) => {
  skipLinuxWebkitMedia(browserName);
  const api = await adminApi(baseURL!);
  await needFfmpeg(api, { transcription: true });
  const p = await createProject(api, `Reel ${RUN}`, `reel-${RUN}`);
  await readyVideo(api, p.slug, "Rita Reel");
  await readyVideo(api, p.slug, "Rob Reel");
  await signIn(page);
  await page.goto(`/admin/projects/${p.id}/reels`);
  await page.getByTestId("reel-new-name").fill("Spring launch");
  await page.getByTestId("reel-create").click();
  const editor = page.getByTestId("reel-editor");
  await expect(editor.getByTestId("reel-name")).toHaveValue("Spring launch");
  await editor.getByTestId("reel-format").selectOption("vertical");
  await editor.getByTestId("reel-title").fill("What our customers say");
  await editor.getByTestId("reel-closing").fill("Try it today");

  // Rita: select "a stand-in transcript." in her captions, then use those words.
  const picker = editor.getByTestId("clip-picker");
  await picker.getByTestId("clip-testimonial").selectOption({ label: "Rita Reel" });
  const words = picker.getByTestId("clip-words");
  await expect(words).toContainText("This is a stand-in transcript.");
  await words.evaluate((box) => {
    const spans = [...box.querySelectorAll("[data-w]")];
    const from = spans.find((s) => s.textContent?.startsWith("a "))!;
    const to = spans.find((s) => s.textContent?.startsWith("transcript."))!;
    const range = document.createRange();
    range.setStart(from.firstChild!, 0);
    range.setEnd(to.firstChild!, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await picker.getByTestId("clip-use-selection").click();
  // The stand-in's first cue runs 0–1.5 s; "a stand-in transcript." is its second half.
  const range = await picker.getByTestId("clip-range").textContent();
  expect(range).not.toBe("0:00.0 – 0:03.0");
  expect(range).toMatch(/^0:00\.\d – 0:01\.5$/);
  // A clip runs at least a second: widen it by its times, as the owner can.
  await picker.getByLabel("From").fill("0.3");
  await picker.getByTestId("clip-add").click();
  // Rob: by times.
  await picker.getByTestId("clip-testimonial").selectOption({ label: "Rob Reel" });
  await picker.getByLabel("From").fill("1");
  await picker.getByLabel("To").fill("3");
  await picker.getByTestId("clip-add").click();
  await expect(editor.getByTestId("reel-clip")).toHaveCount(2);
  await expect(editor.getByTestId("reel-clip").first()).toContainText("Rita Reel");
  // 3 s card + 1.2 s + 2 s + 3 s card.
  await expect(editor.getByTestId("reel-length")).toContainText("0:09.2 in all");

  await editor.getByTestId("reel-render").click();
  const row = editor.getByTestId("reel-render-row").first();
  await expect(row).toHaveAttribute("data-status", "ready", { timeout: RENDER_MS });
  await expect(row).toContainText("1080×1920");
  const [download] = await Promise.all([page.waitForEvent("download"), row.getByTestId("reel-download").click()]);
  expect(download.suggestedFilename()).toBe("spring-launch-reel.mp4");
  expect(fs.statSync((await download.path())!).size).toBeGreaterThan(20_000);

  // Saved with the project: it's there after a reload, and can be rendered again.
  await page.reload();
  await expect(page.getByTestId("reel-editor").getByTestId("reel-clip")).toHaveCount(2);
  await expect(page.getByTestId("reel-editor").getByTestId("reel-render")).toBeEnabled();
});

test("FORM-17 the owner adds a welcome video in the builder; it plays on the live form with captions", async ({ page, baseURL, browserName }) => {
  skipLinuxWebkitMedia(browserName);
  const api = await adminApi(baseURL!);
  await needFfmpeg(api, { transcription: true });
  const { project, form, url } = await formProject(api, "Welcome Video Co", {
    pages: [
      { type: "welcome", enabled: true, title: "Hello from the team" },
      { type: "question", key: "q1", primary: true, title: "What changed?", mode: "text" },
      { type: "consent" },
      { type: "about_you" },
      { type: "thank_you" },
    ],
  });
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/forms/${form.id}`);
  await page.locator(".fb-page-pick", { hasText: "Welcome" }).click();
  const panel = page.getByTestId("owner-video-welcome");
  await panel.getByTestId("owner-video-add").click();
  await panel.getByTestId("video-file").setInputFiles(path.join(FIXTURES, "sample.webm"));
  await panel.getByTestId("owner-video-save").click();
  await expect(panel).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await expect(panel.getByTestId("owner-video-state")).toContainText("Captions are on.", { timeout: 60_000 });
  // The builder's preview shows it too.
  await expect(page.getByTestId("form-preview").getByTestId("owner-video")).toBeVisible();

  // On the public form, signed out.
  const visitor = await page.context().browser()!.newContext();
  const pub = await visitor.newPage();
  await pub.goto(`${baseURL}${url}`);
  const video = pub.getByTestId("owner-video").locator("video");
  await expect(video).toBeVisible();
  await expect(video.locator("source").first()).toHaveAttribute("src", /\/api\/media\/videos\/.+\.mp4$/);
  const track = video.locator("track");
  await expect(track).toHaveAttribute("src", /\/api\/form-videos\/[0-9a-f-]{36}\/captions$/);
  const vtt = await pub.request.get(`${baseURL}${await track.getAttribute("src")}`);
  expect(vtt.status()).toBe(200);
  expect(await vtt.text()).toContain("stand-in transcript");
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 15_000 }).toBeGreaterThan(0);
  const src = await video.locator("source").first().getAttribute("src");
  expect((await pub.request.get(`${baseURL}${src}`)).status()).toBe(200);
  await visitor.close();
});

test("VID-06 an approved video's HLS playlist is served to anyone, listed first by players, and refused once it's rejected", async ({ baseURL }) => {
  const api = await adminApi(baseURL!);
  await needFfmpeg(api, { hls: true });
  const p = await createProject(api, `Hls ${RUN}`, `hls-${RUN}`);
  const [id] = await seed(api, p.slug, [{ name: "Hana Hls", video: true, status: "approved" }]);
  await expect.poll(async () => (await detail(api, id)).hlsKey, { timeout: 90_000 }).toMatch(/^hls\/[0-9a-f-]{36}\/master\.m3u8$/);
  const { hlsKey } = await detail(api, id);

  const anon = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { "x-forwarded-for": freshIp() } });
  const master = await anon.get(`/api/media/${hlsKey}`);
  expect(master.status()).toBe(200);
  expect(master.headers()["content-type"]).toBe("application/vnd.apple.mpegurl");
  const body = await master.text();
  expect(body).toContain("#EXT-X-STREAM-INF");
  const variant = body.split("\n").find((l) => l.endsWith(".m3u8"))!;
  const folder = hlsKey!.replace(/\/master\.m3u8$/, "");
  const playlist = await (await anon.get(`/api/media/${folder}/${variant}`)).text();
  const segment = playlist.split("\n").find((l) => l.endsWith(".ts"))!;
  const seg = await anon.get(`/api/media/${folder}/${segment}`);
  expect(seg.status()).toBe(200);
  expect(seg.headers()["content-type"]).toBe("video/mp2t");

  // The widget feed's players list it first; browsers that can't play HLS skip to the MP4.
  const feed = await (await anon.get(`/api/widget/${p.slug}`)).json();
  const sources = feed.testimonials.find((t: { id: string }) => t.id === id).video.sources as { url: string; type: string }[];
  expect(sources[0]).toEqual({ url: `/api/media/${hlsKey}`, type: "application/vnd.apple.mpegurl" });
  expect(sources[1].type).toMatch(/^video\/mp4/);

  // Rejected: the playlist and every segment are refused at once.
  expect((await api.patch(`/api/admin/testimonials/${id}`, { data: { status: "rejected" } })).ok()).toBe(true);
  expect((await anon.get(`/api/media/${hlsKey}`)).status()).toBe(404);
  expect((await anon.get(`/api/media/${folder}/${segment}`)).status()).toBe(404);
  // The team still can.
  expect((await api.get(`/api/media/${hlsKey}`)).status()).toBe(200);
  await anon.dispose();
});
