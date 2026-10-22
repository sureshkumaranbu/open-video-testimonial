import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { expect, request as pwRequest, test } from "@playwright/test";
import { adminApi, createProject, seed, signIn, useFreshIp } from "./helpers";

/** Settings: API keys used against the REST API, and signed webhooks. */

const RUN = Date.now().toString(36);

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

test("an API key created in Settings works against the REST API", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
  const admin = await adminApi(baseURL!);
  const p = await createProject(admin, "Api Co", `api-${RUN}`);
  await seed(admin, p.slug, [{ name: "Ivy Api", text: "Scriptable.", email: "ivy@example.com", status: "approved" }]);

  await signIn(page);
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.getByTestId("server-status")).toContainText("Video conversion");

  await page.getByLabel("Key name").fill("e2e read key");
  await page.getByRole("button", { name: "Create key" }).click();
  const key = (await page.getByTestId("new-api-key").locator("code").textContent())!;
  expect(key).toMatch(/^plk_/);
  await page.getByTestId("new-api-key").getByRole("button", { name: "Copy" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);

  const api = await pwRequest.newContext({ baseURL, extraHTTPHeaders: { authorization: `Bearer ${key}` } });
  const list = await api.get(`/api/v1/projects/${p.slug}/testimonials?status=approved`);
  expect(list.status()).toBe(200);
  const body = await list.json();
  expect(body.data).toHaveLength(1);
  expect(body.data[0].author).toMatchObject({ name: "Ivy Api", email: "ivy@example.com" });
  expect((await api.post(`/api/v1/projects/${p.slug}/testimonials`, { data: { name: "X", text: "Y", consent: true } })).status()).toBe(403);

  // The key shows when it was last used, and revoking it stops it working.
  await page.reload();
  const row = page.getByTestId("api-key-row").filter({ hasText: "e2e read key" });
  await expect(row).not.toContainText("never");
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(row).toHaveAttribute("data-revoked", "true");
  expect((await api.get("/api/v1/projects")).status()).toBe(401);

  const spec = await (await page.request.get("/api/v1/openapi.json")).json();
  expect(spec.info.title).toBe("Plaudit API");
});

test("a webhook receives a signed test event and real events", async ({ page, baseURL }) => {
  test.skip(
    process.env.E2E_SERVER_IN_CONTAINER === "true",
    "the app runs in a container and can't reach a receiver on the test machine's localhost",
  );
  // A receiver standing in for n8n/Zapier.
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
  const url = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook-${RUN}`;
  try {
    const admin = await adminApi(baseURL!);
    const p = await createProject(admin, "Hook Co", `hook-${RUN}`);

    await signIn(page);
    await page.goto("/admin/settings");
    await page.getByLabel("Endpoint URL").fill(url);
    await page.getByLabel("Project").selectOption({ label: "Hook Co" });
    await page.getByRole("checkbox", { name: "testimonial.approved" }).check();
    await page.getByRole("checkbox", { name: "testimonial.created" }).check();
    await page.getByRole("button", { name: "Add webhook" }).click();
    const hook = page.getByTestId("webhook").filter({ hasText: url });
    await expect(hook).toContainText("Hook Co · testimonial.created, testimonial.approved");
    await hook.getByRole("button", { name: "Reveal" }).click();
    const secret = (await hook.getByTestId("webhook-secret").textContent())!;

    await hook.getByRole("button", { name: "Send test event" }).click();
    await expect(hook.getByTestId("delivery").first()).toHaveAttribute("data-status", "success", { timeout: 15_000 });
    await expect(hook.getByTestId("delivery").first()).toContainText("204 OK");

    const [id] = await seed(admin, p.slug, [{ name: "Hal Hook", text: "Automated." }]);
    await admin.patch(`/api/admin/testimonials/${id}`, { data: { status: "approved" } });
    await expect.poll(() => hits.map((h) => h.headers["plaudit-event"]), { timeout: 15_000 }).toEqual([
      "ping",
      "testimonial.created",
      "testimonial.approved",
    ]);
    for (const hit of hits) {
      const [t, v1] = (hit.headers["plaudit-signature"] as string).split(",").map((s) => s.split("=")[1]);
      expect(crypto.createHmac("sha256", secret).update(`${t}.${hit.body}`).digest("hex")).toBe(v1);
    }
    expect(JSON.parse(hits[2].body).data.testimonial).toMatchObject({ id, status: "approved", author: { name: "Hal Hook" } });

    await page.reload();
    await expect(page.getByTestId("webhook").filter({ hasText: url }).getByTestId("delivery")).toHaveCount(3);
  } finally {
    await new Promise<void>((r) => receiver.close(() => r()));
  }
});
