import path from "node:path";
import { expect, test } from "@playwright/test";
import { adminApi, createProject, FIXTURES, hostPage, signIn, skipLinuxWebkitMedia, startHostServer, useFreshIp } from "./helpers";

/**
 * Transcripts and captions end to end. The test server runs a stand-in for
 * whisper.cpp (e2e/fixtures/fake-whisper.mjs), so these skip against a
 * server with transcription turned off (e.g. the Docker job).
 */

const RUN = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

test("a video gets a transcript and captions that the owner can edit and publish", async ({ page, baseURL, browserName }) => {
  skipLinuxWebkitMedia(browserName);
  const api = await adminApi(baseURL!);
  const system = await (await api.get("/api/admin/system")).json();
  test.skip(!system.transcription.enabled || !system.ffmpeg, "transcription isn't configured on this server");

  const p = await createProject(api, "Caption Co", `cap-${RUN}`);
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByTestId("video-file").setInputFiles(path.join(FIXTURES, "sample.webm"));
  await expect(page.getByTestId("upload-status")).toContainText("Video uploaded");
  await page.getByLabel("Your name").fill("Cara Captions");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  await expect(page.getByRole("status").filter({ hasText: /thank you/i })).toBeVisible();

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}`);
  const card = page.getByTestId("admin-testimonial").filter({ hasText: "Cara Captions" });
  const panel = card.getByTestId("transcript-panel");
  await expect(panel).toHaveAttribute("data-status", "ready", { timeout: 60_000 });
  await panel.locator("summary").click();
  const transcript = panel.getByRole("textbox", { name: "Transcript", exact: true });
  await expect(transcript).toHaveValue("This is a stand-in transcript. It proves the audio reached the transcriber.");
  await expect(panel.getByLabel(/Captions/)).toHaveValue(/^WEBVTT/);

  // Edit the transcript, then use it as the written quote.
  await transcript.fill("We set it up on Friday and had six videos by Monday.");
  await panel.getByRole("button", { name: "Save transcript" }).click();
  await expect(panel.getByRole("button", { name: "Save transcript" })).toBeDisabled();
  await panel.getByRole("button", { name: "Use transcript as quote" }).click();
  await expect(card.locator("p.quote")).toHaveText("We set it up on Friday and had six videos by Monday.");

  // Bad captions are refused with a readable error.
  await panel.getByLabel(/Captions/).fill("this is not a caption file");
  await panel.getByRole("button", { name: "Save transcript" }).click();
  await expect(page.locator("p.error")).toContainText("WebVTT");
  await page.reload();
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card).toHaveCount(0);

  // The wall shows captions (on by default) and a readable transcript.
  await page.goto(`/wall/${p.slug}`);
  const video = page.locator("article.testimonial video");
  const track = video.locator("track");
  await expect(track).toHaveAttribute("kind", "captions");
  await expect(track).toHaveAttribute("default", "");
  await video.evaluate((v: HTMLVideoElement) => {
    v.muted = true;
    return v.play();
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.textTracks[0]?.cues?.length ?? 0), { timeout: 15_000 })
    .toBe(2);
  expect(await video.evaluate((v: HTMLVideoElement) => v.textTracks[0].mode)).toBe("showing");
  await page.getByText("Transcript", { exact: true }).click();
  await expect(page.locator(".transcript p")).toHaveText("We set it up on Friday and had six videos by Monday.");

  // The script embed loads the captions cross-origin.
  const host = await startHostServer();
  try {
    host.pages["/captions.html"] = hostPage(
      "Captions host",
      `<script src="${baseURL}/widget.js" data-project="${p.slug}" async></script>`,
    );
    await page.setExtraHTTPHeaders({});
    await page.goto(`${host.url}/captions.html`);
    const widgetVideo = page.locator("[data-plaudit-widget] video");
    await expect(widgetVideo).toHaveAttribute("crossorigin", "anonymous");
    await widgetVideo.evaluate((v: HTMLVideoElement) => {
      v.muted = true;
      return v.play();
    });
    await expect
      .poll(() => widgetVideo.evaluate((v: HTMLVideoElement) => v.textTracks[0]?.cues?.length ?? 0), { timeout: 15_000 })
      .toBe(2);
    await expect(page.locator("[data-plaudit-widget] details")).toContainText("Transcript");
  } finally {
    await host.close();
  }
});
