import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, errorMessage, isApiError } from "@/app/admin/api";
import {
  ActiveFilters,
  BulkBar,
  Checkbox,
  clampPage,
  ColorField,
  ConfirmDialog,
  contrastRatio,
  copyText,
  CopyField,
  describeRun,
  DEVICE_WIDTHS,
  DevicePreview,
  Drawer,
  EmptyState,
  Field,
  FilterChips,
  fitScale,
  FontField,
  fontFamilyOf,
  formatRatio,
  keepListed,
  leavesPage,
  Modal,
  normalizeHex,
  pageCount,
  pageItems,
  pageRange,
  Pager,
  ProgressBar,
  readableOn,
  RunProgressView,
  SearchField,
  Segmented,
  selectRange,
  selectState,
  Tabs,
  Toast,
  Toggle,
  toggleAll,
  toggleId,
  toggleValue,
  Toolbar,
  UnsavedGuard,
  type ColorFieldProps,
  type CopyFieldProps,
  type DevicePreviewProps,
  type DrawerProps,
  type EmptyStateProps,
  type FontFieldProps,
  type ModalProps,
  type PagerProps,
  type ToolbarProps,
  type UnsavedGuardProps,
} from "@/components/admin";
import { isRowKey, nextIndex, ownsArrowKeys } from "@/components/admin/keys";

/**
 * The admin UI kit (WP1.7). The vitest environment has no DOM, so this covers
 * the pure helpers, the api() client against a stubbed fetch, and each
 * component's server-rendered markup: roles, labels and the ids that tie a
 * control to its label, hint and error.
 */

const html = (el: ReactElement) => renderToStaticMarkup(el);
const noop = () => {};
/** The value of `attr` on the first tag matching `tag` (a regex source). */
function attr(markup: string, tag: string, name: string) {
  const el = new RegExp(`<${tag}[^>]*>`).exec(markup)?.[0] ?? "";
  return new RegExp(`\\s${name}="([^"]*)"`).exec(el)?.[1];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api()", () => {
  function stubFetch(res: () => Response | Promise<Response>) {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => res());
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("sends `json` as a JSON body and returns the parsed response", async () => {
    const fetch = stubFetch(() => Response.json({ project: { id: "p1" } }, { status: 201 }));
    const out = await api<{ project: { id: string } }>("/api/admin/projects", { method: "POST", json: { name: "Acme" } });
    expect(out.project.id).toBe("p1");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/admin/projects");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"name":"Acme"}');
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("labels string bodies as JSON, leaves FormData alone, and keeps the caller's Content-Type", async () => {
    const fetch = stubFetch(() => Response.json({}));
    await api("/a", { method: "PATCH", body: JSON.stringify({ a: 1 }) });
    await api("/b", { method: "POST", body: new FormData() });
    await api("/c", { method: "POST", body: "a=1", headers: { "Content-Type": "text/plain" } });
    await api("/d");
    const type = (i: number) => new Headers(fetch.mock.calls[i][1]?.headers).get("content-type");
    expect(type(0)).toBe("application/json");
    expect(type(1)).toBeNull();
    expect(type(2)).toBe("text/plain");
    expect(type(3)).toBeNull();
  });

  it("throws the server's message with the status and body", async () => {
    stubFetch(() => Response.json({ error: "Slug taken", slug: "acme" }, { status: 409 }));
    const err = (await api("/x", { method: "POST", json: {} }).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe("Slug taken");
    expect(err.status).toBe(409);
    expect(err.data).toEqual({ error: "Slug taken", slug: "acme" });
    expect(isApiError(err)).toBe(true);
    expect(isApiError(err, 409)).toBe(true);
    expect(isApiError(err, 404)).toBe(false);
  });

  it("falls back to a message that says what to do when the server sends none", async () => {
    stubFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));
    await expect(api("/x")).rejects.toThrow("Something went wrong on the server. Try again in a moment.");
    stubFetch(() => new Response("", { status: 401 }));
    await expect(api("/x")).rejects.toThrow("You're signed out. Sign in again to carry on.");
    stubFetch(() => Response.json({ error: "" }, { status: 418 }));
    await expect(api("/x")).rejects.toThrow("Request failed (418). Try again.");
  });

  it("turns a network failure into status 0 and passes a cancellation through", async () => {
    stubFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    const err = (await api("/x").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/Check your connection/);

    const abort = new DOMException("The operation was aborted.", "AbortError");
    stubFetch(() => Promise.reject(abort));
    await expect(api("/x")).rejects.toBe(abort);
  });

  it("refuses a success it can't read, and passes a cancellation during the body through", async () => {
    stubFetch(() => new Response("<html>Sign in to the proxy</html>", { status: 200, headers: { "content-type": "text/html" } }));
    const err = (await api("/x").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(200);
    expect(err.message).toMatch(/Reload the page/);

    const abort = new DOMException("The operation was aborted.", "AbortError");
    const cut = new ReadableStream({ start: (c) => c.error(abort) });
    stubFetch(() => new Response(cut, { status: 200 }));
    await expect(api("/x")).rejects.toBe(abort);
    stubFetch(() => new Response(new ReadableStream({ start: (c) => c.error(new TypeError("network error")) }), { status: 200 }));
    await expect(api("/x")).rejects.toThrow(/Reload the page/);
  });

  it("returns an empty object for an empty success", async () => {
    stubFetch(() => new Response(null, { status: 204 }));
    expect(await api("/x", { method: "DELETE" })).toEqual({});
  });

  it("errorMessage() reads any thrown value", () => {
    expect(errorMessage(new ApiError(400, "Name is required"))).toBe("Name is required");
    expect(errorMessage("nope")).toBe("Something went wrong. Try again.");
    expect(errorMessage(null, "Couldn't save.")).toBe("Couldn't save.");
  });
});

describe("paging", () => {
  it("counts pages, at least one", () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
    expect(pageCount(312, 25)).toBe(13);
    expect(pageCount(10, 0)).toBe(1);
  });

  it("keeps a page in range", () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(9, 5)).toBe(5);
    expect(clampPage(2.7, 5)).toBe(2);
    expect(clampPage(Number.NaN, 5)).toBe(1);
  });

  it("gives the item numbers a page shows", () => {
    expect(pageRange(2, 25, 312)).toEqual({ from: 26, to: 50 });
    expect(pageRange(13, 25, 312)).toEqual({ from: 301, to: 312 });
    expect(pageRange(99, 25, 312)).toEqual({ from: 301, to: 312 });
    expect(pageRange(1, 25, 0)).toEqual({ from: 0, to: 0 });
  });

  it("lists every page when they fit, and the same number of slots when they don't", () => {
    expect(pageItems(1, 1)).toEqual([1]);
    expect(pageItems(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageItems(1, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
    expect(pageItems(4, 20)).toEqual([1, 2, 3, 4, 5, "gap", 20]);
    expect(pageItems(10, 20)).toEqual([1, "gap", 9, 10, 11, "gap", 20]);
    expect(pageItems(17, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
    expect(pageItems(20, 20)).toEqual([1, "gap", 16, 17, 18, 19, 20]);
    for (let p = 1; p <= 30; p++) {
      const items = pageItems(p, 30);
      expect(items).toHaveLength(7);
      expect(items).toContain(p);
      // A gap always hides at least two pages.
      items.forEach((it, i) => {
        if (it === "gap") expect((items[i + 1] as number) - (items[i - 1] as number)).toBeGreaterThan(2);
      });
    }
  });
});

describe("colours", () => {
  it("normalises hex colours and refuses anything else", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("3d63dd")).toBe("#3d63dd");
    expect(normalizeHex("  #3D63DD ")).toBe("#3d63dd");
    for (const bad of ["", "#12", "#12345", "#1234567", "red", "#ggg", "rgb(0 0 0)"]) expect(normalizeHex(bad)).toBeNull();
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000", "#fff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#fff", "#fff")).toBeCloseTo(1, 5);
    // #767676 is the classic lightest grey that passes AA on white.
    expect(contrastRatio("#767676", "#ffffff")!).toBeGreaterThan(4.5);
    expect(contrastRatio("#777777", "#ffffff")!).toBeLessThan(4.5);
    expect(contrastRatio("#fff", "nope")).toBeNull();
  });

  it("rounds a ratio down, so a near miss never reads as a pass", () => {
    expect(formatRatio(4.499)).toBe("4.4:1");
    expect(formatRatio(21)).toBe("21.0:1");
  });

  it("picks black or white text for a background", () => {
    expect(readableOn("#ffffff")).toBe("#000000");
    expect(readableOn("#161b2e")).toBe("#ffffff");
    expect(readableOn("#f2a93b")).toBe("#000000");
  });
});

describe("keyboard helpers", () => {
  it("moves along a row, wrapping and skipping disabled items", () => {
    expect(nextIndex(0, "ArrowRight", 3)).toBe(1);
    expect(nextIndex(2, "ArrowRight", 3)).toBe(0);
    expect(nextIndex(0, "ArrowLeft", 3)).toBe(2);
    expect(nextIndex(0, "ArrowRight", 4, { disabled: (i) => i === 1 })).toBe(2);
    expect(nextIndex(1, "Home", 4, { disabled: (i) => i === 0 })).toBe(1);
    expect(nextIndex(1, "End", 4, { disabled: (i) => i === 3 })).toBe(2);
    expect(nextIndex(0, "ArrowRight", 3, { rtl: true })).toBe(2);
    expect(nextIndex(0, "ArrowDown", 3)).toBe(0);
    expect(nextIndex(0, "ArrowDown", 3, { vertical: true })).toBe(1);
    expect(nextIndex(1, "ArrowRight", 3, { disabled: (i) => i !== 1 })).toBe(1);
    expect(nextIndex(0, "Home", 0)).toBe(-1);
    expect(isRowKey("Tab")).toBe(false);
  });

  it("leaves arrow keys to text boxes, selects and radios", () => {
    expect(ownsArrowKeys({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(ownsArrowKeys({ tagName: "INPUT", type: "search" })).toBe(true);
    expect(ownsArrowKeys({ tagName: "INPUT", type: "radio" })).toBe(true);
    expect(ownsArrowKeys({ tagName: "SELECT" })).toBe(true);
    expect(ownsArrowKeys({ tagName: "DIV", isContentEditable: true })).toBe(true);
    expect(ownsArrowKeys({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(ownsArrowKeys({ tagName: "BUTTON" })).toBe(false);
    expect(ownsArrowKeys(null)).toBe(false);
  });
});

describe("selection", () => {
  const ids = ["a", "b", "c", "d"];

  it("toggles without changing the set it was given", () => {
    const start = new Set(["a"]);
    const next = toggleId(start, "b");
    expect([...start]).toEqual(["a"]);
    expect([...next].sort()).toEqual(["a", "b"]);
    expect([...toggleId(next, "a")]).toEqual(["b"]);
  });

  it("selects all of a page, then clears it, leaving other pages' rows alone", () => {
    const other = new Set(["z"]);
    const all = toggleAll(other, ids);
    expect([...all].sort()).toEqual(["a", "b", "c", "d", "z"]);
    expect([...toggleAll(all, ids)]).toEqual(["z"]);
    expect([...toggleAll(new Set(), [])]).toEqual([]);
  });

  it("says whether none, some or all rows on screen are selected", () => {
    expect(selectState(new Set(), ids)).toBe("none");
    expect(selectState(new Set(["b"]), ids)).toBe("some");
    expect(selectState(new Set(ids), ids)).toBe("all");
    expect(selectState(new Set(["z"]), ids)).toBe("none");
  });

  it("selects a shift-click range in either direction", () => {
    expect([...selectRange(new Set(), ids, "b", "d", true)].sort()).toEqual(["b", "c", "d"]);
    expect([...selectRange(new Set(ids), ids, "c", "a", false)]).toEqual(["d"]);
    expect([...selectRange(new Set(), ids, "gone", "c", true)]).toEqual(["c"]);
  });

  it("drops rows that are no longer listed", () => {
    expect([...keepListed(new Set(["a", "x"]), ids)]).toEqual(["a"]);
  });

  it("toggles chip values, one at a time when single", () => {
    expect(toggleValue(["video"], "text")).toEqual(["video", "text"]);
    expect(toggleValue(["video", "text"], "video")).toEqual(["text"]);
    expect(toggleValue(["video"], "text", true)).toEqual(["text"]);
    expect(toggleValue(["text"], "text", true)).toEqual([]);
  });
});

describe("leavesPage()", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  const a = (href: string, target = "", attrs: string[] = []) => ({ href, target, hasAttribute: (n: string) => attrs.includes(n) });
  const here = "https://plaudit.test/admin/projects/p1/forms/f1?tab=design";

  it("counts in-app and external links that replace this page", () => {
    expect(leavesPage(click, a("/admin/projects/p1"), here)).toBe(true);
    expect(leavesPage(click, a("https://example.com/"), here)).toBe(true);
    expect(leavesPage(click, a("/admin/projects/p1/forms/f1?tab=share"), here)).toBe(true);
    expect(leavesPage(click, a("x", "_self"), here)).toBe(true);
  });

  it("ignores new tabs, downloads, modified clicks, other apps and same-page jumps", () => {
    expect(leavesPage(click, a("/admin", "_blank"), here)).toBe(false);
    expect(leavesPage(click, a("/export.zip", "", ["download"]), here)).toBe(false);
    expect(leavesPage({ ...click, metaKey: true }, a("/admin"), here)).toBe(false);
    expect(leavesPage({ ...click, button: 1 }, a("/admin"), here)).toBe(false);
    expect(leavesPage({ ...click, defaultPrevented: true }, a("/admin"), here)).toBe(false);
    expect(leavesPage(click, a("mailto:owner@example.com"), here)).toBe(false);
    expect(leavesPage(click, a("#preview"), here)).toBe(false);
    expect(leavesPage(click, a(here), here)).toBe(false);
    expect(leavesPage(click, null, here)).toBe(false);
  });
});

describe("small helpers", () => {
  it("copyText() uses the Clipboard API and reports a refusal", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");

    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    // No DOM here, so the execCommand fallback can't run either.
    expect(await copyText("hello")).toBe(false);
    vi.stubGlobal("navigator", {});
    expect(await copyText("hello")).toBe(false);
  });

  it("fitScale() only ever shrinks", () => {
    expect(fitScale(1200, 600)).toBe(0.5);
    expect(fitScale(375, 900)).toBe(1);
    expect(fitScale(1200, 0)).toBe(1);
    expect(DEVICE_WIDTHS).toEqual({ desktop: 1200, tablet: 768, mobile: 375 });
  });

  it("fontFamilyOf() quotes the label safely, or uses the given family", () => {
    expect(fontFamilyOf({ id: "inter", label: "Inter" })).toBe('"Inter", system-ui, sans-serif');
    expect(fontFamilyOf({ id: "x", label: 'Odd "Name"\\', fallback: "serif" })).toBe('"Odd Name", serif');
    expect(fontFamilyOf({ id: "x", label: "X", family: "var(--font-voice)" })).toBe("var(--font-voice)");
  });

  it("describeRun() lists the counts that aren't zero", () => {
    expect(describeRun({ total: 50, done: 12, duplicates: 3, skipped: 0, failed: 1 })).toBe("12 of 50 · 3 already there · 1 failed");
    expect(describeRun({ total: 0, done: 0, duplicates: 0, skipped: 0, failed: 0 })).toBe("0 done");
  });
});

describe("overlays", () => {
  it("render nothing while closed", () => {
    expect(html(h(Modal, { open: false, onClose: noop, title: "Rename", children: "x" }))).toBe("");
    expect(html(h(Drawer, { open: false, onClose: noop, title: "Detail", children: "x" }))).toBe("");
    expect(html(h(ConfirmDialog, { open: false, onClose: noop, onConfirm: noop, title: "Delete?" }))).toBe("");
  });

  it("a Modal is a dialog named by its title, with a labelled Close button", () => {
    const m = html(
      h(Modal, {
        open: true,
        onClose: noop,
        title: "Rename tag",
        description: "Every testimonial with this tag gets the new name.",
        size: "sm",
        testId: "rename",
        footer: h("button", { type: "submit" }, "Save"),
        onSubmit: noop,
        children: h("input", { "aria-label": "Name" }),
      }),
    );
    const titleId = attr(m, "dialog", "aria-labelledby");
    const descId = attr(m, "dialog", "aria-describedby");
    expect(titleId).toBeTruthy();
    expect(m).toContain(`<h2 id="${titleId}">Rename tag</h2>`);
    expect(m).toContain(`id="${descId}"`);
    expect(attr(m, "dialog", "class")).toBe("ak-overlay ak-modal");
    expect(attr(m, "dialog", "data-size")).toBe("sm");
    expect(attr(m, "dialog", "data-testid")).toBe("rename");
    expect(m).toContain('aria-label="Close"');
    // onSubmit wraps body and footer in one form, so the footer's submit button works.
    expect(m).toMatch(/<form class="ak-overlay-panel">[\s\S]*Save[\s\S]*<\/form>/);
  });

  it("a Drawer docks at the side, with extra header controls before Close", () => {
    const d = html(
      h(Drawer, {
        open: true,
        onClose: noop,
        title: "Testimonial",
        width: "lg",
        headerActions: h("button", { type: "button" }, "Next"),
        children: "Body",
      }),
    );
    expect(attr(d, "dialog", "class")).toBe("ak-overlay ak-drawer");
    expect(attr(d, "dialog", "data-size")).toBe("lg");
    expect(d.indexOf(">Next<")).toBeLessThan(d.indexOf('aria-label="Close"'));
    expect(html(h(Drawer, { open: true, onClose: noop, title: "T", children: "x" }))).toContain('data-size="md"');
  });

  it("ConfirmDialog starts on Cancel, or on the box to type in, and keeps the button off until it matches", () => {
    const plain = html(h(ConfirmDialog, { open: true, onClose: noop, onConfirm: noop, title: "Move to trash?", confirmLabel: "Move" }));
    expect(plain).toMatch(/<button[^>]*data-autofocus="true"[^>]*>Cancel<\/button>/);
    expect(plain).toMatch(/<button type="submit">Move<\/button>/);

    const typed = html(
      h(ConfirmDialog, {
        open: true,
        onClose: noop,
        onConfirm: noop,
        title: "Delete Acme?",
        danger: true,
        requireText: "Acme",
        confirmLabel: "Delete project",
        children: "This deletes every testimonial and file.",
      }),
    );
    expect(typed).toMatch(/<button type="button" class="secondary">Cancel<\/button>/);
    expect(typed).toMatch(/<input type="text"[^>]*data-autofocus="true"/);
    expect(typed).toMatch(/<button type="submit" class="ak-danger" disabled="">Delete project<\/button>/);
    expect(typed).toContain('<strong class="ak-confirm-word">Acme</strong>');
  });
});

describe("lists: toolbar, pager, tabs, chips, bulk bar", () => {
  it("Toolbar is a named toolbar", () => {
    const t = html(h(Toolbar, { label: "Filter testimonials", children: h("button", null, "Sort") }));
    expect(t).toMatch(/^<div role="toolbar" aria-label="Filter testimonials" aria-orientation="horizontal" class="ak-toolbar">/);
  });

  it("Pager says what's showing and marks the current page", () => {
    expect(html(h(Pager, { page: 1, pageSize: 25, total: 0, onPage: noop }))).toBe("");
    const p = html(h(Pager, { page: 2, pageSize: 25, total: 1312, onPage: noop, pageSizes: [25, 50, 100], onPageSize: noop }));
    expect(p).toMatch(/^<nav class="ak-pager" aria-label="Pages">/);
    expect(p).toContain('<span class="visually-hidden">Showing </span>26–50 of 1,312');
    expect(p).toMatch(/<button type="button" class="ghost small" aria-label="Page 2" aria-current="page">2<\/button>/);
    expect(p).not.toMatch(/aria-label="Previous page" disabled/);
    expect(p).toContain('<span class="ak-pager-compact">Page 2 of 53</span>');
    expect(p).toMatch(/<select id="[^"]+"><option value="25" selected="">25<\/option>/);

    const first = html(h(Pager, { page: 1, pageSize: 25, total: 60, onPage: noop }));
    expect(first).toMatch(/<button type="button" class="secondary small" disabled="" aria-label="Previous page">/);
    // One page: the count only.
    const one = html(h(Pager, { page: 1, pageSize: 25, total: 3, onPage: noop }));
    expect(one).not.toContain("<button");
    expect(one).toContain("1–3 of 3");
  });

  it("Tabs follow the ARIA tabs pattern", () => {
    const tabs = [
      { id: "content", label: "Content" },
      { id: "design", label: "Design" },
      { id: "share", label: "Share", disabled: true },
    ];
    const t = html(h(Tabs, { label: "Form builder", tabs, value: "design", onChange: noop, children: "Design panel" }));
    expect(t).toContain('role="tablist" aria-label="Form builder"');
    const design = /<button id="([^"]+)" type="button" role="tab" aria-selected="true" aria-controls="([^"]+)" tabindex="0">Design<\/button>/.exec(t);
    expect(design).not.toBeNull();
    expect(t).toMatch(/role="tab" aria-selected="false" tabindex="-1">Content</);
    expect(t).toMatch(/role="tab" aria-selected="false" tabindex="-1" disabled="">Share</);
    expect(t).toContain(`<div id="${design![2]}" role="tabpanel" aria-labelledby="${design![1]}" tabindex="0" class="ak-tabpanel">Design panel</div>`);

    // Without a panel, no tab points at one; a stale value still leaves one tab in the Tab order.
    const row = html(h(Tabs, { label: "Views", tabs, value: "gone", onChange: noop }));
    expect(row).not.toContain("aria-controls");
    expect(row).not.toContain('role="tabpanel"');
    expect(row).toMatch(/aria-selected="true"[^>]*tabindex="0">Content</);
  });

  it("Segmented and FilterChips are pressed-state button groups", () => {
    const s = html(
      h(Segmented, {
        label: "View",
        options: [
          { value: "table", label: "Table" },
          { value: "cards", label: "Cards", count: 4 },
        ],
        value: "cards",
        onChange: noop,
      }),
    );
    expect(s).toContain('class="segmented" role="group" aria-label="View"');
    expect(s).toMatch(/aria-pressed="false">Table</);
    expect(s).toMatch(/aria-pressed="true">Cards<span class="count">4<\/span>/);

    const c = html(
      h(FilterChips, {
        label: "Type",
        chips: [
          { id: "video", label: "Video", icon: "video" },
          { id: "text", label: "Text" },
        ],
        selected: ["text"],
        onChange: noop,
      }),
    );
    expect(c).toContain('role="group" aria-label="Type"');
    expect(c).toMatch(/aria-pressed="false"><svg[^>]*><path d="M3\.5 7\.5[^"]*"><\/path><\/svg>Video/);
    // The pressed chip shows a tick, not only a fill.
    expect(c).toMatch(/aria-pressed="true"><svg[^>]*><path d="M5 12\.5l4\.5 4\.5L19 7\.5"><\/path><\/svg>Text/);
  });

  it("ActiveFilters names each remove button after its filter", () => {
    expect(html(h(ActiveFilters, { filters: [], onRemove: noop }))).toBe("");
    const one = html(h(ActiveFilters, { filters: [{ id: "r", label: "4–5 stars" }], onRemove: noop, onClear: noop }));
    expect(one).toContain('aria-label="4–5 stars, remove filter"');
    expect(one).not.toContain("Clear all");
    const two = html(
      h(ActiveFilters, {
        filters: [
          { id: "r", label: "4–5 stars" },
          { id: "t", label: "Tag: pricing" },
        ],
        onRemove: noop,
        onClear: noop,
      }),
    );
    expect(two).toContain('role="group" aria-label="Filters in use"');
    expect(two).toContain("Clear all");
  });

  it("BulkBar keeps its live status mounted and shows only with a selection", () => {
    const none = html(h(BulkBar, { count: 0, onClear: noop, children: h("button", null, "Approve") }));
    expect(none).toBe('<div class="ak-bulk"><p class="visually-hidden" role="status"></p></div>');
    const some = html(
      h(BulkBar, {
        count: 3,
        total: 312,
        onSelectAll: noop,
        noun: ["testimonial", "testimonials"],
        onClear: noop,
        children: h("button", null, "Approve"),
      }),
    );
    expect(some).toContain('<p class="visually-hidden" role="status">3 testimonials selected</p>');
    expect(some).toContain('role="toolbar" aria-label="Bulk actions"');
    expect(some).toContain(">Select all 312</button>");
    expect(some).toContain("Clear selection");
    expect(html(h(BulkBar, { count: 1, noun: ["testimonial", "testimonials"], onClear: noop, children: null }))).toContain(
      "1 testimonial selected",
    );
  });
});

describe("fields", () => {
  it("Field ties the label, hint and error to its control", () => {
    const f = html(
      h(Field, {
        label: "Link slug",
        hint: "Lowercase letters, numbers and dashes.",
        error: "That slug is taken.",
        optional: true,
        children: h("input", { type: "text", "aria-describedby": "extra" }),
      }),
    );
    const id = attr(f, "label", "for")!;
    const input = /<input[^>]*>/.exec(f)![0];
    expect(input).toContain(`id="${id}"`);
    expect(input).toContain('aria-invalid="true"');
    const described = attr(f, "input", "aria-describedby")!.split(" ");
    expect(described[0]).toBe("extra");
    expect(f).toContain(`<p id="${described[1]}" class="hint ak-hint">Lowercase letters, numbers and dashes.</p>`);
    expect(f).toContain(`<p id="${described[2]}" class="ak-field-error" role="alert">That slug is taken.</p>`);
    expect(f).toContain('<span class="hint">(optional)</span>');
    expect(f).toContain("data-invalid");

    // A control's own id is kept; no error, no aria-invalid.
    const g = html(h(Field, { label: "Name", children: h("input", { id: "name" }) }));
    expect(g).toContain('<label for="name">Name</label>');
    expect(g).not.toContain("aria-invalid");
    expect(g).not.toContain("aria-describedby");
  });

  it("Toggle is a labelled switch with its hint attached", () => {
    const t = html(h(Toggle, { label: "Auto-approve", hint: "Only 4 and 5 stars.", checked: true, onChange: noop, testId: "auto" }));
    const input = /<input[^>]*>/.exec(t)![0];
    expect(input).toMatch(/^<input type="checkbox" role="switch"/);
    expect(input).toContain('checked=""');
    const hint = attr(t, "input", "aria-describedby");
    expect(t).toContain(`<p id="${hint}" class="hint ak-hint">Only 4 and 5 stars.</p>`);
    expect(t).toContain('<span class="ak-toggle-text">Auto-approve</span>');
    expect(t).toContain('data-testid="auto"');
    expect(html(h(Toggle, { label: "On", checked: false, onChange: noop, hideLabel: true }))).toContain(
      '<span class="visually-hidden">On</span>',
    );
  });

  it("Checkbox can keep its label for screen readers only", () => {
    const c = html(h(Checkbox, { label: "Select Ann's testimonial", checked: false, onChange: noop, hideLabel: true }));
    expect(c).toMatch(/^<label class="check ak-check"><input type="checkbox"\/><span class="visually-hidden">Select Ann&#x27;s testimonial<\/span><\/label>$/);
  });

  it("ColorField pairs a named picker with a hex box, and warns about low contrast", () => {
    const low = html(h(ColorField, { label: "Button text", value: "#bbbbbb", onChange: noop, contrastWith: "#ffffff", hint: "On the button colour." }));
    expect(low).toContain('aria-label="Button text, colour picker"');
    expect(attr(low, 'input type="color"', "value")).toBe("#bbbbbb");
    const box = attr(low, 'input id="[^"]+" type="text"', "id")!;
    expect(attr(low, "label", "for")).toBe(box);
    const described = attr(low, 'input id="[^"]+" type="text"', "aria-describedby")!.split(" ");
    expect(described).toHaveLength(2);
    expect(low).toMatch(new RegExp(`<p id="${described[1]}" class="ak-field-warn">Low contrast \\(1\\.9:1\\)`));

    const fine = html(h(ColorField, { label: "Text", value: "#161b2e", onChange: noop, contrastWith: "#ffffff" }));
    expect(fine).not.toContain("Low contrast");
    expect(fine).not.toContain("Use default");

    const empty = html(h(ColorField, { label: "Accent", value: "", onChange: noop, allowEmpty: true, placeholder: "#3d63dd" }));
    expect(attr(empty, 'input type="color"', "value")).toBe("#3d63dd");
    expect(attr(empty, 'input type="color"', "data-empty")).toBe("true");
    expect(empty).toContain('placeholder="Default (#3d63dd)"');
    expect(html(h(ColorField, { label: "Accent", value: "#ff0000", onChange: noop, allowEmpty: true }))).toContain("Use default");
  });

  it("FontField is a radio group that previews each font", () => {
    const f = html(
      h(FontField, {
        label: "Heading font",
        value: "serif",
        onChange: noop,
        choices: [
          { id: "sans", label: "Inter" },
          { id: "serif", label: "Newsreader", fallback: "Georgia, serif" },
        ],
      }),
    );
    expect(f).toMatch(/^<fieldset class="ak-font"><legend>Heading font<\/legend>/);
    const names = [...f.matchAll(/type="radio" name="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(1);
    expect(f).toMatch(/<label class="ak-font-choice" data-checked="true"><input type="radio" name="[^"]+" checked="" value="serif"\/>/);
    expect(f.match(/data-checked/g)).toHaveLength(1);
    expect(f).toContain('style="font-family:&quot;Newsreader&quot;, Georgia, serif" aria-hidden="true">Aa</span>');
  });

  it("CopyField shows a read-only value labelled for its box, with a live status", () => {
    const c = html(h(CopyField, { label: "Collection link", value: "https://x.test/c/acme", copyLabel: "Copy link", testId: "link" }));
    const id = attr(c, "label", "for")!;
    expect(c).toMatch(new RegExp(`<input type="text" id="${id}" readOnly="" spellCheck="false" value="https://x.test/c/acme"/>`));
    expect(c).toMatch(/aria-describedby="([^"]+)">.*Copy link<\/button>/);
    expect(c).toMatch(/<p id="[^"]+" class="ak-copy-status" role="status" data-state="idle"><\/p>/);
    const m = html(h(CopyField, { label: "Script", value: "<script></script>", multiline: true }));
    expect(m).toContain('data-multiline="true"');
    expect(m).toMatch(/<textarea rows="4"[^>]*>&lt;script&gt;&lt;\/script&gt;<\/textarea>/);
  });

  it("SearchField has a label and only offers Clear when there's text", () => {
    const empty = html(h(SearchField, { label: "Search testimonials", value: "", onChange: noop, placeholder: "Search…" }));
    const id = attr(empty, "label", "for")!;
    expect(empty).toContain(`<label for="${id}" class="visually-hidden">Search testimonials</label>`);
    expect(empty).toMatch(new RegExp(`<input id="${id}" type="search"`));
    expect(empty).not.toContain("Clear search");
    expect(html(h(SearchField, { label: "Search", value: "pricing", onChange: noop }))).toContain('aria-label="Clear search"');
  });
});

describe("page furniture", () => {
  it("EmptyState has a heading at the level asked for, and one action", () => {
    const e = html(h(EmptyState, { icon: "inbox", title: "No forms yet", action: h("button", null, "Create a form"), children: "Each form has its own link." }));
    expect(e).toContain('<h2 class="ak-empty-title">No forms yet</h2>');
    expect(e).toContain('<div class="ak-empty-body">Each form has its own link.</div>');
    expect(e).toContain('<div class="ak-empty-action"><button>Create a form</button></div>');
    expect(e).toContain('<span class="ak-empty-icon"><svg class="icon"');
    expect(html(h(EmptyState, { title: "Nothing here", level: 3 }))).toBe('<div class="ak-empty"><h3 class="ak-empty-title">Nothing here</h3></div>');
  });

  it("ProgressBar is a labelled <progress>, empty while the total is unknown", () => {
    const p = html(h(ProgressBar, { label: "Copying media", value: 40, detail: "12 of 30" }));
    expect(p).toContain('<progress value="40" max="100"></progress>');
    expect(p).toContain('<span class="ak-progress-pct">40%</span>');
    expect(p).toMatch(/^<div class="ak-progress"><label class="ak-progress-label">/);
    const busy = html(h(ProgressBar, { label: "Starting", value: null }));
    expect(busy).toContain('<progress max="100"></progress>');
    expect(busy).not.toContain("%");
    expect(html(h(ProgressBar, { label: "x", value: 250, max: 200 }))).toContain('value="200" max="200"');
  });

  it("DevicePreview lays the preview out at the device's width, with an optional switch", () => {
    const d = html(h(DevicePreview, { device: "mobile", onDevice: noop, children: "Form" }));
    expect(d).toContain('role="group" aria-label="Preview size"');
    expect(d).toMatch(/aria-pressed="true">Mobile</);
    expect(d).toContain('aria-label="Preview, mobile width (375 px)"');
    expect(d).toContain('style="width:375px"');
    expect(html(h(DevicePreview, { device: "desktop", children: "x" }))).not.toContain("segmented");
  });

  it("Toast keeps an empty live region between messages", () => {
    expect(html(h(Toast, { message: null, onDismiss: noop }))).toBe('<div class="ak-toast-region" role="status" aria-live="polite"></div>');
    const t = html(h(Toast, { message: "Moved to trash", onDismiss: noop, action: { label: "Undo", onClick: noop } }));
    expect(t).toContain('<p class="ak-toast-text">Moved to trash</p>');
    expect(t).toContain(">Undo</button>");
    expect(t).toContain('aria-label="Dismiss"');
  });

  it("UnsavedGuard renders nothing, and RunProgressView starts in a working state", () => {
    expect(html(h(UnsavedGuard, { dirty: true }))).toBe("");
    const r = html(h(RunProgressView, { runId: "r1", label: "Importing", testId: "run" }));
    expect(r).toContain('data-status="loading"');
    expect(r).toContain("Starting…");
    expect(r).toContain('<progress max="100"></progress>');
  });

  it("keeps the WP1.1 contract: the published props still type-check and render", () => {
    const modal: ModalProps = { open: true, onClose: noop, title: "t", children: "c", footer: "f", size: "lg", testId: "m" };
    const drawer: DrawerProps = { open: true, onClose: noop, title: "t", children: "c", footer: "f", width: "md", testId: "d" };
    const toolbar: ToolbarProps = { label: "l", children: "c" };
    const pager: PagerProps = { page: 1, pageSize: 25, total: 50, onPage: noop, pageSizes: [25, 50], onPageSize: noop };
    const color: ColorFieldProps = { label: "l", value: "#000000", onChange: noop, name: "n", allowEmpty: true, hint: "h" };
    const font: FontFieldProps = { label: "l", value: "a", onChange: noop, choices: [{ id: "a", label: "A", fallback: "serif" }], name: "n" };
    const copy: CopyFieldProps = { label: "l", value: "v", multiline: false, testId: "c" };
    const empty: EmptyStateProps = { icon: "inbox", title: "t", children: "c", action: "a", testId: "e" };
    const guard: UnsavedGuardProps = { dirty: false, message: "m" };
    const preview: DevicePreviewProps = { device: "tablet", onDevice: noop, label: "l", children: "c" };
    const markup = [
      html(h(Modal, modal)),
      html(h(Drawer, drawer)),
      html(h(Toolbar, toolbar)),
      html(h(Pager, pager)),
      html(h(ColorField, color)),
      html(h(FontField, font)),
      html(h(CopyField, copy)),
      html(h(EmptyState, empty)),
      html(h(UnsavedGuard, guard)),
      html(h(DevicePreview, preview)),
    ];
    expect(markup.filter((m) => m === "")).toHaveLength(1); // only UnsavedGuard
    expect(markup[0]).toContain('data-testid="m"');
    expect(markup[9]).toContain('style="width:768px"');
  });
});
