import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { adminApi, createProject, FIXTURES, shot, signIn, useFreshIp } from "./helpers";

/**
 * The mobile-first recorder and the media pipeline: countdown, on-screen
 * questions, uploading while recording, resuming after a dropped request,
 * the camera-app fallback, and ffmpeg conversion (MP4 + poster).
 *
 * Chromium's fake camera stands in for a real one. Playwright's Chromium has
 * no H.264 decoder, so playback here uses the original WebM, which the page
 * lists as the fallback source after the converted MP4.
 */

const RUN = Date.now().toString(36);
const slug = (name: string) => `rec-${name}-${RUN}`;

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
  await expect(page.getByRole("status").filter({ hasText: /thank you/i })).toBeVisible();
}

async function waitForProcessed(api: APIRequestContext, projectId: string, name: string) {
  let row: Record<string, unknown> | undefined;
  await expect
    .poll(
      async () => {
        const body = await (await api.get(`/api/admin/projects/${projectId}`)).json();
        row = body.testimonials.find((t: { authorName: string }) => t.authorName === name);
        return row?.mediaStatus;
      },
      { timeout: 60_000 },
    )
    .toBe("ready");
  return row!;
}

test("records with a countdown and on-screen questions, uploading while it records", async ({ page, baseURL }) => {
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
  await expect(page.getByTestId("countdown")).toHaveText("3");
  await expect(page.getByTestId("countdown")).toHaveText("2");
  await expect(page.getByText(/^REC 00:0\d$/)).toBeVisible({ timeout: 5000 });
  // Questions restart from the first one when recording begins.
  await expect(overlay).toContainText("Question 1 of 3");

  // Chunks start uploading before the person presses stop.
  await expect.poll(() => puts.length, { timeout: 15_000 }).toBeGreaterThan(0);
  const beforeStop = puts.length;
  await page.getByRole("button", { name: /^Stop/ }).click();
  expect(beforeStop).toBeGreaterThan(0);

  await expect(page.getByLabel("Your recording")).toBeVisible();
  await expect(page.getByTestId("upload-status")).toContainText("Video uploaded", { timeout: 15_000 });

  // The submission references the upload instead of re-sending the video.
  const submitted = page.waitForRequest((r) => r.url().endsWith(`/api/projects/${p.slug}/testimonials`));
  await fillAndSubmit(page, "Rita Recorder");
  const body = (await submitted).postData() ?? "";
  expect(body).toContain('name="videoUpload"');
  expect(body).not.toContain('name="video"');

  const row = await waitForProcessed(p.api, p.id, "Rita Recorder");
  expect(row.videoMime).toBe("video/mp4");
  expect(row.posterKey).toMatch(/^images\/.+\.jpg$/);
  expect(row.videoWidth).toBeGreaterThan(0);
});

test("an upload survives dropped requests and resumes", async ({ page, baseURL }) => {
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
  await expect(page.getByTestId("upload-status")).toContainText("Video uploaded", { timeout: 20_000 });
  expect(failed).toBe(2);
  await fillAndSubmit(page, "Nadia Network");

  const row = await waitForProcessed(p.api, p.id, "Nadia Network");
  expect(row.videoOriginalKey).toMatch(/\.webm$/);
});

test("a server rejection shows a clear error with a retry button", async ({ page, baseURL }) => {
  const p = await project(baseURL!, "Rejecting Co");
  await page.route("**/api/uploads/**", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 413, contentType: "application/json", body: JSON.stringify({ error: "The file is larger than 200 MB" }) })
      : route.continue(),
  );
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByTestId("video-file").setInputFiles(path.join(FIXTURES, "sample.webm"));
  await expect(page.getByTestId("upload-status")).toContainText("larger than 200 MB");
  await expect(page.getByRole("button", { name: "Retry upload" })).toBeVisible();

  await page.getByLabel("Your name").fill("Big File");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  await expect(page.locator("p.error")).toContainText("larger than 200 MB");

  // Once the problem goes away, retrying finishes the upload.
  await page.unroute("**/api/uploads/**");
  await page.getByRole("button", { name: "Retry upload" }).click();
  await expect(page.getByTestId("upload-status")).toContainText("Video uploaded");
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  await expect(page.getByRole("status").filter({ hasText: /thank you/i })).toBeVisible();
});

test("recording again throws the first upload away", async ({ page, baseURL }) => {
  const p = await project(baseURL!, "Retake Co");
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByTestId("video-file").setInputFiles(path.join(FIXTURES, "sample.webm"));
  await expect(page.getByTestId("upload-status")).toContainText("Video uploaded");
  const deleted = page.waitForRequest((r) => r.method() === "DELETE" && r.url().includes("/api/uploads/"));
  await page.getByRole("button", { name: "Record again" }).click();
  expect((await (await deleted).response())?.status()).toBe(200);
  await expect(page.getByRole("button", { name: "Record with camera" })).toBeVisible();
});

test("stops by itself at the project's time limit", async ({ page, baseURL }) => {
  test.slow();
  const p = await project(baseURL!, "Short Limit Co", { maxVideoSeconds: 15 });
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await expect(page.getByText(/Up to 15 seconds/)).toBeVisible();
  await page.getByRole("button", { name: "Record with camera" }).click();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByRole("button", { name: /Stop · 00:1[0-5] left/ })).toBeVisible({ timeout: 6000 });
  const startedAt = Date.now();
  await expect(page.getByText(/seconds left\. Recording stops automatically/)).toBeVisible({ timeout: 12_000 });
  await expect(page.getByLabel("Your recording")).toBeVisible({ timeout: 10_000 });
  const elapsed = (Date.now() - startedAt) / 1000;
  expect(elapsed).toBeGreaterThan(12);
  expect(elapsed).toBeLessThan(18);
  await expect(page.getByTestId("upload-status")).toContainText("Video uploaded");
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
    await expect(page.getByTestId("upload-status")).toContainText("Video uploaded");
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
  await expect(page.getByTestId("upload-status")).toContainText("Video uploaded");
});

test("the dashboard shows conversion progress, then the poster", async ({ page, baseURL }) => {
  const p = await project(baseURL!, "Poster Co");
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByTestId("video-file").setInputFiles(path.join(FIXTURES, "sample.webm"));
  await expect(page.getByTestId("upload-status")).toContainText("Video uploaded");
  await fillAndSubmit(page, "Paula Poster");

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}`);
  const card = page.getByTestId("admin-testimonial").filter({ hasText: "Paula Poster" });
  // Either still converting or already done; it must end with a poster.
  await expect(card.locator("video")).toHaveAttribute("poster", /\/api\/media\/images\/.+\.jpg$/, { timeout: 60_000 });
  await expect(card.getByTestId("media-status")).toHaveCount(0);

  await card.getByRole("button", { name: "Approve" }).click();
  await page.goto(`/wall/${p.slug}`);
  const video = page.locator("article.testimonial video");
  await expect(video).toHaveAttribute("poster", /\.jpg$/);
  await expect(video).toHaveAttribute("preload", "none");
  await expect(video.locator("source")).toHaveCount(2);
  await expect(video.locator("source").first()).toHaveAttribute("type", /avc1/);
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);
  expect(await video.evaluate((v: HTMLVideoElement) => v.currentSrc)).toMatch(/\.webm$/);
});
