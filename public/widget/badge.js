/*! Plaudit widget layout "badge" (MIT): the average rating and a count, linking to the wall. Loaded by /widget.js. */
(function (W) {
  "use strict";

  var CSS =
    ".bd{display:inline-flex;align-items:center;gap:12px;padding:12px 18px;border-radius:var(--r);background:var(--card);border:1px solid var(--border);" +
    "box-shadow:var(--shadow);color:var(--text);text-decoration:none;font-size:14px}" +
    ".bd b{font-size:24px;line-height:1}.bd .s svg{width:18px;height:18px}.bd .k{color:var(--muted)}.bd:hover{border-color:var(--accent)}";

  W.layouts.badge = function (ctx) {
    var el = ctx.el;
    var g = ctx.data.aggregate || { count: 0, average: null };
    ctx.root.appendChild(el("style", null, CSS));
    var a = el("a", "bd");
    a.href = ctx.abs(ctx.w.wallUrl);
    a.target = "_blank";
    a.rel = "noopener";
    if (g.average != null) {
      a.appendChild(el("b", null, g.average.toFixed(1)));
      a.appendChild(ctx.stars(Math.round(g.average), ctx.l.outOf));
    }
    var label = el("span", "k", g.count ? g.count + " " + ctx.l.reviews : ctx.l.empty);
    a.appendChild(label);
    a.setAttribute(
      "aria-label",
      (g.average != null ? g.average.toFixed(1) + " " + ctx.l.outOf + ", " : "") + label.textContent,
    );
    ctx.slot.appendChild(a);
  };

  W.loaded("badge");
})(window.PlauditWidget);
