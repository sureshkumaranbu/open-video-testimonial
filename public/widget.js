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

  // Same palette as the app (see src/app/globals.css), scoped to the shadow root.
  var DARK = "--card:#171b2b;--text:#eef0f6;--muted:#a4abbd;--border:#262c40;--star-off:#343b52;--shadow:none";
  var CSS =
    ":host{all:initial;display:block}" +
    ".w{--card:#fff;--text:#161b2e;--muted:#545c70;--border:#e3e6ec;--star:#f2a93b;--star-off:#dfe2e8;--stage:#0d1020;" +
    "--shadow:0 1px 0 rgb(22 27 46/.04),0 1px 3px rgb(22 27 46/.06);" +
    "font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;line-height:1.55;color:var(--text);-webkit-font-smoothing:antialiased}" +
    ".w.dark{" + DARK + "}" +
    "@media (prefers-color-scheme:dark){.w.auto{" + DARK + "}}" +
    ".grid{columns:3 280px;column-gap:20px}.list{display:flex;flex-direction:column;gap:16px;max-width:720px;margin:0 auto}" +
    ".c{break-inside:avoid;margin:0 0 20px;background:var(--card);border:1px solid var(--border);border-radius:18px;box-shadow:var(--shadow);padding:20px;display:flex;flex-direction:column;gap:16px;box-sizing:border-box}" +
    ".list .c{margin:0}" +
    ".v{margin:-20px -20px 0;padding:6px 6px 0}" +
    "video{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:12px;background:var(--stage);display:block}" +
    "p{margin:0;white-space:pre-wrap;font-family:'Newsreader','Iowan Old Style','Palatino Linotype',Georgia,serif;font-size:18px;line-height:1.5;letter-spacing:-.005em}" +
    ".q:before{content:'\\201C';display:block;font-family:Georgia,serif;font-size:52px;line-height:.6;height:22px;color:var(--accent)}" +
    ".s{display:inline-flex;gap:2px;color:var(--star)}.s svg{width:16px;height:16px;display:block}.s .o{color:var(--star-off)}" +
    ".a{display:flex;gap:12px;align-items:center;padding-top:16px;border-top:1px solid var(--border)}" +
    ".av{width:40px;height:40px;border-radius:50%;object-fit:cover;flex:none;display:grid;place-items:center;font-weight:700;font-size:14px;box-shadow:0 0 0 2px var(--card),0 0 0 3px var(--border)}" +
    ".n{font-weight:600;font-size:14px}.m{color:var(--muted);font-size:13px}" +
    ".tr{margin:10px 6px 0;font-size:14px;color:var(--muted)}.tr summary{cursor:pointer;font-weight:600}.tr p{font-family:inherit;font-size:14px;margin-top:6px;color:var(--text)}" +
    ".e{color:var(--muted);font-size:14px;text-align:center;padding:32px;border:1px dashed var(--border);border-radius:18px}";

  var STAR = "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z";
  function starIcon(on) {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    if (!on) svg.setAttribute("class", "o");
    var path = document.createElementNS(ns, "path");
    path.setAttribute("d", STAR);
    svg.appendChild(path);
    return svg;
  }

  function onAccent(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return "#fff";
    var n = parseInt(m[1], 16);
    var lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    return lum > 160 ? "#161b2e" : "#fff";
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text; // never innerHTML with user content
    return node;
  }

  function abs(url) {
    return new URL(url, base).href;
  }

  // Portrait phone videos get a taller frame instead of a thin landscape crop.
  function ratio(v) {
    if (!v.width || !v.height) return "16 / 10";
    return String(Math.min(Math.max(v.width / v.height, 0.75), 1.78));
  }

  function card(t, accent) {
    var c = el("article", "c");
    c.setAttribute("data-testimonial-id", t.id);
    if (t.video) {
      var frame = el("div", "v");
      var v = el("video");
      v.controls = true;
      v.preload = t.video.poster ? "none" : "metadata";
      if (t.video.poster) v.poster = abs(t.video.poster);
      v.style.aspectRatio = ratio(t.video);
      v.setAttribute("playsinline", "");
      var sources = t.video.sources && t.video.sources.length ? t.video.sources : [{ url: t.video.url, type: t.video.mime }];
      sources.forEach(function (s) {
        var src = el("source");
        src.src = abs(s.url);
        src.type = s.type;
        v.appendChild(src);
      });
      if (t.video.captionsUrl) {
        // Cross-origin captions need a CORS request (the server allows it).
        v.crossOrigin = "anonymous";
        var track = el("track");
        track.kind = "captions";
        track.label = "Captions";
        track.src = abs(t.video.captionsUrl);
        track.default = true;
        v.appendChild(track);
      }
      frame.appendChild(v);
      if (t.video.transcript) {
        var details = el("details", "tr");
        details.appendChild(el("summary", null, "Transcript"));
        details.appendChild(el("p", null, t.video.transcript));
        frame.appendChild(details);
      }
      c.appendChild(frame);
    }
    if (t.rating) {
      var s = el("div", "s");
      s.setAttribute("role", "img");
      s.setAttribute("aria-label", t.rating + " out of 5 stars");
      for (var i = 1; i <= 5; i++) s.appendChild(starIcon(i <= t.rating));
      c.appendChild(s);
    }
    if (t.text) c.appendChild(el("p", t.video ? null : "q", t.text));

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
      av.style.color = onAccent(accent);
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
      wrap.style.setProperty("--accent", accent);
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
