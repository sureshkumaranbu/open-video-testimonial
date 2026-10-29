/*! Plaudit widget layout "sales" (MIT): the sales popup, recent purchases (and testimonial snippets) in a corner. Loaded by /widget.js. */
(function (W) {
  "use strict";

  var CSS =
    ".sp{position:fixed;z-index:2147483000;width:min(340px,calc(100vw - 32px));transition:opacity .3s,transform .3s}" +
    ".sp.pv{position:absolute}.sp[hidden]{display:block;opacity:0;transform:translateY(8px);pointer-events:none;visibility:hidden}" +
    ".sp.bottom-left{left:16px;bottom:16px}.sp.bottom-right{right:16px;bottom:16px}.sp.top-left{left:16px;top:16px}.sp.top-right{right:16px;top:16px}" +
    ".sp .in{display:flex;gap:12px;align-items:center;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:var(--r);padding:12px 40px 12px 12px;box-shadow:0 12px 32px -12px rgb(13 16 32/.35);font-size:14px;line-height:1.4}" +
    ".sp .ic{flex:none;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--accent);color:var(--on)}.sp .ic svg{width:18px;height:18px}" +
    ".sp .ln{font-weight:600}.sp .qt{font-style:italic}.sp .sub{color:var(--muted);font-size:12px;margin-top:2px}" +
    ".sp .x-close{all:unset;cursor:pointer;position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;color:var(--muted)}.sp .x-close svg{width:16px;height:16px}" +
    "@media (max-width:640px){.sp.hm{display:none!important}}" +
    "@media (prefers-reduced-motion:reduce){.sp{transition:none}.sp[hidden]{transform:none}}";

  var BAG = "M6 8h12l-1 12H7L6 8zM9 8V6a3 3 0 0 1 6 0v2";
  var QUOTE = "M7 17c-2 0-3-1.5-3-3.5C4 10 6.5 7.5 9 7M17 17c-2 0-3-1.5-3-3.5 0-3.5 2.5-6 5-6.5";
  /** A closed popup stays closed for this visitor for 30 days; storage can be blocked, so every access is guarded. */
  var KEEP = 30 * 864e5;

  function key(id) {
    return "plaudit:sales:" + id;
  }
  function dismissed(id) {
    try {
      var at = Number(localStorage.getItem(key(id)));
      return at > 0 && Date.now() - at < KEEP;
    } catch (e) {
      return false;
    }
  }
  function remember(id) {
    try {
      localStorage.setItem(key(id), String(Date.now()));
    } catch (e) {
      /* private mode: closed until the page reloads */
    }
  }

  /** "2 hours ago", in the visitor's language. */
  function ago(iso) {
    var s = (Date.now() - new Date(iso)) / 1000;
    if (!(s >= 0)) return "";
    var R = window.Intl && Intl.RelativeTimeFormat;
    var u = s < 3600 ? [Math.max(1, Math.round(s / 60)), "minute"] : s < 86400 ? [Math.round(s / 3600), "hour"] : [Math.round(s / 86400), "day"];
    return R ? new R(void 0, { numeric: "auto" }).format(-u[0], u[1]) : u[0] + " " + u[1] + "s ago";
  }

  W.layouts.sales = function (ctx) {
    var el = ctx.el;
    var opt = ctx.w.options;
    var id = ctx.w.id;
    if (!ctx.preview && dismissed(id)) return;
    ctx.root.appendChild(el("style", null, CSS));
    if (ctx.preview) ctx.host.style.cssText += ";position:relative;display:block;min-height:180px";
    var box = el("div", "sp " + opt.toastPosition + (opt.toastHideOnMobile && !ctx.preview ? " hm" : "") + (ctx.preview ? " pv" : ""));
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Recent purchases");
    box.hidden = true;
    // Screen readers hear each new line once, without being interrupted.
    var live = el("div");
    live.setAttribute("aria-live", "polite");
    live.setAttribute("aria-atomic", "true");
    box.appendChild(live);
    var at = -1;
    var hover = false;
    var gone = false;
    var timers = [];
    var later = function (fn, s) {
      timers.push(setTimeout(fn, s * 1000));
    };
    ctx.stop(function () {
      timers.forEach(clearTimeout);
      gone = true;
    });
    var close = el("button", "x-close");
    close.type = "button";
    close.setAttribute("aria-label", ctx.l.dismiss);
    close.appendChild(ctx.icon("M6 6l12 12M18 6L6 18"));
    close.onclick = function () {
      gone = true;
      box.hidden = true;
      if (!ctx.preview) remember(id);
      ctx.host.setAttribute("data-dismissed", "");
    };
    box.appendChild(close);

    function draw(t) {
      var row = el("div", "in");
      row.setAttribute("data-kind", t.sale ? "sale" : "testimonial");
      var ic = el("span", "ic");
      ic.appendChild(ctx.icon(t.sale ? BAG : QUOTE));
      row.appendChild(ic);
      var words = el("div");
      if (t.sale) {
        words.appendChild(el("div", "ln", t.sale.line));
        var sub = [t.sale.at ? ago(t.sale.at) : "", t.sale.amount || ""].filter(Boolean).join(" \u00b7 ");
        if (sub) words.appendChild(el("div", "sub", sub));
      } else {
        words.appendChild(el("div", "qt", "\u201c" + t.text + "\u201d"));
        words.appendChild(el("div", "sub", [t.name, [t.title, t.company].filter(Boolean).join(", ")].filter(Boolean).join(" \u00b7 ")));
      }
      row.appendChild(words);
      return row;
    }
    function next() {
      if (gone) return;
      // Stay up while the visitor reads it or works with it.
      if (hover || ctx.root.activeElement) return later(next, 1);
      at = (at + 1) % ctx.items.length;
      live.textContent = "";
      live.appendChild(draw(ctx.items[at]));
      box.hidden = false;
      later(hide, opt.toastDuration);
    }
    function hide() {
      if (hover || ctx.root.activeElement) return later(hide, 1);
      box.hidden = true;
      if (ctx.items.length > 1 || ctx.preview) later(next, 1.5);
    }
    box.addEventListener("mouseenter", function () { hover = true; });
    box.addEventListener("mouseleave", function () { hover = false; });
    ctx.slot.appendChild(box);
    later(next, ctx.preview ? Math.min(opt.toastDelay, 1) : opt.toastDelay);
  };

  W.loaded("sales");
})(window.PlauditWidget);
