/*!
 * Plaudit embed widget (MIT): approved testimonials in a Shadow DOM, safe from the host page's CSS.
 * <script src="https://your-plaudit.example/widget.js" data-widget="w_abc123def456" async></script>
 * or data-project="acme" (with data-theme, data-layout=grid|list, data-tag, data-limit), and data-target.
 * Layouts other than grid and list load from /widget/<layout>.js. Docs: docs/EMBED.md
 */
(function () {
  "use strict";

  var W = (window.PlauditWidget = window.PlauditWidget || { layouts: {} });
  var script = document.currentScript;
  var base = script && script.src ? new URL(script.src, location.href).origin : location.origin;
  var ds = script ? script.dataset : {};

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

  // Saved widgets only: the design settings arrive as custom properties on .x.
  var XCSS =
    ".x{--g:20px;--r:18px;background:var(--bg,transparent);max-width:var(--mw,none);margin:0 auto;box-sizing:border-box}" +
    ".x.ff,.x.ff p{font-family:var(--ff)}.x.ns{--shadow:none}" +
    ".x .grid{columns:var(--cols,3) 260px;column-gap:var(--g)}.x .list{gap:var(--g)}" +
    ".x .c{border-radius:var(--r);margin-bottom:var(--g)}.x .list .c{margin:0}" +
    ".x .n{color:var(--title,inherit)}.x .m{color:var(--date,var(--muted))}time.m{display:block}" +
    ".h{margin:0;font-size:16px;line-height:1.35}" +
    "mark{background:var(--hl,#fff0a8);color:inherit;border-radius:3px;padding:0 2px}" +
    ".x.dark{--hl:#4d4216}@media (prefers-color-scheme:dark){.x.auto{--hl:#4d4216}}" +
    ".rm{all:unset;cursor:pointer;color:var(--accent);font:600 14px/1.4 inherit}" +
    "button:focus-visible,a:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
    ".im{display:flex;gap:8px;flex-wrap:wrap}.im img{width:72px;height:72px;object-fit:cover;border-radius:10px;display:block}" +
    ".src{margin-left:auto;align-self:center;width:26px;height:26px;flex:none;border-radius:50%;display:grid;place-items:center;font:700 11px/1 inherit;background:var(--border);color:var(--text);text-decoration:none}" +
    ".vf{color:#1f8a5b;font-weight:600}" +
    ".agg{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 var(--g);font-size:15px}.agg b{font-size:22px}" +
    ".cta{display:flex;justify-content:center;margin-top:var(--g)}" +
    ".b{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:999px;padding:10px 18px;background:var(--accent);color:var(--on);font:600 14px/1.2 inherit;cursor:pointer;text-decoration:none}" +
    ".sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}";

  var NS = "http://www.w3.org/2000/svg";
  var STAR = "M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z";
  function starIcon(on) {
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    if (!on) svg.setAttribute("class", "o");
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", STAR);
    svg.appendChild(path);
    return svg;
  }

  function icon(d) {
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
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

  function absFrom(b) {
    return function (url) {
      return new URL(url, b).href;
    };
  }
  var abs = absFrom(base);

  // Portrait phone videos get a taller frame instead of a thin landscape crop.
  function ratio(v) {
    if (!v.width || !v.height) return "16 / 10";
    return String(Math.min(Math.max(v.width / v.height, 0.75), 1.78));
  }

  function stars(rating, label) {
    var s = el("div", "s");
    s.setAttribute("role", "img");
    s.setAttribute("aria-label", rating + " " + (label || "out of 5") + " stars");
    for (var i = 1; i <= 5; i++) s.appendChild(starIcon(i <= rating));
    return s;
  }

  // Text up to `limit` with its highlights as <mark>.
  function fill(p, text, marks, limit) {
    var at = 0;
    (marks || []).forEach(function (h) {
      if (h.start < at || h.start >= limit) return;
      p.appendChild(document.createTextNode(text.slice(at, h.start)));
      p.appendChild(el("mark", null, text.slice(h.start, Math.min(h.end, limit))));
      at = Math.min(h.end, limit);
    });
    p.appendChild(document.createTextNode(text.slice(at, limit)));
  }

  function when(iso, prec, mode) {
    var d = new Date(iso);
    var n = (Date.now() - d) / 864e5;
    var R = window.Intl && Intl.RelativeTimeFormat;
    if (mode == "relative" && prec == "day" && R) {
      var u = n < 30 ? [n, "day"] : n < 365 ? [n / 30, "month"] : [n / 365, "year"];
      return new R(void 0, { numeric: "auto" }).format(-Math.round(u[0]), u[1]);
    }
    var o = { timeZone: "UTC", year: "numeric" };
    if (prec != "year") o.month = "short";
    if (prec == "day") o.day = "numeric";
    return isNaN(d) ? "" : d.toLocaleDateString(void 0, o);
  }

  // Without `o`: exactly the original data-project card. A saved widget passes design, labels and options.
  function card(t, accent, o) {
    var d = o && o.d;
    var L = (o && o.l) || {};
    var A = o ? o.abs : abs;
    var c = el("article", "c");
    c.setAttribute("data-testimonial-id", t.id);
    if (t.video && (!d || d.showVideo)) {
      var frame = el("div", "v");
      var v = el("video");
      v.controls = true;
      v.preload = d && o.lazy ? "none" : t.video.poster ? "none" : "metadata";
      if (t.video.poster) v.poster = A(t.video.poster);
      v.style.aspectRatio = ratio(t.video);
      v.setAttribute("playsinline", "");
      var sources = t.video.sources && t.video.sources.length ? t.video.sources : [{ url: t.video.url, type: t.video.mime }];
      sources.forEach(function (s) {
        var src = el("source");
        src.src = A(s.url);
        src.type = s.type;
        v.appendChild(src);
      });
      if (t.video.captionsUrl) {
        // Cross-origin captions need a CORS request (the server allows it).
        v.crossOrigin = "anonymous";
        var track = el("track");
        track.kind = "captions";
        track.label = "Captions";
        track.src = A(t.video.captionsUrl);
        track.default = true;
        v.appendChild(track);
      }
      frame.appendChild(v);
      if (t.video.transcript) {
        var details = el("details", "tr");
        details.appendChild(el("summary", null, L.transcript || "Transcript"));
        details.appendChild(el("p", null, t.video.transcript));
        frame.appendChild(details);
      }
      c.appendChild(frame);
    }
    if (t.rating && (!d || d.showRating)) c.appendChild(stars(t.rating, L.outOf));
    var x = (d && t.extra) || {};
    if (d && d.showHeadline && x.headline) c.appendChild(el("h3", "h", x.headline));
    if (t.text) {
      if (!d) c.appendChild(el("p", t.video ? null : "q", t.text));
      else {
        var p = el("p", t.video && d.showVideo ? null : "q");
        var max = d.readMore;
        var open = !(max > 0 && t.text.length > max + 20);
        var long = !open;
        var short = t.text.lastIndexOf(" ", max);
        if (short < max / 2) short = max;
        var more = el("button", "rm");
        var draw = function () {
          p.textContent = "";
          fill(p, t.text, d.showHighlights && x.highlights, open ? 1e9 : short);
          if (!open) p.appendChild(document.createTextNode("\u2026"));
          more.textContent = open ? L.readLess : L.readMore;
          more.setAttribute("aria-expanded", open);
        };
        more.type = "button";
        more.onclick = function () {
          open = !open;
          draw();
        };
        draw();
        c.appendChild(p);
        if (long) c.appendChild(more);
      }
    }
    if (d && d.showImages && x.images && x.images.length) {
      var im = el("div", "im");
      x.images.slice(0, 3).forEach(function (i) {
        var img = el("img");
        img.src = A(i.url);
        img.alt = i.alt || "";
        if (o.lazy) img.loading = "lazy";
        im.appendChild(img);
      });
      c.appendChild(im);
    }

    var a = el("div", "a");
    var av;
    if (!d || d.showAvatar) {
      if (t.avatarUrl) {
        av = el("img", "av");
        av.src = A(t.avatarUrl);
        av.alt = "";
        av.loading = "lazy";
      } else {
        av = el("span", "av", (t.name || "?").trim().charAt(0).toUpperCase());
        av.style.background = accent;
        av.style.color = o ? o.d.onAccent : onAccent(accent);
      }
      a.appendChild(av);
    }
    var who = el("div");
    who.appendChild(el("div", "n", t.name));
    var byline = !d || d.showTitle ? [t.title, t.company].filter(Boolean).join(", ") : "";
    if (byline) who.appendChild(el("div", "m", byline));
    if (d && d.date !== "hidden" && x.date) {
      var tm = el("time", "m", when(x.date, x.datePrecision, d.date));
      tm.setAttribute("datetime", x.date);
      who.appendChild(tm);
    }
    if (d && d.showVerified && x.verified) who.appendChild(el("div", "m vf", "\u2713 " + L.verified));
    a.appendChild(who);
    if (d && d.showSource && x.sourceUrl) {
      var src = el("a", "src", (x.platform || "?").charAt(0).toUpperCase());
      src.href = x.sourceUrl;
      src.target = "_blank";
      src.rel = "nofollow noopener noreferrer";
      src.title = x.platform || "Source";
      src.setAttribute("aria-label", "Original review" + (x.platform ? " on " + x.platform : ""));
      a.appendChild(src);
    }
    c.appendChild(a);
    return c;
  }

  // ------------------------------------------------------------ saved widgets

  var reduced = function () {
    return !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  };

  var fonts = {};
  function loadFont(family, file, b) {
    var name = family.split(",")[0];
    if (!file || fonts[name]) return;
    fonts[name] = 1;
    // A shadow root ignores @font-face, so the rule goes into the host page's <head>.
    var st = el("style", null, "@font-face{font-family:" + name + ";src:url(" + b + file + ') format("woff2");font-display:swap;font-weight:100 900}');
    st.setAttribute("data-plaudit-font", "");
    document.head.appendChild(st);
  }

  var waiting = {};
  function need(name, b, cb) {
    if (W.layouts[name]) return cb();
    if (waiting[name]) return waiting[name].push(cb);
    waiting[name] = [cb];
    var s = document.createElement("script");
    s.src = b + "/widget/" + name + ".js";
    s.async = true;
    s.onerror = function () {
      console.warn("[plaudit] could not load the " + name + " layout");
      W.layouts[name] = name == "popup" ? function (c) { open(c.abs(c.w.cta.url)); } : W.layouts.grid;
      W.loaded(name);
    };
    document.head.appendChild(s);
  }
  W.loaded = function (name) {
    var q = waiting[name] || [];
    waiting[name] = [];
    q.forEach(function (f) { f(); });
  };

  W.layouts.grid = W.layouts.list = function (ctx) {
    var list = el("div", ctx.w.layout === "list" ? "list" : "grid");
    ctx.items.forEach(function (t) { list.appendChild(ctx.card(t)); });
    ctx.slot.appendChild(list);
  };

  function aggregate(ctx) {
    var g = ctx.data.aggregate || {};
    var box = el("div", "agg");
    if (g.average != null) {
      box.appendChild(el("b", null, g.average.toFixed(1)));
      box.appendChild(stars(Math.round(g.average), ctx.l.outOf));
    }
    box.appendChild(el("span", null, g.count + " " + ctx.l.reviews));
    return box;
  }

  function cta(ctx) {
    var c = ctx.w.cta;
    var row = el("div", "cta");
    var b;
    if (c.mode === "popup") {
      b = el("button", "b", ctx.l.cta);
      b.type = "button";
      b.onclick = function () {
        need("popup", ctx.base, function () { W.layouts.popup(ctx); });
      };
    } else {
      b = el("a", "b", ctx.l.cta);
      b.href = ctx.abs(c.url);
      b.target = "_blank";
      b.rel = "noopener";
    }
    row.appendChild(b);
    return row;
  }

  // Pins (the first `from`) stay first.
  function shuffle(a, from) {
    for (var i = a.length - 1; i > from; i--) {
      var j = from + Math.floor(Math.random() * (i - from + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  // Draws a saved widget's payload into host's shadow root (the studio preview uses it too). cfg: {base, preview}.
  W.mount = function (host, cfg, data) {
    cfg = cfg || {};
    if (host._plauditStop) host._plauditStop();
    var stops = [];
    host._plauditStop = function () {
      stops.forEach(function (f) { f(); });
      stops = [];
    };
    var root = host.shadowRoot || (host.attachShadow ? host.attachShadow({ mode: "open" }) : host);
    while (root.firstChild) root.removeChild(root.firstChild);
    var b = cfg.base || base;
    var w = data.widget;
    root.appendChild(el("style", null, CSS + XCSS));
    var wrap = el("div", "w x " + ((w && w.design.theme) || "light"));
    root.appendChild(wrap);
    if (!w) {
      // A deleted widget: nothing at all on the host page.
      host.setAttribute("data-plaudit-ready", "0");
      return;
    }
    var d = w.design;
    var accent = d.accent;
    var css = { "--accent": accent, "--on": d.onAccent, "--g": d.spacing + "px", "--r": d.radius + "px", "--cols": w.options.columns };
    var map = { card: "--card", text: "--text", border: "--border", star: "--star", background: "--bg", titleColor: "--title", dateColor: "--date" };
    for (var k in map) if (d[k]) css[map[k]] = d[k];
    if (d.maxWidth) css["--mw"] = d.maxWidth + "px";
    if (d.fontFamily) {
      css["--ff"] = d.fontFamily;
      wrap.className += " ff";
      loadFont(d.fontFamily, d.fontFile, b);
    }
    if (!d.shadow) wrap.className += " ns";
    for (var p in css) wrap.style.setProperty(p, css[p]);
    host.setAttribute("data-layout", w.layout);

    var items = data.testimonials.slice();
    if (w.sort === "random") shuffle(items, w.pinned || 0);
    var o = { d: d, l: w.labels, lazy: w.options.lazy, abs: absFrom(b) };
    var ctx = {
      host: host,
      root: root,
      wrap: wrap,
      w: w,
      l: w.labels,
      data: data,
      items: items,
      preview: !!cfg.preview,
      base: b,
      abs: o.abs,
      el: el,
      icon: icon,
      stars: stars,
      reduced: reduced,
      stop: function (f) { stops.push(f); },
      again: function () { W.mount(host, cfg, data); },
      card: function (t) { return card(t, accent, o); },
    };
    if (w.aggregate.show && data.aggregate.count && w.layout !== "badge") wrap.appendChild(aggregate(ctx));
    ctx.slot = el("div");
    wrap.appendChild(ctx.slot);
    if (!items.length && w.layout !== "badge") ctx.slot.appendChild(el("div", "e", w.labels.empty));
    if (w.cta && w.layout !== "toast") wrap.appendChild(cta(ctx));
    var done = function () {
      host.setAttribute("data-plaudit-ready", String(items.length));
    };
    if (!items.length && w.layout !== "badge") return done();
    need(w.layout, b, function () {
      W.layouts[w.layout](ctx);
      done();
    });
  };

  // ------------------------------------------------------------ auto start

  if (!script || ds.mount === "manual") return;
  var id = ds.widget;
  var slug = ds.project;
  if (!id && !slug) {
    console.warn("[plaudit] missing data-project attribute");
    return;
  }

  var host = ds.target ? document.querySelector(ds.target) : null;
  if (!host) {
    host = document.createElement("div");
    script.parentNode.insertBefore(host, script.nextSibling);
  }
  host.setAttribute("data-plaudit-widget", id || slug);

  if (id) {
    fetch(base + "/api/widget/" + encodeURIComponent(id))
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        W.mount(host, { base: base }, data);
      })
      .catch(function (err) {
        console.warn("[plaudit] could not load the widget:", err);
        host.setAttribute("data-plaudit-error", "1");
      });
    return;
  }

  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

  var theme = ds.theme === "dark" || ds.theme === "auto" ? ds.theme : "light";
  var layout = ds.layout === "list" ? "list" : "grid";

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
