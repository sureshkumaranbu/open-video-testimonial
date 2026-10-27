import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const INT = path.join(ROOT, "integrations");
const read = (p: string) => fs.readFileSync(path.join(INT, p), "utf8");

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
