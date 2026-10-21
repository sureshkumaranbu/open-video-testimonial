/*!
 * Plaudit embed widget (MIT). Renders approved testimonials into a Shadow DOM
 * so the host page's CSS can't break it, and it can't leak styles out.
 *
 * <script src="https://your-plaudit.example/widget.js" data-project="acme" async></script>
 *
 * Attributes: data-project (required), data-theme="light|dark|auto",
 * data-layout="grid|list", data-tag, data-limit, data-target (CSS selector
 * of an element to render into; defaults to right after the script tag).
 */
(function () {
  "use strict";

  var script = document.currentScript;
  if (!script) return;
  var base = new URL(script.src, location.href).origin;
  var ds = script.dataset;
  var slug = ds.project;
  if (!slug) {
    console.warn("[plaudit] missing data-project attribute");
    return;
  }

  var host = ds.target ? document.querySelector(ds.target) : null;
  if (!host) {
    host = document.createElement("div");
    script.parentNode.insertBefore(host, script.nextSibling);
  }
  host.setAttribute("data-plaudit-widget", slug);
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  var theme = ds.theme === "dark" || ds.theme === "auto" ? ds.theme : "light";
  var layout = ds.layout === "list" ? "list" : "grid";

  var CSS =
    ":host{all:initial;display:block}" +
    ".w{--bg:transparent;--card:#fff;--text:#1c1f1e;--muted:#5d6662;--border:#e2e4df;--star:#d97706;" +
    "font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.5;color:var(--text);background:var(--bg)}" +
    ".w.dark{--card:#1b1f1e;--text:#ecefed;--muted:#9aa5a0;--border:#2c3230}" +
    "@media (prefers-color-scheme:dark){.w.auto{--card:#1b1f1e;--text:#ecefed;--muted:#9aa5a0;--border:#2c3230}}" +
    ".grid{columns:3 280px;column-gap:16px}.list{display:flex;flex-direction:column;gap:16px;max-width:720px;margin:0 auto}" +
    ".c{break-inside:avoid;margin:0 0 16px;background:var(--card);border:1px solid var(--border);border-radius:14px;padding:18px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box}" +
    ".list .c{margin:0}" +
    "p{margin:0;white-space:pre-wrap;font-size:15px}" +
    ".s{color:var(--star);letter-spacing:1px}.s i{font-style:normal;opacity:.25}" +
    ".a{display:flex;gap:10px;align-items:center}" +
    ".av{width:40px;height:40px;border-radius:50%;object-fit:cover;flex:none;display:grid;place-items:center;font-weight:700;color:#fff}" +
    ".n{font-weight:600;font-size:15px}.m{color:var(--muted);font-size:13px}" +
    "video{width:100%;border-radius:10px;background:#000;display:block}" +
    ".e{color:var(--muted);font-size:14px}";

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text; // never innerHTML with user content
    return node;
  }

  function abs(url) {
    return new URL(url, base).href;
  }

  function card(t, accent) {
    var c = el("article", "c");
    c.setAttribute("data-testimonial-id", t.id);
    if (t.video) {
      var v = el("video");
      v.controls = true;
      v.preload = "metadata";
      v.setAttribute("playsinline", "");
      var src = el("source");
      src.src = abs(t.video.url);
      src.type = t.video.mime;
      v.appendChild(src);
      c.appendChild(v);
    }
    if (t.rating) {
      var s = el("div", "s", "★".repeat(t.rating));
      s.setAttribute("aria-label", t.rating + " out of 5 stars");
      s.appendChild(el("i", null, "★".repeat(5 - t.rating)));
      c.appendChild(s);
    }
    if (t.text) c.appendChild(el("p", null, t.text));

    var a = el("div", "a");
    var av;
    if (t.avatarUrl) {
      av = el("img", "av");
      av.src = abs(t.avatarUrl);
      av.alt = "";
      av.loading = "lazy";
    } else {
      av = el("span", "av", (t.name || "?").trim().charAt(0).toUpperCase());
      av.style.background = accent;
    }
    a.appendChild(av);
    var who = el("div");
    who.appendChild(el("div", "n", t.name));
    var byline = [t.title, t.company].filter(Boolean).join(", ");
    if (byline) who.appendChild(el("div", "m", byline));
    a.appendChild(who);
    c.appendChild(a);
    return c;
  }

  var style = el("style", null, CSS);
  var wrap = el("div", "w " + theme);
  root.appendChild(style);
  root.appendChild(wrap);

  var qs = new URLSearchParams();
  if (ds.tag) qs.set("tag", ds.tag);
  if (ds.limit) qs.set("limit", ds.limit);
  var url = base + "/api/widget/" + encodeURIComponent(slug) + (qs.toString() ? "?" + qs : "");

  fetch(url)
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (data) {
      var accent = (data.project && data.project.accentColor) || "#0f766e";
      if (!data.testimonials.length) {
        wrap.appendChild(el("div", "e", "No testimonials yet."));
        return;
      }
      var list = el("div", layout);
      data.testimonials.forEach(function (t) {
        list.appendChild(card(t, accent));
      });
      wrap.appendChild(list);
      host.setAttribute("data-plaudit-ready", String(data.testimonials.length));
    })
    .catch(function (err) {
      console.warn("[plaudit] could not load testimonials:", err);
      host.setAttribute("data-plaudit-error", "1");
    });
})();
