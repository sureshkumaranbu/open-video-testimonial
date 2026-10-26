import { expect, test } from "@playwright/test";
import { adminApi, createProject, hostPage, seed, signIn, startHostServer, useFreshIp } from "./helpers";

/**
 * M5 SEO page (WP5.1): review snippets in both forms, the guidance shown
 * below five reviews, and the dynamic script working on another site.
 */

const RUN = Date.now().toString(36);
let host: Awaited<ReturnType<typeof startHostServer>>;

test.beforeAll(async () => {
  host = await startHostServer();
});
test.afterAll(async () => {
  await host.close();
});
test.beforeEach(async ({ page }) => {
  await useFreshIp(page);
});

/** The JSON inside a static snippet's <script type="application/ld+json"> block. */
const staticJson = (code: string) => JSON.parse(code.replace(/^<script type="application\/ld\+json">/, "").replace(/<\/script>$/, ""));

test("SEO-01 SEO-02 static and dynamic snippets validate, with guidance below 5 reviews", async ({ page, browser, baseURL }) => {
  const api = await adminApi(baseURL!);
  const project = await createProject(api, `Seo ${RUN}`, `seo-${RUN}`);
  await seed(api, project.slug, [
    { name: "Ada Lovelace", text: "Setup took </script> minutes.", rating: 5, status: "approved", email: "ada@private.example" },
    { name: "Grace Hopper", text: "Reports are clear.", rating: 4, status: "approved" },
    { name: "Alan Turing", text: "Good value.", rating: 5, status: "approved" },
    { name: "Pending Pete", text: "Not yet.", rating: 1 },
  ]);

  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/seo`);
  const form = page.getByTestId("snippet-form");
  await form.getByLabel("Snippet name").fill("Pricing page");
  await form.getByLabel("What’s being reviewed").selectOption("SoftwareApplication");
  await form.getByLabel("Its name").fill("Acme App");
  await form.getByLabel("Its page (optional)").fill("https://acme.example/pricing");
  await form.getByRole("button", { name: "Create snippet" }).click();

  const card = page.getByTestId("snippet");
  await expect(card).toHaveCount(1);
  await expect(card.getByTestId("snippet-count")).toHaveText("3 reviews");
  const guidance = card.getByTestId("snippet-guidance");
  await expect(guidance.locator('[data-level="warn"]')).toContainText("Only 3 reviews so far");
  await expect(guidance).toContainText("not on your home page");
  await expect(guidance).toContainText("search engine decides");
  await expect(card.getByTestId("snippet-preview")).toContainText("Rating: 4.7 · 3 reviews");
  await expect(card.getByTestId("snippet-preview")).toContainText("acme.example/pricing");

  // Dynamic: the script tag works on another site.
  const tag = await card.getByTestId("snippet-dynamic").locator("input").inputValue();
  expect(tag).toMatch(new RegExp(`^<script src="${baseURL}/schema/s_[a-z0-9]{12}\\.js" async></script>$`));
  host.pages["/product.html"] = hostPage("Product", tag);
  const visitor = await (await browser.newContext()).newPage();
  await visitor.goto(`${host.url}/product.html`);
  const injected = visitor.locator('head script[type="application/ld+json"][data-plaudit-schema]');
  await expect(injected).toHaveCount(1);
  const data = JSON.parse((await injected.textContent())!);
  expect(data).toMatchObject({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Acme App",
    url: "https://acme.example/pricing",
    aggregateRating: { "@type": "AggregateRating", ratingValue: 4.7, ratingCount: 3 },
  });
  expect(data.review).toHaveLength(3);
  expect(data.review.map((r: { author: { name: string } }) => r.author.name).sort()).toEqual(["Ada Lovelace", "Alan Turing", "Grace Hopper"]);
  expect(JSON.stringify(data)).not.toContain("private.example");
  await visitor.context().close();

  // Static: a ready-to-paste block of the same data, with the review's "</script>" escaped.
  await card.getByTestId("snippet-mode").getByRole("button", { name: /Static/ }).click();
  const code = await card.getByTestId("snippet-static").locator("textarea").inputValue();
  expect(code.match(/<\/script>/g)).toHaveLength(1);
  expect(code).toContain("\\u003c/script\\u003e");
  expect(staticJson(code)).toEqual(data);
});

test("SEO-02 no warning once there are 5 rated reviews; editing changes the scope", async ({ page, baseURL }) => {
  const api = await adminApi(baseURL!);
  const project = await createProject(api, `Seo5 ${RUN}`, `seo5-${RUN}`);
  await seed(
    api,
    project.slug,
    ["Ann", "Ben", "Cat", "Dan", "Eve"].map((name, i) => ({ name, text: `${name} is happy.`, rating: 5, status: "approved" as const, tags: i < 2 ? ["pro"] : [] })),
  );
  await signIn(page);
  await page.goto(`/admin/projects/${project.id}/seo`);
  const form = page.getByTestId("snippet-form");
  await form.getByLabel("Snippet name").fill("Everything");
  await form.getByRole("button", { name: "Create snippet" }).click();
  const card = page.getByTestId("snippet");
  await expect(card.getByTestId("snippet-count")).toHaveText("5 reviews");
  await expect(card.getByTestId("snippet-guidance").locator('[data-level="warn"]')).toHaveCount(0);

  await card.getByRole("button", { name: "Edit" }).click();
  const edit = page.getByTestId("snippet-form");
  await edit.getByTestId("snippet-scope").getByRole("button", { name: "Some tags" }).click();
  await edit.getByLabel("pro").check();
  await edit.getByRole("button", { name: "Save changes" }).click();
  await expect(card.getByTestId("snippet-count")).toHaveText("2 reviews");
  await expect(card.getByTestId("snippet-guidance").locator('[data-level="warn"]')).toContainText("Only 2 reviews");
});
