import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as feed } from "@/app/api/widget/[slug]/route";
import { PATCH as patchRoute } from "@/app/api/admin/widgets/[id]/route";
import { POST as previewRoute } from "@/app/api/admin/widgets/preview/route";
import { cssForWidget, MAX_CUSTOM_CSS, sanitizeCss } from "@/lib/custom-css";
import { createProject, createTestimonial, updateTestimonial } from "@/lib/testimonials";
import { createWidget, getWidget, widgetConfig, widgetToAdmin } from "@/lib/widgets";
import { adminHeaders, params, useTempDataDir } from "./helpers";

const ORIGIN = "https://plaudit.example";
let ctx: ReturnType<typeof useTempDataDir>;
let projectId: string;

beforeEach(() => {
  ctx = useTempDataDir();
  process.env.PUBLIC_URL = ORIGIN;
  projectId = createProject({ name: "Acme", slug: "acme" }).id;
  updateTestimonial(createTestimonial(projectId, { name: "Ada", text: "Great" }).id, { status: "approved" });
});
afterEach(() => {
  delete process.env.PUBLIC_URL;
  ctx.cleanup();
});

const clean = (css: string) => sanitizeCss(css, { origin: ORIGIN });

describe("DISP-08 custom CSS is cleaned", () => {
  it("DISP-08 can't close the style element or hide markup in comments", () => {
    expect(clean(".c{color:red}</style><script>alert(1)</script>")).toBe(".c{color:red}/style>script>alert(1)/script>");
    expect(clean(".c{color:red}<!-- x -->")).toBe(".c{color:red} x");
    expect(clean("/* </style> */.n{font-weight:700}")).toBe(".n{font-weight:700}");
    expect(clean(".c{}/* never closed </style>")).toBe(".c{}");
    expect(clean("<").includes("<")).toBe(false);
  });

  it("DISP-08 drops @import and every url() that isn't this server's, however it's spelled", () => {
    expect(clean('@import url("https://evil.example/x.css"); .c{color:red}')).toBe(".c{color:red}");
    expect(clean("@IMPORT 'https://evil.example/x.css';.c{}")).toBe(".c{}");
    expect(clean("@\\69mport 'https://evil.example/x.css';.c{}")).toBe("@69mport 'https://evil.example/x.css';.c{}");
    expect(clean(".c{background:url(https://evil.example/t.gif)}")).toBe(".c{background:none}");
    expect(clean('.c{background:URL( "//evil.example/t.gif" )}')).toBe(".c{background:none}");
    expect(clean(".c{background:u\\72l(https://evil.example/t.gif)}")).toBe(".c{background:u72l(https://evil.example/t.gif)}");
    expect(clean('.c{background:url("\\68ttps://evil.example/")}')).toBe(".c{background:none}");
    expect(clean(".c{background:url(data:image/png;base64,AAAA)}")).toBe(".c{background:none}");
    expect(clean(".c{background:image-set('https://evil.example/a.png' 1x)}")).toBe(".c{background:blocked-image-set('https://evil.example/a.png' 1x)}");
    expect(clean("@font-face{font-family:x;src:src('https://evil.example/f.woff2')}")).toContain("blocked-src(");
    expect(clean(".c{background:url(https://evil.example/a.png")).toBe(".c{background:blocked-url(https://evil.example/a.png");
  });

  it("DISP-08 keeps this server's own files, as paths, and makes them absolute for the widget", () => {
    expect(clean(".c{background:url(/api/media/images/a.png)}")).toBe('.c{background:url("/api/media/images/a.png")}');
    expect(clean(`.c{background:url('${ORIGIN}/fonts/x.woff2')}`)).toBe('.c{background:url("/fonts/x.woff2")}');
    expect(clean('.c{fill:url(#grad)} .q:before{content:"\\201C"}')).toBe('.c{fill:url("#grad")} .q:before{content:"\\201C"}');
    expect(cssForWidget(".c{background:url(/fonts/a.woff2)}", ORIGIN)).toBe(`.c{background:url("${ORIGIN}/fonts/a.woff2")}`);
  });

  it("DISP-08 caps the size", () => {
    expect(clean("a".repeat(MAX_CUSTOM_CSS * 3)).length).toBe(MAX_CUSTOM_CSS);
  });
});

describe("DISP-08 widgets carry it", () => {
  const patch = (id: string, config: unknown) =>
    patchRoute(new Request("http://localhost/x", { method: "PATCH", headers: { ...adminHeaders(), "content-type": "application/json" }, body: JSON.stringify({ config }) }), params({ id }));

  it("DISP-08 is stored cleaned, sent in the saved widget's payload, and never in the data-project feed", async () => {
    const w = createWidget(projectId, { name: "W", layout: "grid" });
    const cfg = widgetConfig(w);
    expect((await patch(w.id, { ...cfg, css: ".c{border:2px solid red;background:url(https://evil.example/x.png)}</style>" })).status).toBe(200);
    expect(getWidget(w.id)!.customCss).toBe(".c{border:2px solid red;background:none}/style>");
    expect(widgetToAdmin(getWidget(w.id)!).config.css).toBe(".c{border:2px solid red;background:none}/style>");
    const body = await (await feed(new Request(`http://localhost/api/widget/${w.id}`), params({ slug: w.id }))).json();
    expect(body.widget.css).toBe(".c{border:2px solid red;background:none}/style>");
    const legacy = await (await feed(new Request("http://localhost/api/widget/acme"), params({ slug: "acme" }))).json();
    expect(Object.keys(legacy)).toEqual(["project", "testimonials"]);
    expect((await patch(w.id, { ...cfg, css: "x".repeat(MAX_CUSTOM_CSS + 1) })).status).toBe(400);
  });

  it("DISP-08 the studio preview applies unsaved CSS, cleaned the same way", async () => {
    const w = createWidget(projectId, { name: "W", layout: "list" });
    const res = await previewRoute(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { ...adminHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ projectId, config: { ...widgetConfig(w), css: "@import 'https://evil.example/a.css'; .n{color:#c00}" } }),
      }),
    );
    expect((await res.json()).widget.css).toBe(".n{color:#c00}");
  });
});
