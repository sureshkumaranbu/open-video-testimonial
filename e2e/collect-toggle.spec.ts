import { expect, test } from "@playwright/test";
import { adminApi, createProject, useFreshIp } from "./helpers";

/**
 * FORM-03 regression on the classic page: switching Video → Write → Video
 * used to unmount the recorder, which aborted its upload while the page kept
 * the aborted take, so sending failed with an expired upload. The take now
 * lives outside the recorder and survives the switch.
 */

const RUN = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

test("FORM-03 a recording survives switching Video → Write → Video and still sends", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Toggle Co", `toggle-${RUN}`);
  const deletes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "DELETE" && r.url().includes("/api/uploads/")) deletes.push(r.url());
  });

  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByRole("button", { name: "Record with camera" }).click();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByText(/^REC 00:0[2-9]$/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /^Stop/ }).click();
  await expect(page.getByTestId("upload-status")).toHaveAttribute("data-done", "true", { timeout: 15_000 });

  await page.getByRole("button", { name: "Write" }).click();
  await expect(page.getByTestId("video-recorder")).toHaveCount(0);
  await page.getByRole("button", { name: "Video" }).click();
  // The same take is back, still uploaded, and nothing was thrown away.
  await expect(page.getByTestId("video-recorder")).toHaveAttribute("data-state", "recorded");
  await expect(page.getByLabel("Your recording")).toBeVisible();
  await expect(page.getByTestId("upload-status")).toHaveAttribute("data-done", "true");
  expect(deletes).toEqual([]);

  await page.getByLabel("Your name").fill("Toggle Tess");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  await expect(page.getByRole("status").filter({ hasText: /thank you/i })).toBeVisible();

  const body = await (await api.get(`/api/admin/projects/${p.id}`)).json();
  const row = body.testimonials.find((t: { authorName: string }) => t.authorName === "Toggle Tess");
  expect(row.videoKey ?? row.videoOriginalKey).toBeTruthy();
});

test("FORM-03 Record again after switching back still throws the old take away", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Retake Co", `retake-${RUN}`);
  await page.goto(`/c/${p.slug}`);
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByRole("button", { name: "Record with camera" }).click();
  await page.getByRole("button", { name: "Start recording" }).click();
  await expect(page.getByText(/^REC 00:0[1-9]$/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /^Stop/ }).click();
  await page.getByRole("button", { name: "Write" }).click();
  await page.getByRole("button", { name: "Video" }).click();
  await page.getByRole("button", { name: "Record again" }).click();
  await expect(page.getByTestId("video-recorder")).toHaveAttribute("data-state", "idle");
  // Nothing recorded now: sending asks for a video instead of failing on the old upload.
  await page.getByLabel("Your name").fill("Retake Ray");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Record or upload a video before sending." })).toBeVisible();
});
