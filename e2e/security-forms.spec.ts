import { expect, request as pwRequest, test, type Page } from "@playwright/test";
import { formProject } from "./form-helpers";
import { adminApi, signIn, startHostServer, useFreshIp } from "./helpers";

/**
 * M2 integration: forms keep the security rules. /f pages refuse framing,
 * only /embed/<project>/form/<form> can be framed, the public form carries
 * no owner-only rules, and the builder and the public pages run without a
 * single Content Security Policy violation or request to another site.
 */

test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

async function watchCsp(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { __csp?: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp!.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return () => page.evaluate(() => (window as Window & { __csp?: string[] }).__csp ?? []);
}

function offSite(page: Page, origin: string) {
  const seen: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!["data:", "blob:"].includes(u.protocol) && u.origin !== origin) seen.push(r.url());
  });
  return seen;
}

test("FORM-11 /f refuses framing and /embed/<p>/form/<f> allows it", async ({ baseURL }) => {
  const api = await adminApi(baseURL!);
  const { project, form, url } = await formProject(api, "Sec Forms Co");
  const hosted = await api.get(url);
  expect(hosted.status()).toBe(200);
  expect(hosted.headers()["x-frame-options"]).toBe("DENY");
  expect(hosted.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  const embed = await api.get(`/embed/${project.slug}/form/${form.slug}`);
  expect(embed.status()).toBe(200);
  expect(embed.headers()["x-frame-options"]).toBeUndefined();
  expect(embed.headers()["content-security-policy"]).toContain("frame-ancestors *");
  expect(embed.headers()["content-security-policy"]).toContain("connect-src 'self'");
  // The admin forms API needs a session.
  const anon = await pwRequest.newContext({ baseURL });
  expect((await anon.get(`/api/admin/forms/${form.id}`)).status()).toBe(401);
  expect((await anon.post(`/api/admin/projects/${project.id}/forms`, { data: { name: "x" } })).status()).toBe(401);
  await anon.dispose();
});

test("FORM-10 the public page carries no owner-only rules", async ({ baseURL, page }) => {
  const api = await adminApi(baseURL!);
  const { url } = await formProject(api, "Sec Rules Co", {
    settings: {
      autoTags: ["secret-tag"],
      confirmationEmail: { enabled: true, subject: "Private subject line", body: "Private body text" },
      maxPerIpPerDay: 7,
    },
  });
  const html = await (await page.request.get(url)).text();
  for (const secret of ["secret-tag", "Private subject line", "Private body text", "maxPerIpPerDay", "autoApprove", "enterprise"]) {
    expect(html, secret).not.toContain(secret);
  }
});

test("FORM-02 the builder and the public form run without CSP violations or off-site requests", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { project, form, url } = await formProject(api, "Sec Builder Co", { design: { headingFont: "geist", bodyFont: "newsreader" } });
  const violations = await watchCsp(page);
  const origin = new URL(baseURL!).origin;
  const away = offSite(page, origin);
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/forms/${form.id}`);
  await expect(page.getByTestId("form-preview")).toBeVisible();
  for (const tab of ["Design", "Settings", "Share"]) {
    await page.getByRole("tab", { name: tab }).click();
  }
  await expect(page.getByTestId("qr-preview")).toBeVisible();
  expect(await violations()).toEqual([]);
  await page.goto(url);
  await expect(page.getByTestId("form-runner")).toHaveAttribute("data-ready", "true");
  expect(await violations()).toEqual([]);
  expect(away).toEqual([]);
});

test("FORM-11 the embed runs inside another site without CSP violations", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const { project, form } = await formProject(api, "Sec Embed Co");
  const host = await startHostServer();
  try {
    host.pages["/"] = `<!doctype html><html><body><div data-plaudit-form="${form.slug}" data-project="${project.slug}"></div><script src="${baseURL}/form.js" async></script></body></html>`;
    const frameViolations: string[] = [];
    page.on("console", (m) => {
      if (/Content Security Policy/i.test(m.text())) frameViolations.push(m.text());
    });
    await page.goto(host.url);
    const frame = page.frameLocator("iframe");
    await expect(frame.getByTestId("form-runner")).toHaveAttribute("data-ready", "true");
    expect(frameViolations).toEqual([]);
  } finally {
    await host.close();
  }
});
