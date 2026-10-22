import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { adminApi, createProject, signIn, useFreshIp } from "./helpers";

/**
 * Personal request links, invitation and reminder emails, unsubscribe and
 * receipts. The test server writes emails to .e2e-data/mail-outbox
 * (MAIL_OUTBOX=true), so these skip against servers that really send mail.
 */

const RUN = Date.now().toString(36);
const OUTBOX = path.resolve(__dirname, "..", ".e2e-data", "mail-outbox");

function decode(raw: string) {
  const body = raw.split(/\r?\n\r?\n/).slice(1).join("\n\n");
  return /quoted-printable/i.test(raw)
    ? Buffer.from(body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8")
    : body;
}

/** Waits for an email to `to` whose subject matches, and returns its decoded text. */
async function waitForMail(to: string, subject: RegExp) {
  let found = "";
  await expect
    .poll(
      () => {
        if (!fs.existsSync(OUTBOX)) return false;
        for (const file of fs.readdirSync(OUTBOX).sort()) {
          const raw = fs.readFileSync(path.join(OUTBOX, file), "utf8");
          const head = raw.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ");
          if (head.includes(`To: ${to}`) && subject.test(head)) {
            found = decode(raw);
            return true;
          }
        }
        return false;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return found;
}

test.beforeEach(async ({ page, baseURL }) => {
  await useFreshIp(page);
  const system = await (await (await adminApi(baseURL!)).get("/api/admin/system")).json();
  test.skip(system.email.mode !== "outbox", "needs MAIL_OUTBOX=true to read emails");
});

test("invite, prefilled link, response, receipt and unsubscribe", async ({ page, context, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL! });
  const api = await adminApi(baseURL!);
  const p = await createProject(api, "Request Co", `req-${RUN}`);
  const rae = `rae+${RUN}@example.com`;
  const sam = `sam+${RUN}@example.com`;

  await signIn(page);
  await page.goto(`/admin/projects/${p.id}`);
  await page.getByRole("navigation", { name: "Project sections" }).getByRole("link", { name: "Requests" }).click();
  await expect(page.getByRole("heading", { name: "Requests", level: 1 })).toBeVisible();
  await expect(page.getByTestId("email-on")).toContainText("Test mode");

  // Custom wording first.
  await page.getByLabel("Subject").fill("{name}, got two minutes for {project}?");
  await page.getByRole("button", { name: "Save email settings" }).click();
  await expect(page.getByText("Email settings saved")).toBeVisible();

  await page.getByRole("textbox", { name: /^People/ }).fill(`Rae Requested, ${rae}, Raeco\nnot-an-address`);
  await page.getByRole("button", { name: "Add and send" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 1 person" })).toContainText("Couldn't read: not-an-address");
  const row = page.getByTestId("request-row").filter({ hasText: "Rae Requested" });
  await expect(row).toHaveAttribute("data-email-status", "sent", { timeout: 20_000 });
  await expect(row).toContainText(/Sent .* · next /);

  const invite = await waitForMail(rae, /Subject: Rae, got two minutes for Request Co\?/);
  const link = /http:\/\/\S+\/c\/\S+\?r=\S+/.exec(invite)![0];
  await row.getByRole("button", { name: "Copy link" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  expect(invite).toMatch(/To stop these emails: http:\/\/\S+\/u\/\S+/);

  // The link opens a prefilled form.
  await page.goto(link);
  await expect(page.getByLabel("Your name")).toHaveValue("Rae Requested");
  await expect(page.getByLabel(/^Email/)).toHaveValue(rae);
  await expect(page.getByLabel("Company")).toHaveValue("Raeco");
  await page.getByLabel("Your testimonial").fill("They asked nicely and it took a minute.");
  await page.getByLabel(/I agree/).check();
  await page.getByRole("button", { name: "Submit testimonial" }).click();
  await expect(page.getByTestId("withdraw-note")).toBeVisible();

  // A receipt with the withdrawal link arrives.
  const receipt = await waitForMail(rae, /Subject: Thanks for your testimonial for Request Co/);
  expect(receipt).toMatch(/\/w\/[\w-]{32}/);

  await page.goto(`/admin/projects/${p.id}/requests`);
  await expect(page.getByTestId("request-row").filter({ hasText: "Rae Requested" })).toHaveAttribute("data-status", "responded");
  await page.goto(`/admin/projects/${p.id}`);
  await expect(page.getByTestId("admin-testimonial").filter({ hasText: "Rae Requested" }).getByText("Requested", { exact: true })).toBeVisible();

  // Someone else unsubscribes from the email.
  await page.goto(`/admin/projects/${p.id}/requests`);
  await page.getByTestId("recipients-file").setInputFiles({
    name: "people.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`Email,Name\n${sam},Sam Skip\n`),
  });
  await expect(page.getByRole("textbox", { name: /^People/ })).toHaveValue(`Email,Name\n${sam},Sam Skip\n`);
  await page.getByRole("button", { name: "Add and send" }).click();
  const unsubscribe = /http:\/\/\S+\/u\/\S+/.exec(await waitForMail(sam, /Subject: Sam, got two minutes/))![0];
  await page.goto(unsubscribe);
  await expect(page.getByRole("heading", { name: "Stop emails from Request Co?" })).toBeVisible();
  await page.getByRole("button", { name: "Stop these emails" }).click();
  await expect(page.getByRole("status")).toContainText("won't get any more emails");
  await page.reload();
  await expect(page.getByRole("heading", { name: "You're unsubscribed" })).toBeVisible();

  await page.goto(`/admin/projects/${p.id}/requests`);
  const sam_row = page.getByTestId("request-row").filter({ hasText: "Sam Skip" });
  await expect(sam_row).toHaveAttribute("data-status", "unsubscribed");
  await expect(sam_row.getByRole("button", { name: /Send/ })).toHaveCount(0);

  // Asking an unsubscribed person again is skipped.
  await page.getByRole("textbox", { name: /^People/ }).fill(sam);
  await page.getByRole("button", { name: "Add and send" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Added 0 people" })).toContainText("(unsubscribed)");
});
