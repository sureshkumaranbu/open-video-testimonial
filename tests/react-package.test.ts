import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchWidgetHtml, formFrameUrl, PlauditForm, PlauditWidget, readFormMessage, serverOrigin, widgetHtmlUrl, widgetScript } from "../packages/react/src/index";

const PKG = path.resolve(__dirname, "../packages/react");
const ID = "w_abc123def456";

describe("INT-06 @plaudit/react on the server", () => {
  it("INT-06 PlauditWidget renders only its placeholder: no script runs on the server", () => {
    const html = renderToString(createElement(PlauditWidget, { server: "https://plaudit.example/", id: ID, className: "reviews" }));
    expect(html).toMatch(/^<div id="plaudit-[A-Za-z0-9_-]+" class="reviews" data-plaudit-widget="w_abc123def456"><\/div>$/);
    expect(html).not.toContain("<script");
  });

  it("INT-06 SEO mode puts the server HTML in the placeholder, for crawlers and readers without JavaScript", () => {
    const seo = '<section class="plaudit-seo"><blockquote>Six videos in a weekend</blockquote></section>';
    const html = renderToString(createElement(PlauditWidget, { server: "https://plaudit.example", id: ID, html: seo }));
    expect(html).toContain(seo);
  });

  it("INT-06 the script the browser gets: widget.js from the server, drawn into the placeholder by its id", () => {
    expect(widgetScript("https://plaudit.example/", ID, "plaudit-r1")).toEqual({ src: "https://plaudit.example/widget.js", widget: ID, target: "#plaudit-r1" });
    expect(widgetScript("javascript:alert(1)", ID, "x")).toBeNull();
    expect(widgetScript("https://plaudit.example", "w_bad", "x")).toBeNull();
    expect(serverOrigin("ftp://plaudit.example")).toBeNull();
    expect(widgetHtmlUrl("https://plaudit.example", ID, { jsonLd: true })).toBe(`https://plaudit.example/api/widget/${ID}/html?jsonld=1`);
  });

  it("INT-06 PlauditForm renders the iframe embed, with prefill and hidden fields in its address", () => {
    const html = renderToString(createElement(PlauditForm, { server: "https://plaudit.example", project: "acme", form: "stories", params: { utm_source: "app", name: "Ada L" } }));
    expect(html).toContain('src="https://plaudit.example/embed/acme/form/stories?utm_source=app&amp;name=Ada+L"');
    expect(html).toContain('allow="camera; microphone; clipboard-write"');
    expect(html).toContain('title="Share your experience"');
    expect(html).toContain("min-height:640px");
    expect(formFrameUrl("not a url", "acme", "stories")).toBeNull();
    expect(renderToString(createElement(PlauditForm, { server: "nope", project: "acme", form: "stories" }))).toBe("");
  });

  it("INT-06 only the form's own messages, from the Plaudit server, count", () => {
    const ok = { origin: "https://plaudit.example", data: { type: "plaudit:form-resize", form: "f1", slug: "stories", height: 812 } };
    expect(readFormMessage(ok, "https://plaudit.example", "stories")).toEqual(ok.data);
    expect(readFormMessage({ ...ok, origin: "https://evil.example" }, "https://plaudit.example", "stories")).toBeNull();
    expect(readFormMessage(ok, "https://plaudit.example", "other-form")).toBeNull();
    expect(readFormMessage({ ...ok, data: { ...ok.data, height: -1 } }, "https://plaudit.example", "stories")).toBeNull();
    expect(readFormMessage({ ...ok, data: "plaudit:form-submitted" }, "https://plaudit.example", "stories")).toBeNull();
  });
});

describe("INT-06 fetchWidgetHtml", () => {
  let server: http.Server;
  let base = "";
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === `/api/widget/${ID}/html?jsonld=1`) {
        res.writeHead(200, { "content-type": "text/html" });
        res.end("<ul><li>Great</li></ul><script type=\"application/ld+json\">{}</script>");
      } else {
        res.writeHead(404);
        res.end("");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it("INT-06 fetches the SEO include, and answers an empty string when anything goes wrong", async () => {
    expect(await fetchWidgetHtml(base, ID, { jsonLd: true })).toContain("<li>Great</li>");
    expect(await fetchWidgetHtml(base, ID)).toBe("");
    expect(await fetchWidgetHtml(base, "w_000000000000x")).toBe("");
    expect(await fetchWidgetHtml("http://127.0.0.1:9", ID, { timeoutMs: 500 })).toBe("");
  });
});

describe("INT-06 the package itself", () => {
  it("INT-06 is MIT, builds with tsc only, isn't published by accident, and stays out of the app's build", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(PKG, "package.json"), "utf8"));
    expect(pkg).toMatchObject({ name: "@plaudit/react", license: "MIT", private: true, scripts: { build: "tsc -p tsconfig.json" }, peerDependencies: { react: ">=18" } });
    expect(pkg.dependencies).toBeUndefined();
    expect(fs.readFileSync(path.join(PKG, "LICENSE"), "utf8")).toMatch(/^MIT License/);
    expect(fs.readFileSync(path.join(PKG, "README.md"), "utf8")).toContain("PlauditWidget");
    // The components are client components; the fetch helper isn't, so a server component can call it.
    expect(fs.readFileSync(path.join(PKG, "src/PlauditWidget.tsx"), "utf8")).toMatch(/^"use client";/);
    expect(fs.readFileSync(path.join(PKG, "src/html.ts"), "utf8")).not.toMatch(/^\s*["']use client/);
    const root = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
    expect(root.workspaces).toBeUndefined();
  });
});
