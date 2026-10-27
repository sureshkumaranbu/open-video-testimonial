import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openApiSpec } from "@/lib/openapi";
import { signatureHeader } from "@/lib/webhooks";

const ROOT = path.resolve(__dirname, "..");
const INT = path.join(ROOT, "integrations");
const read = (p: string) => fs.readFileSync(path.join(INT, p), "utf8");
const requireFrom = createRequire(path.join(INT, "zapier", "index.js"));

/** Whether `method path` (as a client sends it, query and all) is an operation in Plaudit's OpenAPI description. */
function inOpenApi(method: string, url: string) {
  const spec = openApiSpec("https://plaudit.example");
  const p = new URL(url).pathname.replace(/^\/api\/v1/, "");
  return Object.entries(spec.paths).some(([template, ops]) => {
    const re = new RegExp(`^${template.replace(/\{[^}]+\}/g, "[^/]+")}$`);
    return re.test(p) && method.toLowerCase() in (ops as object);
  });
}

const hasPhp = (() => {
  try {
    execFileSync("php", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("INT-05 WordPress plugin", () => {
  const plugin = (p: string) => read(`wordpress/plaudit/${p}`);

  it("INT-05 has the files WordPress.org expects, under GPL-2.0-or-later", () => {
    for (const f of ["plaudit.php", "readme.txt", "license.txt", "uninstall.php", "includes/render.php", "includes/settings.php", "includes/rest.php", "blocks/embed/block.json", "blocks/embed/index.js", "blocks/embed/index.asset.php"]) {
      expect(fs.existsSync(path.join(INT, "wordpress/plaudit", f)), f).toBe(true);
    }
    expect(plugin("plaudit.php")).toMatch(/\* License:\s+GPL-2\.0-or-later/);
    expect(plugin("plaudit.php")).toMatch(/\* Text Domain:\s+plaudit/);
    const readme = plugin("readme.txt");
    expect(readme).toMatch(/^=== Plaudit Testimonials ===/);
    for (const field of ["Requires at least:", "Tested up to:", "Requires PHP:", "Stable tag: 0.1.0", "License: GPLv2 or later"]) expect(readme).toContain(field);
    for (const section of ["== Description ==", "== Installation ==", "== Frequently Asked Questions ==", "== Changelog =="]) expect(readme).toContain(section);
    expect(readme).toMatch(/Caching and optimisation plugins/);
  });

  it("INT-05 the shortcode's attributes are the ones the docs name", () => {
    const defaults = /shortcode_atts\(\s*array\(([^)]*)\)/.exec(plugin("plaudit.php"))![1];
    const atts = [...defaults.matchAll(/'(\w+)'\s*=>\s*''/g)].map((m) => m[1]);
    expect(atts).toEqual(["widget", "form", "project", "seo", "height", "title"]);
    const docs = plugin("readme.txt") + fs.readFileSync(path.join(ROOT, "docs/help/wordpress.md"), "utf8");
    for (const a of atts) expect(docs, a).toMatch(new RegExp(`\\b${a}="`));
    expect(docs).toContain('[plaudit widget="w_abc123def456"]');
    expect(docs).toContain('[plaudit form="acme/stories"]');
  });

  it("INT-05 the block needs no build step: block.json, plain JavaScript and its dependencies by hand", () => {
    const block = JSON.parse(plugin("blocks/embed/block.json"));
    expect(block).toMatchObject({ apiVersion: 3, name: "plaudit/embed", editorScript: "file:./index.js", textdomain: "plaudit" });
    expect(Object.keys(block.attributes)).toEqual(["kind", "widget", "project", "form", "seo", "height"]);
    const js = plugin("blocks/embed/index.js");
    expect(js).toContain("registerBlockType( 'plaudit/embed'");
    expect(js).not.toMatch(/\bimport\b|<[A-Z]\w*[\s/>]/); // no modules, no JSX
    for (const dep of ["wp-blocks", "wp-element", "wp-block-editor", "wp-components", "wp-i18n", "wp-api-fetch"]) expect(plugin("blocks/embed/index.asset.php")).toContain(`'${dep}'`);
  });

  it("INT-05 settings check the nonce and capability, and the API key never reaches the page", () => {
    const settings = plugin("includes/settings.php");
    expect(settings).toContain("settings_fields( 'plaudit' )");
    expect(settings).toContain("check_admin_referer( 'plaudit_test' )");
    expect(settings.match(/current_user_can\( 'manage_options' \)/g)?.length).toBeGreaterThanOrEqual(2);
    // The key field is always rendered empty; only its first characters are hinted.
    expect(settings).toMatch(/name="plaudit_api_key" value=""/);
    expect(plugin("includes/rest.php")).toContain("current_user_can( 'edit_posts' )");
    expect(plugin("includes/render.php")).not.toContain("plaudit_api_key");
  });

  describe.skipIf(!hasPhp)("INT-05 with PHP installed", () => {
    it("INT-05 every PHP file passes php -l", () => {
      const files = ["plaudit.php", "uninstall.php", "includes/render.php", "includes/settings.php", "includes/rest.php", "blocks/embed/index.asset.php"];
      for (const f of files) {
        const run = spawnSync("php", ["-l", path.join(INT, "wordpress/plaudit", f)], { encoding: "utf8" });
        expect(run.status, `${f}: ${run.stdout}${run.stderr}`).toBe(0);
      }
    });

    it("INT-05 renders widgets with escaped attributes, cleans the SEO include, frames forms, and shows a broken embed only to editors", () => {
      const run = spawnSync("php", [path.join(INT, "wordpress/tests/render-harness.php")], { encoding: "utf8" });
      expect(run.status, run.stderr).toBe(0);
      const out = JSON.parse(run.stdout) as Record<string, string | number>;
      expect(out.widgetNoSeo).toBe(
        '<div class="plaudit-widget" id="plaudit-w_abc123def456-3" data-plaudit-widget="w_abc123def456"></div>' +
          '<script src="https://plaudit.example/widget.js" data-widget="w_abc123def456" data-target="#plaudit-w_abc123def456-3" async></script>',
      );
      expect(out.widget).toContain("<blockquote class=\"q\"><p>Great &amp; fast</p></blockquote>");
      expect(out.widget).not.toContain("alert(1)</script>");
      // A JSON-LD block that tries to close its tag is dropped; a good one is re-encoded so it can't.
      expect(out.widget).not.toContain("application/ld+json");
      expect(out.jsonLd).toContain('<script type="application/ld+json">{"@type":"Product","name":"Acme \\u003Cb\\u003E"}</script>');
      expect(out.fetchedOnce).toBe(1);
      expect(out.widgetAgain).toContain("Great &amp; fast");
      expect(out.form).toContain('src="https://plaudit.example/embed/acme/form/stories"');
      expect(out.form).toContain('title="Tell us &quot;more&quot;"');
      expect(out.form).toContain("min-height:4000px");
      expect(out.formSplit).toEqual((out.form as string).replace('Tell us &quot;more&quot;', "Share your experience").replace("4000px", "640px"));
      expect(out.block).toContain("min-height:720px");
      expect(out.badWidget).toBe("");
      expect(out.badWidgetEditor).toMatch(/^<p class="plaudit-notice"[^>]*>Plaudit: that isn’t a widget id/);
      expect(out.badWidgetEditor).not.toContain("<script");
      expect(out.badServer).toContain("set your Plaudit address");
      expect(out.toast).toContain('data-widget="w_toast0000000"');
    });
  });
});

describe("INT-03 Zapier, n8n and Make", () => {
  /** Runs a Zapier perform() against a stand-in for z.request and returns the requests it made. */
  async function runZap(file: string, exportName: string | null, inputData: Record<string, unknown>, respond: (url: string) => unknown = () => ({ data: [] })) {
    const mod = requireFrom(`./${file}`);
    const def = exportName ? mod[exportName] : mod;
    const calls: { method: string; url: string; json?: unknown }[] = [];
    const z = {
      request: async (o: { url: string; method?: string; json?: unknown }) => {
        calls.push({ method: o.method ?? "GET", url: o.url, json: o.json });
        return { status: 200, data: respond(o.url) };
      },
      errors: { Error: class extends Error {}, RefreshAuthError: class extends Error {} },
    };
    const result = await def.operation.perform(z, { authData: { server: "https://plaudit.example/", apiKey: "plk_x" }, inputData });
    return { calls, result };
  }

  it("INT-03 every Zapier trigger and action calls an operation in the OpenAPI description, with the key on every request", async () => {
    const cases: [string, string | null, Record<string, unknown>][] = [
      ["triggers/projects.js", null, {}],
      ["triggers/campaigns.js", null, { project: "acme" }],
      ["triggers/testimonial.js", "created", { project: "acme" }],
      ["triggers/testimonial.js", "approved", { project: "acme" }],
      ["triggers/feedback.js", null, { project: "acme" }],
      ["creates/testimonial.js", null, { project: "acme", name: "Ada", text: "Great", consent: "true", tags: ["sales"] }],
      ["creates/invite.js", null, { campaignId: "c1", email: "ada@example.com", delayDays: "3" }],
      ["creates/moderate.js", "approve", { testimonialId: "t1" }],
      ["creates/moderate.js", "tag", { testimonialId: "t1", tags: ["Pricing"] }],
    ];
    for (const [file, name, input] of cases) {
      const { calls } = await runZap(file, name, input, (url) => (url.includes("/testimonials/t1") ? { data: { id: "t1", tags: ["homepage"] } } : { data: [] }));
      expect(calls.length, file).toBeGreaterThan(0);
      for (const c of calls) expect(inOpenApi(c.method, c.url), `${file}: ${c.method} ${c.url}`).toBe(true);
    }
    const approved = await runZap("triggers/testimonial.js", "approved", { project: "acme" });
    expect(approved.calls[0].url).toBe("https://plaudit.example/api/v1/projects/acme/testimonials?limit=50&status=approved");
    const tag = await runZap("creates/moderate.js", "tag", { testimonialId: "t1", tags: ["Pricing"] }, () => ({ data: { id: "t1", tags: ["homepage"] } }));
    expect(tag.calls[1]).toMatchObject({ method: "PATCH", json: { tags: ["homepage", "pricing"] } });

    const index = read("zapier/index.js");
    expect(index).toContain("Authorization: `Bearer ${bundle.authData.apiKey}`");
    for (const f of ["triggers/projects", "triggers/campaigns", "triggers/testimonial", "triggers/feedback", "creates/testimonial", "creates/invite", "creates/moderate"]) expect(index).toContain(`require("./${f}")`);
  });

  it("INT-03 Create Testimonial refuses without the person's consent", async () => {
    await expect(runZap("creates/testimonial.js", null, { project: "acme", name: "Ada", text: "Great", consent: "false" })).rejects.toThrow(/consent/);
  });

  it("INT-03 the n8n workflow checks Plaudit's signature over the raw body before it posts anything", async () => {
    const flow = JSON.parse(read("n8n/plaudit-approved-to-slack.json"));
    expect(flow.nodes.map((n: { type: string }) => n.type)).toEqual(["n8n-nodes-base.webhook", "n8n-nodes-base.code", "n8n-nodes-base.slack"]);
    expect(flow.nodes[0].parameters.options.rawBody).toBe(true);
    const code = (flow.nodes[1].parameters.jsCode as string).replace("whsec_REPLACE_ME", "whsec_test");
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const run = (raw: string, header: string) =>
      new AsyncFunction("$input", "require", code).call(
        { helpers: { getBinaryDataBuffer: async () => Buffer.from(raw) } },
        { first: () => ({ json: { headers: { "plaudit-signature": header } } }) },
        createRequire(__filename),
      );
    const approved = JSON.stringify({ event: "testimonial.approved", data: { testimonial: { text: "Great" } } });
    expect(await run(approved, signatureHeader("whsec_test", approved))).toEqual([{ json: JSON.parse(approved) }]);
    const ping = JSON.stringify({ event: "ping" });
    expect(await run(ping, signatureHeader("whsec_test", ping))).toEqual([]);
    await expect(run(approved, signatureHeader("whsec_other", approved))).rejects.toThrow(/Bad Plaudit signature/);
    await expect(run(approved, signatureHeader("whsec_test", approved, Date.now() - 600_000))).rejects.toThrow(/timestamp/);
  });

  it("INT-03 the n8n and Make invite templates call POST /invites, and no template carries a real key", () => {
    const n8n = JSON.parse(read("n8n/plaudit-invite-after-purchase.json"));
    const http = n8n.nodes.find((n: { type: string }) => n.type === "n8n-nodes-base.httpRequest");
    expect(inOpenApi(http.parameters.method, http.parameters.url)).toBe(true);
    expect(http.parameters.genericAuthType).toBe("httpHeaderAuth");
    const make = JSON.parse(read("make/plaudit-invite-after-purchase.blueprint.json"));
    const call = make.flow.find((m: { module: string }) => m.module === "http:ActionSendData");
    expect(inOpenApi(call.mapper.method, call.mapper.url)).toBe(true);
    expect(make.metadata.scenario.confidential).toBe(true);
    for (const f of ["n8n/plaudit-approved-to-slack.json", "n8n/plaudit-invite-after-purchase.json", "make/plaudit-invite-after-purchase.blueprint.json"]) {
      expect(read(f), f).not.toMatch(/plk_[A-Za-z0-9_-]{20,}|whsec_(?!REPLACE_ME)[A-Za-z0-9_-]{10,}/);
    }
  });
});
