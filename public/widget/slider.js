/*! Plaudit widget layout "slider" (MIT): several cards side by side that slide. Loaded by /widget.js. */
(function (W) {
  "use strict";

  var CSS =
    ".sd{position:relative}.sd .vp{overflow:hidden}.sd .st{display:flex;align-items:flex-start;transition:transform .45s ease}" +
    ".sd .sl{flex:none;margin-right:var(--g)}.sd .c{margin:0}" +
    ".sd .nav{display:flex;align-items:center;justify-content:center;gap:12px;margin-top:14px}" +
    ".ib{all:unset;cursor:pointer;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--card);border:1px solid var(--border);color:var(--text)}.ib svg{width:18px;height:18px}" +
    ".dots{display:flex;gap:6px}.dot{all:unset;cursor:pointer;width:8px;height:8px;border-radius:50%;background:var(--border)}.dot[aria-current=true]{background:var(--accent)}" +
    "@media (prefers-reduced-motion:reduce){.sd .st{transition:none}}";

  var PREV = "M15 6l-6 6 6 6";
  var NEXT = "M9 6l6 6-6 6";
  var PAUSE = "M9 6v12M15 6v12";
  var PLAY = "M8 5l11 7-11 7z";

  // Shared by carousel.js and slider.js (each file carries it; a test keeps the copies equal).
  // TRACK START
  W.track = function (ctx, region, count, show, step) {
    var el = ctx.el;
    var l = ctx.l;
    var opt = ctx.w.options;
    var at = 0;
    var stopped = false;
    var nav = el("div", "nav");
    var dots = [];
    function go(i) {
      at = (i + count) % count;
      show(at);
      dots.forEach(function (d, k) {
        d.setAttribute("aria-current", String(k === at));
      });
    }
    function btn(cls, label, d, fn) {
      var b = el("button", cls);
      b.type = "button";
      b.setAttribute("aria-label", label);
      if (d) b.appendChild(ctx.icon(d));
      b.onclick = fn;
      return b;
    }
    if (count > 1 && opt.arrows) nav.appendChild(btn("ib prev", l.previous, PREV, function () { go(at - step); }));
    if (count > 1 && opt.dots) {
      var box = el("div", "dots");
      for (var i = 0; i < count; i++)
        (function (k) {
          var d = btn("dot", k + 1 + " / " + count, null, function () { go(k); });
          dots.push(d);
          box.appendChild(d);
        })(i);
      nav.appendChild(box);
    }
    if (count > 1 && opt.arrows) nav.appendChild(btn("ib next", l.next, NEXT, function () { go(at + step); }));

    region.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") go(at - step);
      else if (e.key === "ArrowRight") go(at + step);
      else return;
      e.preventDefault();
    });

    // Autoplay: never with reduced motion; paused on hover, while focus is inside, and by the button.
    if (count > 1 && opt.autoplay && !ctx.reduced()) {
      var hover = false;
      var focus = false;
      var timer = setInterval(function () {
        if (!hover && !focus && !stopped) go(at + step);
      }, opt.delay * 1000);
      ctx.stop(function () { clearInterval(timer); });
      region.addEventListener("mouseenter", function () { hover = true; });
      region.addEventListener("mouseleave", function () { hover = false; });
      region.addEventListener("focusin", function () {
        focus = true;
        region.setAttribute("data-paused", "focus");
      });
      region.addEventListener("focusout", function (e) {
        if (region.contains(e.relatedTarget)) return;
        focus = false;
        region.removeAttribute("data-paused");
      });
      var toggle = btn("ib pp", l.pause, PAUSE, function () {
        stopped = !stopped;
        toggle.textContent = "";
        toggle.appendChild(ctx.icon(stopped ? PLAY : PAUSE));
        toggle.setAttribute("aria-label", stopped ? l.play : l.pause);
        region.setAttribute("aria-live", stopped ? "polite" : "off");
      });
      nav.insertBefore(toggle, nav.firstChild);
      region.setAttribute("data-autoplay", "");
    }
    // Announce changes only when they come from the visitor, not from autoplay.
    region.setAttribute("aria-live", region.hasAttribute("data-autoplay") ? "off" : "polite");
    if (nav.firstChild) region.appendChild(nav);
    go(0);
    return go;
  };
  // TRACK END

  W.layouts.slider = function (ctx) {
    var el = ctx.el;
    ctx.root.appendChild(el("style", null, CSS));
    var gap = ctx.w.design.spacing;
    var region = el("div", "sd");
    region.setAttribute("role", "region");
    region.setAttribute("aria-roledescription", "carousel");
    region.setAttribute("aria-label", "Testimonials");
    region.tabIndex = 0;
    var vp = el("div", "vp");
    var strip = el("div", "st");
    vp.appendChild(strip);
    region.appendChild(vp);
    ctx.slot.appendChild(region);
    // Cards per view: the setting on a wide screen, fewer on a narrow one (a resize past a step redraws).
    var fit = function () {
      return Math.max(1, Math.min(ctx.w.options.perView, Math.floor((ctx.slot.clientWidth + gap) / (260 + gap)) || 1, ctx.items.length));
    };
    var per = fit();
    var n = ctx.items.length;
    var slides = ctx.items.map(function (t, i) {
      var s = el("div", "sl");
      s.setAttribute("role", "group");
      s.setAttribute("aria-roledescription", "slide");
      s.setAttribute("aria-label", i + 1 + " / " + n);
      s.style.width = "calc((100% - " + (per - 1) * gap + "px) / " + per + ")";
      s.appendChild(ctx.card(t));
      strip.appendChild(s);
      return s;
    });
    var last = 0;
    var go = W.track(ctx, region, n - per + 1, function (at) {
      last = at;
      strip.style.transform = "translateX(" + -slides[at].offsetLeft + "px)";
      slides.forEach(function (s, k) {
        var off = k < at || k >= at + per;
        // Cards out of view can't be reached by Tab or a screen reader.
        if (off) s.setAttribute("inert", "");
        else s.removeAttribute("inert");
        s.setAttribute("aria-hidden", String(off));
      });
    }, 1);
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        if (fit() !== per) ctx.again();
        else go(last);
      });
      ro.observe(ctx.slot);
      ctx.stop(function () { ro.disconnect(); });
    }
  };

  W.loaded("slider");
})(window.PlauditWidget);
