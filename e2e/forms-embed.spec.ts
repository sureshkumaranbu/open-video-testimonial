import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { formProject } from "./form-helpers";
import { adminApi, freshIp, startHostServer } from "./helpers";

/**
 * FORM-11: the form embedded on another site (a different origin) as an
 * inline element, a popup button and a plain iframe. Each sends a
 * testimonial; the inline one records with the (fake) camera through the
 * iframe's camera permission, and the host hears the resize and sent messages.
 */

const PAGES = [
  { type: "question", key: "q1", primary: true, title: "What did you like?" },
  { type: "consent" },
  { type: "about_you", fields: { email: { enabled: false }, photo: { enabled: false }, title: { enabled: false }, company: { enabled: false } } },
  { type: "thank_you" },
];

let host: Awaited<ReturnType<typeof startHostServer>>;
test.beforeAll(async () => {
  host = await startHostServer();
});
test.afterAll(async () => {
  await host.close();
});

/** The app sees each embed as a different visitor (its submit limit is per IP). */
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) => route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": freshIp() } }));
});

async function fill(frame: FrameLocator, name: string, video = false) {
  await expect(frame.getByTestId("form-runner")).toHaveAttribute("data-ready", "true");
  if (video) {
    await frame.getByRole("button", { name: "Video" }).click();
    await frame.getByRole("button", { name: "Record with camera" }).click();
    await frame.getByRole("button", { name: "Start recording" }).click();
    await expect(frame.getByText(/^REC 00:0[2-9]$/)).toBeVisible({ timeout: 15_000 });
    await frame.getByRole("button", { name: /^Stop/ }).click();
    await expect(frame.getByTestId("upload-status")).toHaveAttribute("data-done", "true", { timeout: 15_000 });
  } else {
    await frame.getByRole("textbox").fill(`Sent from an embed by ${name}.`);
  }
  await frame.getByRole("button", { name: "Continue" }).click();
  await frame.getByTestId("consent-text").click();
  await frame.getByRole("button", { name: "Continue" }).click();
  await frame.getByLabel("Your name").fill(name);
  await frame.getByRole("button", { name: "Send" }).click();
  await expect(frame.getByTestId("thank-you")).toBeVisible({ timeout: 20_000 });
}

async function hostWith(page: Page, path: string, body: string) {
  host.pages[path] = `<!doctype html><html><head><title>Host</title></head><body><h1>Our site</h1>${body}
<script>window.heard=[];addEventListener("plaudit:submitted",function(e){heard.push(e.detail.form)});
addEventListener("message",function(e){if(e.data&&e.data.type)heard.push(e.data.type)});</script></body></html>`;
  await page.goto(`${host.url}${path}`);
}

test("FORM-11 inline, popup and iframe embeds each submit from another origin", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { project, form } = await formProject(api, "Embed Co", { pages: PAGES });
  const attrs = `data-plaudit-form="${form.slug}" data-project="${project.slug}"`;
  const script = `<script src="${baseURL}/form.js" async></script>`;

  // Inline, recording with the camera inside the cross-origin iframe.
  await hostWith(page, "/inline", `<div id="slot" ${attrs}></div>${script}`);
  const inline = page.frameLocator("#slot iframe");
  const iframe = page.locator("#slot iframe");
  await expect(iframe).toHaveAttribute("allow", /camera; microphone/);
  await expect(inline.getByRole("heading", { name: "What did you like?" })).toBeVisible();
  // It resized itself to the form (from the 640 px it starts at).
  await expect.poll(() => iframe.evaluate((el: HTMLIFrameElement) => el.style.height)).not.toBe("640px");
  await fill(inline, "Inline Ida", true);
  await expect.poll(() => page.evaluate(() => (window as unknown as { heard: string[] }).heard)).toContain(form.slug);

  // Popup button.
  await hostWith(page, "/popup", `<div ${attrs} data-mode="popup" data-label="Tell us"></div>${script}`);
  await page.getByRole("button", { name: "Tell us" }).click();
  const dialog = page.getByRole("dialog", { name: "Tell us" });
  await expect(dialog).toBeVisible();
  await fill(page.frameLocator("[data-plaudit-dialog] iframe"), "Popup Pat");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // A plain iframe, as the share panel gives it.
  const links = (await (await api.get(`/api/admin/forms/${form.id}`)).json()).form.links;
  await hostWith(page, "/iframe", links.iframe);
  await fill(page.frameLocator("iframe"), "Frame Fay");
  await expect.poll(() => page.evaluate(() => (window as unknown as { heard: string[] }).heard)).toContain("plaudit:form-submitted");

  const names = (await (await api.get(`/api/admin/projects/${project.id}`)).json()).testimonials.map((t: { authorName: string }) => t.authorName);
  expect(names.sort()).toEqual(["Frame Fay", "Inline Ida", "Popup Pat"]);
});

test("FORM-11 only the embed path can be framed; /f refuses", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { project, form } = await formProject(api, "Frames Co", { pages: PAGES });
  const embed = await page.request.get(`/embed/${project.slug}/form/${form.slug}`);
  expect(embed.headers()["content-security-policy"]).toContain("frame-ancestors *");
  expect(embed.headers()["x-frame-options"]).toBeUndefined();
  const hosted = await page.request.get(`/f/${project.slug}/${form.slug}`);
  expect(hosted.headers()["x-frame-options"]).toBe("DENY");
  expect(hosted.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
});
