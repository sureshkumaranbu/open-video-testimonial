import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { adminApi, createProject, seed, signIn, useFreshIp } from "./helpers";

/**
 * Optional auto-approve: off by default; when the owner turns it on, new
 * form submissions with enough stars (and no links) go live without a click,
 * through the same path as the Approve button.
 */

const RUN = Date.now().toString(36);
let n = 0;
const slug = (name: string) => `aa-${name}-${RUN}-${++n}`;

type Row = { id: string; status: string; approvedBy: string | null; approvalRule: string | null; mediaStatus: string };

async function rows(api: APIRequestContext, projectId: string) {
  const res = await api.get(`/api/admin/projects/${projectId}`);
  expect(res.ok()).toBe(true);
  return (await res.json()).testimonials as Row[];
}
const row = async (api: APIRequestContext, projectId: string, id: string) => (await rows(api, projectId)).find((r) => r.id === id)!;

async function settings(api: APIRequestContext, projectId: string, data: Record<string, unknown>) {
  const res = await api.patch(`/api/admin/projects/${projectId}`, { data });
  expect(res.status(), await res.text()).toBe(200);
}

async function wallNames(page: Page, projectSlug: string) {
  await page.goto(`/wall/${projectSlug}`);
  return page.locator("article.testimonial").allInnerTexts();
}

const widgetIds = async (api: APIRequestContext, projectSlug: string) =>
  ((await (await api.get(`/api/widget/${projectSlug}`)).json()).testimonials as { id: string }[]).map((t) => t.id);

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

test("a new project leaves even a 5-star testimonial pending", async ({ baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Default Co", slug("default"));
  const [id] = await seed(api, p.slug, [{ name: "Five Star", text: "Wonderful.", rating: 5 }]);
  expect(await row(api, p.id, id)).toMatchObject({ status: "pending", approvedBy: null });
});

test("turned on in the dashboard: a 4-star one goes live at once, a 3-star one waits, earlier ones stay", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Auto Co", slug("on"));
  const [earlier] = await seed(api, p.slug, [{ name: "Early Bird", text: "Sent before it was on.", rating: 5 }]);

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}`);
  const panel = page.getByTestId("auto-approve");
  const toggle = panel.getByRole("checkbox", { name: "Approve new testimonials automatically" });
  await expect(toggle).not.toBeChecked();
  await expect(panel.getByRole("checkbox", { name: "Include video testimonials" })).not.toBeChecked();
  await expect(panel.getByRole("button", { name: "4 stars" })).toHaveAttribute("aria-pressed", "true");
  await expect(panel).toContainText("Testimonials that don't match still wait for you in Pending. You can reject an approved one at any time.");
  await toggle.check();
  await panel.getByRole("button", { name: "Save auto-approve" }).click();
  await expect(panel.getByRole("status")).toHaveText("Auto-approve is on for new testimonials");

  // A customer sends a 4-star testimonial through the collection page.
  const customer = await page.context().browser()!.newPage();
  await useFreshIp(customer);
  await customer.goto(`/c/${p.slug}`);
  await customer.getByRole("radio", { name: "4 stars" }).click();
  await customer.getByLabel("Your testimonial").fill("Four solid stars from me.");
  await customer.getByLabel("Your name").fill("Quinn Quick");
  await customer.getByLabel(/I agree/).check();
  await customer.getByRole("button", { name: "Submit testimonial" }).click();
  await expect(customer.getByRole("status")).toContainText(/thank you/i);

  const [three] = await seed(api, p.slug, [{ name: "Three Star", text: "It was fine.", rating: 3 }]);
  const all = await rows(api, p.id);
  const quinn = all.find((r) => r.status === "approved")!;
  expect(quinn).toMatchObject({ approvedBy: "auto", approvalRule: "4+ stars" });
  expect(all.find((r) => r.id === three)).toMatchObject({ status: "pending" });
  expect(all.find((r) => r.id === earlier)).toMatchObject({ status: "pending" });

  // It's on the wall and in the widget feed straight away.
  expect((await wallNames(customer, p.slug)).join("\n")).toContain("Quinn Quick");
  expect(await widgetIds(api, p.slug)).toEqual([quinn.id]);

  // The dashboard labels it, and says which rule approved it.
  await page.reload();
  await page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: /^Approved/ }).click();
  const card = page.getByTestId("admin-testimonial").filter({ hasText: "Quinn Quick" });
  await expect(card.getByTestId("auto-approved-badge")).toHaveText("Auto-approved");
  await expect(card.getByTestId("approval-line")).toContainText("Approved automatically (4+ stars)");

  // Rejecting it works like any other, and takes it off the wall.
  await card.getByRole("button", { name: "Reject" }).click();
  await page.getByRole("group", { name: "Filter by status" }).getByRole("button", { name: /^Rejected/ }).click();
  const rejected = page.getByTestId("admin-testimonial").filter({ hasText: "Quinn Quick" });
  await expect(rejected).toHaveAttribute("data-status", "rejected");
  await expect(rejected.getByTestId("auto-approved-badge")).toHaveCount(0);
  expect((await wallNames(customer, p.slug)).join("\n")).not.toContain("Quinn Quick");
  expect(await widgetIds(api, p.slug)).toEqual([]);
  await customer.close();
});

test("a minimum of 5 stars leaves a 4-star one pending", async ({ baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Picky Co", slug("five"));
  await settings(api, p.id, { autoApprove: true, autoApproveMinRating: 5 });
  const [four, five] = await seed(api, p.slug, [
    { name: "Four", text: "Good.", rating: 4 },
    { name: "Five", text: "Perfect.", rating: 5 },
  ]);
  expect(await row(api, p.id, four)).toMatchObject({ status: "pending" });
  expect(await row(api, p.id, five)).toMatchObject({ status: "approved", approvalRule: "5 stars" });
});

test("text with a link stays pending", async ({ baseURL }) => {
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Linky Co", slug("link"));
  await settings(api, p.id, { autoApprove: true });
  const ids = await seed(api, p.slug, [
    { name: "Spammer", text: "Cheap pills at https://spam.example", rating: 5 },
    { name: "Www", text: "Visit www.spam.example today", rating: 5 },
  ]);
  for (const id of ids) expect(await row(api, p.id, id)).toMatchObject({ status: "pending" });
});

test.describe("videos", () => {
  test.beforeEach(async ({ baseURL }) => {
    const api = await adminApi(baseURL!);
    const system = await (await api.get("/api/admin/system")).json();
    test.skip(!system.ffmpeg, "needs ffmpeg on the server to process videos");
  });

  test("with 'Include video' off, a video stays pending after processing", async ({ baseURL }) => {
    const api = await adminApi(baseURL!);
    const p = await createProject(api, "Video Off Co", slug("vid-off"));
    await settings(api, p.id, { autoApprove: true });
    const [id] = await seed(api, p.slug, [{ name: "Vid", video: true, rating: 5 }]);
    await expect.poll(async () => (await row(api, p.id, id)).mediaStatus, { timeout: 60_000 }).toBe("ready");
    expect(await row(api, p.id, id)).toMatchObject({ status: "pending" });
  });

  test("with it on, a video is approved only once processing has finished", async ({ baseURL }) => {
    const api = await adminApi(baseURL!);
    const p = await createProject(api, "Video On Co", slug("vid-on"));
    await settings(api, p.id, { autoApprove: true, autoApproveVideo: true });
    const [id] = await seed(api, p.slug, [{ name: "Vid", video: true, rating: 5 }]);
    // Every state seen on the way has it pending until the video is ready.
    const seen: { status: string; mediaStatus: string }[] = [];
    await expect
      .poll(
        async () => {
          const r = await row(api, p.id, id);
          seen.push({ status: r.status, mediaStatus: r.mediaStatus });
          return r.status;
        },
        { timeout: 60_000, intervals: [100] },
      )
      .toBe("approved");
    expect(seen[0]).toMatchObject({ status: "pending" });
    for (const s of seen) if (s.mediaStatus !== "ready") expect(s.status).toBe("pending");
    expect(await row(api, p.id, id)).toMatchObject({ status: "approved", mediaStatus: "ready", approvedBy: "auto" });
    expect(await widgetIds(api, p.slug)).toEqual([id]);
  });
});

test("webhooks: created, then approved with approvedBy auto, both signed", async ({ baseURL }) => {
  test.skip(
    process.env.E2E_SERVER_IN_CONTAINER === "true",
    "the app runs in a container and can't reach a receiver on the test machine's localhost",
  );
  const hits: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  const receiver = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      hits.push({ headers: req.headers, body: Buffer.concat(chunks).toString() });
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  try {
    const api = await adminApi(baseURL!);
    const p = await createProject(api, "Hooked Co", slug("hook"));
    await settings(api, p.id, { autoApprove: true });
    const created = await api.post("/api/admin/webhooks", {
      data: { url: `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/aa`, projectId: p.id },
    });
    expect(created.status(), await created.text()).toBe(201);
    const { secret } = (await created.json()).webhook as { secret: string };

    const [id] = await seed(api, p.slug, [{ name: "Hooked", text: "Ping me.", rating: 5 }]);
    await expect.poll(() => hits.map((h) => h.headers["plaudit-event"]), { timeout: 15_000 }).toEqual([
      "testimonial.created",
      "testimonial.approved",
    ]);
    for (const hit of hits) {
      const [t, v1] = (hit.headers["plaudit-signature"] as string).split(",").map((s) => s.split("=")[1]);
      expect(crypto.createHmac("sha256", secret).update(`${t}.${hit.body}`).digest("hex")).toBe(v1);
    }
    expect(JSON.parse(hits[0].body).data.testimonial).toMatchObject({ id, status: "pending" });
    expect(JSON.parse(hits[1].body).data).toMatchObject({
      approvedBy: "auto",
      testimonial: { id, status: "approved", approvedBy: "auto" },
    });
  } finally {
    await new Promise<void>((r) => receiver.close(() => r()));
  }
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("the auto-approve settings fit and work at 375px", async ({ page, baseURL }) => {
    const api = await adminApi(baseURL!);
    const p = await createProject(api, "Phone Auto Co", slug("phone"));
    await signIn(page);
    await page.goto(`/admin/projects/${p.id}`);
    const panel = page.getByTestId("auto-approve");
    await panel.scrollIntoViewIfNeeded();
    for (const control of [
      panel.getByRole("checkbox", { name: "Approve new testimonials automatically" }),
      panel.getByRole("button", { name: "4 stars" }),
      panel.getByRole("button", { name: "5 stars" }),
      panel.getByRole("checkbox", { name: "Include video testimonials" }),
      panel.getByRole("button", { name: "Save auto-approve" }),
    ]) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }
    const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(widths.scroll).toBeLessThanOrEqual(widths.inner);

    await panel.getByRole("checkbox", { name: "Approve new testimonials automatically" }).check();
    await panel.getByRole("button", { name: "5 stars" }).click();
    await panel.getByRole("checkbox", { name: "Include video testimonials" }).check();
    await panel.getByRole("button", { name: "Save auto-approve" }).click();
    await expect(panel.getByRole("status")).toHaveText("Auto-approve is on for new testimonials");
    const saved = (await (await api.get(`/api/admin/projects/${p.id}`)).json()).project;
    expect(saved).toMatchObject({ autoApprove: true, autoApproveMinRating: 5, autoApproveVideo: true });

    // And it's remembered on the next visit.
    await page.reload();
    await expect(panel.getByRole("checkbox", { name: "Approve new testimonials automatically" })).toBeChecked();
    await expect(panel.getByRole("button", { name: "5 stars" })).toHaveAttribute("aria-pressed", "true");
  });
});
