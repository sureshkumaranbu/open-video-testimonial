import fs from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { adminApi, createProject, FIXTURES, shot, signIn, useFreshIp } from "./helpers";

/**
 * The mobile-first recorder and the media pipeline: countdown, on-screen
 * questions, uploading while recording, resuming after a dropped request,
 * the camera-app fallback, and ffmpeg conversion (MP4 + poster).
 *
 * Chromium's fake camera stands in for a real one. Whether a browser can
 * decode H.264 differs between builds (Playwright's pinned Chromium can't,
 * newer ones can), so playback checks what the page promises: the converted
 * MP4 first, with its codecs, then the original WebM, and the player plays
 * one of them.
 *
 * L13: every wait follows the page or the server (a status text, a request,
 * a recorder event, the row's media status) with a generous limit, never a
 * fixed time, so a busy machine makes the suite slower but not red. Tests
 * that record or convert for real get a longer per-test timeout.
 */

const RUN = Date.now().toString(36);
const slug = (name: string) => `rec-${name}-${RUN}`;

/** Generous limits for work whose speed depends on the machine (L13). */
const UPLOAD_MS = 30_000;
const PROCESS_MS = 120_000;
const CAMERA_MS = 20_000;

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

async function project(baseURL: string, name: string, patch: Record<string, unknown> = {}) {
  const api = await adminApi(baseURL);
  const p = await createProject(api, name, slug(name.toLowerCase().replace(/\W+/g, "-")));
  if (Object.keys(patch).length) {
    const res = await api.patch(`/api/admin/projects/${p.id}`, { data: patch });
    expect(res.ok(), await res.text()).toBe(true);
  }
  return { api, ...p };
}

async function fillAndSubmit(page: Page, name: string) {
  await page.getByLabel("Your name").fill(name);
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  await expect(page.getByRole("status").filter({ hasText: /thank you/i })).toBeVisible({ timeout: UPLOAD_MS });
}

/** The upload of the chosen or recorded video has finished. */
async function expectUploaded(page: Page) {
  await expect(page.getByTestId("upload-status")).toContainText("Video uploaded", { timeout: UPLOAD_MS });
}

/**
 * Notes, in the page, when each MediaRecorder starts and stops, and every
 * number the countdown shows, so tests read what happened instead of racing
 * the page's timers.
 */
async function watchRecorder(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __rec: { starts: number[]; stops: number[]; countdown: string[] } };
    w.__rec = { starts: [], stops: [], countdown: [] };
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (this: MediaRecorder, ...args: Parameters<MediaRecorder["start"]>) {
      this.addEventListener("start", () => w.__rec.starts.push(performance.now()));
      this.addEventListener("stop", () => w.__rec.stops.push(performance.now()));
      return start.apply(this, args);
    };
    new MutationObserver(() => {
      const n = document.querySelector('[data-testid="countdown"]')?.textContent ?? null;
      if (n !== null && w.__rec.countdown.at(-1) !== n) w.__rec.countdown.push(n);
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  return () => page.evaluate(() => (window as unknown as { __rec: { starts: number[]; stops: number[]; countdown: string[] } }).__rec);
}

async function serverHasFfmpeg(api: APIRequestContext) {
  return (await (await api.get("/api/admin/system")).json()).ffmpeg as boolean;
}

/**
 * Waits for the worker to finish with the video. With ffmpeg that means a
 * converted MP4 ("ready"); a server without it serves the original ("skipped").
 */
async function waitForProcessed(api: APIRequestContext, projectId: string, name: string) {
  const expected = (await serverHasFfmpeg(api)) ? "ready" : "skipped";
  let row: Record<string, unknown> | undefined;
  await expect
    .poll(
      async () => {
        const body = await (await api.get(`/api/admin/projects/${projectId}`)).json();
        row = body.testimonials.find((t: { authorName: string }) => t.authorName === name);
        return row?.mediaStatus;
      },
      { timeout: PROCESS_MS },
    )
    .toBe(expected);
  return row!;
}

/**
 * The live preview really shows the camera: a stream is attached and video
 * frames are arriving (it has a size and its clock moves). Returns the
 * stream's video track id.
 */
async function expectPreviewPlaying(page: Page) {
  const preview = page.getByLabel("Camera preview");
  const look = () =>
    preview.evaluate((v: HTMLVideoElement) => ({
      stream: v.srcObject instanceof MediaStream && v.srcObject.active,
      width: v.videoWidth > 0,
      playing: !v.paused,
    }));
  await expect.poll(look, { timeout: CAMERA_MS }).toEqual({ stream: true, width: true, playing: true });
  const before = await preview.evaluate((v: HTMLVideoElement) => v.currentTime);
  await expect.poll(() => preview.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: CAMERA_MS }).toBeGreaterThan(before);
  return preview.evaluate((v: HTMLVideoElement) => (v.srcObject as MediaStream).getVideoTracks()[0].id);
}

test("records with a countdown and on-screen questions, uploading while it records", async ({ page, baseURL }) => {
  // Records, uploads and converts for real.
  test.setTimeout(240_000);
  const recorder = await watchRecorder(page);
  const p = await project(baseURL!, "Countdown Co", {
    questions: "What problem did you have?\nWhat changed?\nWould you recommend us?",
  });
  const puts: number[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && r.url().includes("/api/uploads/")) puts.push(Date.now());
  });

  await page.goto(`/c/${p.slug}`);
  await expect(page.getByRole("list", { name: "Ideas for what to say" }).getByRole("listitem")).toHaveText([
    "What problem did you have?",
    "What changed?",
    "Would you recommend us?",
  ]);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByRole("button", { name: "Record with camera" }).click();
  await expect(page.getByLabel("Camera preview")).toBeVisible();
  await expectPreviewPlaying(page);

  const overlay = page.getByTestId("prompt-overlay");
  await expect(overlay).toContainText("Question 1 of 3");
  await expect(overlay).toContainText("What problem did you have?");
  await overlay.getByRole("button", { name: "Next question" }).click();
  await expect(overlay).toContainText("What changed?");
  await page.getByRole("button", { name: "Hide questions" }).click();
  await expect(overlay).toHaveCount(0);
  await page.getByRole("button", { name: "Show questions" }).click();
  await expect(overlay).toBeVisible();

  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByText(/^REC 00:\d\d$/)).toBeVisible({ timeout: CAMERA_MS });
  // 3, 2, 1, then recording (read from the page, however slowly this test polls).
  expect((await recorder()).countdown).toEqual(["3", "2", "1"]);
  expect((await recorder()).starts).toHaveLength(1);
  await expectPreviewPlaying(page); // still live while recording
  // Questions restart from the first one when recording begins.
  await expect(overlay).toContainText("Question 1 of 3");

  // Chunks start uploading before the person presses stop.
  await expect.poll(() => puts.length, { timeout: UPLOAD_MS }).toBeGreaterThan(0);
  const beforeStop = puts.length;
  await page.getByRole("button", { name: /^Stop/ }).click();
  expect(beforeStop).toBeGreaterThan(0);

  await expect(page.getByLabel("Your recording")).toBeVisible({ timeout: CAMERA_MS });
  await expectUploaded(page);

  // The submission references the upload instead of re-sending the video.
  const submitted = page.waitForRequest((r) => r.url().endsWith(`/api/projects/${p.slug}/testimonials`));
  await fillAndSubmit(page, "Rita Recorder");
  const body = (await submitted).postData() ?? "";
  expect(body).toContain('name="videoUpload"');
  expect(body).not.toContain('name="video"');

  const row = await waitForProcessed(p.api, p.id, "Rita Recorder");
  if (row.mediaStatus === "ready") {
    expect(row.videoMime).toBe("video/mp4");
    expect(row.posterKey).toMatch(/^images\/.+\.jpg$/);
    expect(row.videoWidth).toBeGreaterThan(0);
  } else {
    expect(row.videoMime).toBe("video/webm"); // served as recorded
  }
});

test("playing a recording back shows its length and can seek", async ({ page, baseURL }) => {
  test.slow();
  const p = await project(baseURL!, "Playback Co");
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByRole("button", { name: "Record with camera" }).click();
  await page.getByRole("button", { name: "Start recording" }).click();
  // At least two seconds recorded, by the page's own clock.
  await expect(page.getByText(/^REC 00:(0[2-9]|[1-9]\d)$/)).toBeVisible({ timeout: CAMERA_MS });
  await page.getByRole("button", { name: /^Stop/ }).click();
  const playback = page.getByLabel("Your recording");
  await expect(playback).toBeVisible({ timeout: CAMERA_MS });
  // A MediaRecorder WebM says nothing about its length; the player must work it out.
  await expect.poll(() => playback.evaluate((v: HTMLVideoElement) => v.duration), { timeout: CAMERA_MS }).toBeGreaterThan(1);
  const { duration, start } = await playback.evaluate((v: HTMLVideoElement) => ({ duration: v.duration, start: v.currentTime }));
  expect(Number.isFinite(duration)).toBe(true);
  expect(start).toBe(0); // back at the start, ready to play
  const seeked = await playback.evaluate(
    (v: HTMLVideoElement) =>
      new Promise<number>((r) => {
        v.addEventListener("seeked", () => r(v.currentTime), { once: true });
        v.currentTime = v.duration / 2;
      }),
  );
  expect(seeked).toBeGreaterThan(0.4);
});

test("the preview shows the camera however the browser schedules rendering", async ({ page, baseURL }) => {
  const p = await project(baseURL!, "Timing Co");
  // Frame callbacks can run before React has put the <video> on the page
  // (slow devices, dev builds, busy tabs). Force that order: the preview must
  // still get the stream.
  await page.addInitScript(() => {
    window.requestAnimationFrame = (cb: FrameRequestCallback) => {
      queueMicrotask(() => cb(performance.now()));
      return 0;
    };
  });
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByRole("button", { name: "Record with camera" }).click();
  await expectPreviewPlaying(page);
});

for (const camera of ["a quick", "a slow (1.5 s)"]) {
  test(`the preview is live every time, previewing and recording, with ${camera} camera`, async ({ page, baseURL }) => {
    // Five rounds of preview, countdown and recording.
    test.setTimeout(300_000);
    const p = await project(baseURL!, `Loop ${camera.includes("slow") ? "Slow" : "Quick"} Co`);
    if (camera.includes("slow")) {
      await page.addInitScript(() => {
        const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (c) => new Promise((r) => setTimeout(r, 1500)).then(() => real(c));
      });
    }
    await page.goto(`/c/${p.slug}`);
    await page.getByRole("button", { name: "Video" }).click();
    for (let round = 1; round <= 5; round++) {
      await page.getByRole("button", { name: "Record with camera" }).click();
      await expectPreviewPlaying(page);
      await page.getByRole("button", { name: "Start recording" }).click();
      await expect(page.getByText(/^REC 00:\d\d$/)).toBeVisible({ timeout: CAMERA_MS });
      await expectPreviewPlaying(page);
      await page.getByRole("button", { name: /^Stop/ }).click();
      await expect(page.getByLabel("Your recording")).toBeVisible({ timeout: CAMERA_MS });
      await page.getByRole("button", { name: "Record again" }).click();
    }
  });
}

test("switching camera keeps the preview live, on the new camera", async ({ page, baseURL }) => {
  const p = await project(baseURL!, "Switch Co");
  // Chromium's fake device is one camera; report a second so "Switch camera" appears.
  await page.addInitScript(() => {
    const real = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
    navigator.mediaDevices.enumerateDevices = async () => {
      const devices = await real();
      const camera = devices.find((d) => d.kind === "videoinput");
      return camera ? [...devices, { ...camera.toJSON(), deviceId: "back-camera", label: "Back camera" } as MediaDeviceInfo] : devices;
    };
  });
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByRole("button", { name: "Record with camera" }).click();
  const first = await expectPreviewPlaying(page);
  await expect(page.getByLabel("Camera preview")).toHaveAttribute("data-facing", "user");

  await page.getByRole("button", { name: "Switch camera" }).click();
  await expect(page.getByLabel("Camera preview")).toHaveAttribute("data-facing", "environment", { timeout: CAMERA_MS });
  const second = await expectPreviewPlaying(page);
  expect(second).not.toBe(first); // a new stream, attached to the same preview
});

test("an upload survives dropped requests and resumes", async ({ page, baseURL }) => {
  // Uploads and converts for real.
  test.setTimeout(180_000);
  const p = await project(baseURL!, "Flaky Network Co");
  let failed = 0;
  await page.route("**/api/uploads/**", async (route) => {
    if (route.request().method() === "PUT" && failed < 2) {
      failed++;
      await route.abort("connectionreset");
      return;
    }
    await route.continue();
  });
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByTestId("video-file").setInputFiles(path.join(FIXTURES, "sample.webm"));
  await expectUploaded(page);
  expect(failed).toBe(2);
  await fillAndSubmit(page, "Nadia Network");

  const row = await waitForProcessed(p.api, p.id, "Nadia Network");
  expect(row.videoOriginalKey).toMatch(/\.webm$/);
});

test("a temporary server error shows a clear error with a retry button", async ({ page, baseURL }) => {
  const p = await project(baseURL!, "Rejecting Co");
  await page.route("**/api/uploads/**", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Missing or invalid offset" }) })
      : route.continue(),
  );
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByTestId("video-file").setInputFiles(path.join(FIXTURES, "sample.webm"));
  await expect(page.getByTestId("upload-status")).toContainText("Missing or invalid offset", { timeout: UPLOAD_MS });
  await expect(page.getByRole("button", { name: "Retry upload" })).toBeVisible();

  await page.getByLabel("Your name").fill("Flaky Upload");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  await expect(page.locator("p.error")).toContainText("Missing or invalid offset", { timeout: UPLOAD_MS });

  // Once the problem goes away, retrying finishes the upload.
  await page.unroute("**/api/uploads/**");
  await page.getByRole("button", { name: "Retry upload" }).click();
  await expectUploaded(page);
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  await expect(page.getByRole("status").filter({ hasText: /thank you/i })).toBeVisible({ timeout: UPLOAD_MS });
});

test("a file over the size limit is refused before uploading, with no retry or playback", async ({ page, baseURL }, testInfo) => {
  const p = await project(baseURL!, "Too Big Co");
  // A real WebM header padded (sparsely) to 1 byte over the default 200 MB limit.
  const big = testInfo.outputPath("too-big.webm");
  fs.mkdirSync(path.dirname(big), { recursive: true });
  fs.writeFileSync(big, fs.readFileSync(path.join(FIXTURES, "sample.webm")).subarray(0, 4096));
  fs.truncateSync(big, 200 * 1024 * 1024 + 1);
  const uploads: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/uploads")) uploads.push(`${r.method()} ${r.url()}`);
  });

  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByTestId("video-file").setInputFiles(big);
  const rejected = page.getByTestId("upload-rejected");
  await expect(rejected).toContainText("The file is larger than 200 MB");
  await expect(rejected.getByTestId("video-file-again")).toBeAttached();
  await expect(page.getByRole("button", { name: "Retry upload" })).toHaveCount(0);
  await expect(page.getByText("Play it back before you send it.")).toHaveCount(0);
  await expect(page.getByLabel("Your recording")).toHaveCount(0);
  expect(uploads).toEqual([]); // not one byte sent, not even a start request

  // Choosing a file that fits works.
  await rejected.getByTestId("video-file-again").setInputFiles(path.join(FIXTURES, "sample.webm"));
  await expectUploaded(page);
  await expect(page.getByTestId("upload-rejected")).toHaveCount(0);
  fs.rmSync(big);
});

test("a file that isn't really a video is refused straight away", async ({ page, baseURL }) => {
  const p = await project(baseURL!, "Fake Video Co");
  const uploads: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/uploads")) uploads.push(`${r.method()} ${r.url()}`);
  });
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByTestId("video-file").setInputFiles({
    name: "holiday.mp4",
    mimeType: "video/mp4",
    buffer: Buffer.from("This is a text file with a video extension, not a video at all.\n".repeat(20)),
  });
  await expect(page.getByTestId("upload-rejected")).toContainText("isn't a video we can use");
  await expect(page.getByText("Video uploaded")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Retry upload" })).toHaveCount(0);
  expect(uploads).toEqual([]); // caught before anything was sent
});

test("recording again throws the first upload away", async ({ page, baseURL }) => {
  const p = await project(baseURL!, "Retake Co");
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByTestId("video-file").setInputFiles(path.join(FIXTURES, "sample.webm"));
  await expectUploaded(page);
  const deleted = page.waitForRequest((r) => r.method() === "DELETE" && r.url().includes("/api/uploads/"));
  await page.getByRole("button", { name: "Record again" }).click();
  expect((await (await deleted).response())?.status()).toBe(200);
  await expect(page.getByRole("button", { name: "Record with camera" })).toBeVisible();
});

test("stops by itself at the project's time limit", async ({ page, baseURL }) => {
  // A 15-second recording is the point of this test.
  test.setTimeout(180_000);
  const recorder = await watchRecorder(page);
  const p = await project(baseURL!, "Short Limit Co", { maxVideoSeconds: 15 });
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await expect(page.getByText(/Up to 15 seconds/)).toBeVisible();
  await page.getByRole("button", { name: "Record with camera" }).click();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByRole("button", { name: /Stop · 00:\d\d left/ })).toBeVisible({ timeout: CAMERA_MS });
  await expect(page.getByText(/seconds left\. Recording stops automatically/)).toBeVisible({ timeout: 30_000 });
  // Nobody presses Stop: the recorder stops itself.
  await expect(page.getByLabel("Your recording")).toBeVisible({ timeout: 30_000 });
  const { starts, stops } = await recorder();
  expect(starts).toHaveLength(1);
  expect(stops).toHaveLength(1);
  // Measured by the page from the recorder's own start and stop events, not by
  // when this test happened to notice them.
  const elapsed = (stops[0] - starts[0]) / 1000;
  expect(elapsed).toBeGreaterThan(14);
  expect(elapsed).toBeLessThan(18);
  await expectUploaded(page);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("offers the phone's camera app and records upright", async ({ page, baseURL }) => {
    const p = await project(baseURL!, "Phone Co", {
      questions: "What was hard before?\nWhat changed for you?\nWho should try it?",
    });
    await page.goto(`/c/${p.slug}`);
    await page.getByRole("button", { name: "Video" }).click();
    const capture = page.getByTestId("video-capture");
    await expect(capture).toHaveAttribute("capture", "user");
    await expect(capture).toHaveAttribute("accept", "video/*");
    await expect(page.getByText("Use camera app")).toBeVisible();

    await page.getByRole("button", { name: "Record with camera" }).click();
    await expect(page.locator(".recorder-stage")).toHaveAttribute("data-portrait", "true");
    const box = await page.locator(".recorder-stage").boundingBox();
    expect(box!.height).toBeGreaterThan(box!.width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.locator(".recorder-stage").scrollIntoViewIfNeeded();
    await shot(page, "recorder-mobile");

    // A file from the camera app goes through the same resumable upload.
    await capture.setInputFiles(path.join(FIXTURES, "sample.webm"));
    await expectUploaded(page);
    await fillAndSubmit(page, "Pat Phone");
  });
});

test("without MediaRecorder it falls back to the camera app and uploads", async ({ page, baseURL }) => {
  const p = await project(baseURL!, "Old Browser Co");
  await page.addInitScript(() => {
    // @ts-expect-error simulate a browser without MediaRecorder
    delete window.MediaRecorder;
  });
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await expect(page.getByRole("button", { name: "Record with camera" })).toBeDisabled();
  await expect(page.getByText(/can't record in the page/)).toBeVisible();
  await expect(page.getByTestId("video-capture")).toBeAttached();
  await page.getByTestId("video-capture").setInputFiles(path.join(FIXTURES, "sample.webm"));
  await expectUploaded(page);
});

test("the dashboard shows conversion progress, then the poster", async ({ page, baseURL }) => {
  // Uploads and converts for real.
  test.setTimeout(240_000);
  const p = await project(baseURL!, "Poster Co");
  test.skip(!(await serverHasFfmpeg(p.api)), "this server has no ffmpeg (image built with INSTALL_FFMPEG=false)");
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByTestId("video-file").setInputFiles(path.join(FIXTURES, "sample.webm"));
  await expectUploaded(page);
  await fillAndSubmit(page, "Paula Poster");

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}`);
  const card = page.getByTestId("admin-testimonial").filter({ hasText: "Paula Poster" });
  // Either still converting or already done; it must end with a poster.
  await expect(card.locator("video")).toHaveAttribute("poster", /\/api\/media\/images\/.+\.jpg$/, { timeout: PROCESS_MS });
  await expect(card.getByTestId("media-status")).toHaveCount(0);

  await card.getByRole("button", { name: "Approve" }).click();
  await page.goto(`/wall/${p.slug}`);
  const video = page.locator("article.testimonial video");
  await expect(video).toHaveAttribute("poster", /\.jpg$/);
  await expect(video).toHaveAttribute("preload", "none");
  // L17: what the page promises, whatever this browser decodes: the converted MP4
  // first with its codecs named (so a browser without H.264 skips it unfetched),
  // then the original upload as the fallback.
  const sources = await video.locator("source").evaluateAll((els) =>
    (els as HTMLSourceElement[]).map((s) => ({ src: s.src, type: s.type, canPlay: document.createElement("video").canPlayType(s.type) })),
  );
  expect(sources).toHaveLength(2);
  expect(sources[0].src).toMatch(/\/api\/media\/videos\/.+\.mp4$/);
  expect(sources[0].type).toMatch(/^video\/mp4; codecs="avc1\.[0-9A-Fa-f]{6}, mp4a\.40\.2"$/);
  expect(sources[1].src).toMatch(/\/api\/media\/videos\/.+\.webm$/);
  expect(sources[1].type).toBe("video/webm");
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: CAMERA_MS }).toBeGreaterThan(0);
  // It plays one of the two. A browser that says it can't play the MP4 must have
  // gone straight to the original; one that can may play either (it falls back
  // if decoding fails).
  const playing = await video.evaluate((v: HTMLVideoElement) => v.currentSrc);
  expect(sources.map((s) => s.src)).toContain(playing);
  if (sources[0].canPlay === "") expect(playing).toBe(sources[1].src);
});
