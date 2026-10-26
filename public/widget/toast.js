/*! Plaudit widget layout "toast" (MIT): a small card in a corner, one testimonial after another. Loaded by /widget.js. */
(function (W) {
  "use strict";

  var CSS =
    ".ts{position:fixed;z-index:2147483000;width:min(340px,calc(100vw - 32px));transition:opacity .3s,transform .3s}" +
    ".ts.pv{position:absolute}.ts[hidden]{display:block;opacity:0;transform:translateY(8px);pointer-events:none;visibility:hidden}" +
    ".ts.bottom-left{left:16px;bottom:16px}.ts.bottom-right{right:16px;bottom:16px}.ts.top-left{left:16px;top:16px}.ts.top-right{right:16px;top:16px}" +
    ".ts .c{margin:0;padding:16px 40px 16px 16px;gap:10px;box-shadow:0 12px 32px -12px rgb(13 16 32/.35)}.ts .c p{font-size:15px}.ts .q:before{display:none}" +
    ".ts .a{padding-top:10px}.ts .av{width:32px;height:32px;font-size:12px}" +
    ".ts .x-close{all:unset;cursor:pointer;position:absolute;top:8px;right:8px;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;color:var(--muted)}.ts .x-close svg{width:16px;height:16px}" +
    "@media (max-width:640px){.ts.hm{display:none!important}}" +
    "@media (prefers-reduced-motion:reduce){.ts{transition:none}}";

  /** Dismissed for this visit only; storage can be blocked, so every access is guarded. */
  function key(id) {
    return "plaudit:toast:" + id;
  }
  function dismissed(id) {
    try {
      return sessionStorage.getItem(key(id)) === "1";
    } catch (e) {
      return false;
    }
  }
  function remember(id) {
    try {
      sessionStorage.setItem(key(id), "1");
    } catch (e) {
      /* private mode: dismissed until the page reloads */
    }
  }

  W.layouts.toast = function (ctx) {
    var el = ctx.el;
    var opt = ctx.w.options;
    var id = ctx.w.id;
    if (!ctx.preview && dismissed(id)) return;
    ctx.root.appendChild(el("style", null, CSS));
    if (ctx.preview) ctx.host.style.cssText += ";position:relative;display:block;min-height:260px";
    var box = el("div", "ts " + opt.toastPosition + (opt.toastHideOnMobile && !ctx.preview ? " hm" : "") + (ctx.preview ? " pv" : ""));
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Testimonials");
    box.hidden = true;
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
    function next() {
      if (gone) return;
      // Stay up while the visitor reads it or works with it.
      if (hover || box.contains(document.activeElement) || ctx.root.activeElement) return later(next, 1);
      at = (at + 1) % ctx.items.length;
      var c = ctx.card(ctx.items[at]);
      box.textContent = "";
      box.appendChild(c);
      box.appendChild(close);
      box.hidden = false;
      later(function () {
        if (hover || ctx.root.activeElement) return later(hide, 1);
        hide();
      }, opt.toastDuration);
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

  W.loaded("toast");
})(window.PlauditWidget);
