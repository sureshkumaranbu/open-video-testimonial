/*! Plaudit widget layout "marquee" (MIT): rows of cards that scroll on their own. Loaded by /widget.js. */
(function (W) {
  "use strict";

  var CSS =
    ".mq{display:flex;flex-direction:column;gap:var(--g);position:relative}" +
    ".mq .row{overflow:hidden;-webkit-mask:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent);mask:linear-gradient(90deg,transparent,#000 6%,#000 94%,transparent)}" +
    ".mq .tk{display:flex;width:max-content;animation:mq var(--dur,40s) linear infinite}" +
    ".mq .tk.rev{animation-direction:reverse}.mq .c{width:300px;margin:0 var(--g) 0 0;flex:none}" +
    ".mq:hover .tk,.mq:focus-within .tk,.mq.off .tk{animation-play-state:paused}" +
    "@keyframes mq{to{transform:translateX(-50%)}}" +
    // Reduced motion: no movement at all; the row scrolls by hand instead.
    ".mq.still .row{overflow-x:auto;-webkit-mask:none;mask:none}.mq.still .tk{animation:none}" +
    "@media (prefers-reduced-motion:reduce){.mq .tk{animation:none}.mq .row{overflow-x:auto;-webkit-mask:none;mask:none}}" +
    ".mq .pp{all:unset;cursor:pointer;position:absolute;right:6px;bottom:-6px;transform:translateY(100%);font:600 12px/1 inherit;color:var(--muted);padding:6px 8px;border-radius:8px}";

  W.layouts.marquee = function (ctx) {
    var el = ctx.el;
    var opt = ctx.w.options;
    var still = ctx.reduced();
    ctx.root.appendChild(el("style", null, CSS));
    var box = el("div", "mq" + (still ? " still" : ""));
    box.setAttribute("role", "region");
    box.setAttribute("aria-label", "Testimonials");
    var rows = Math.min(opt.rows, ctx.items.length);
    var tracks = [];
    for (var r = 0; r < rows; r++) {
      var row = el("div", "row");
      // Odd rows run the other way, so stacked rows don't move as one block.
      var tk = el("div", "tk" + ((opt.direction === "right") !== (r % 2 === 1) ? " rev" : ""));
      row.appendChild(tk);
      box.appendChild(row);
      tracks.push(tk);
    }
    ctx.items.forEach(function (t, i) {
      tracks[i % rows].appendChild(ctx.card(t));
    });
    if (!still) {
      // A second copy makes the loop seamless; it's hidden from screen readers and keyboards.
      tracks.forEach(function (tk) {
        var n = tk.children.length;
        for (var i = 0; i < n; i++) {
          var copy = tk.children[i].cloneNode(true);
          copy.setAttribute("aria-hidden", "true");
          copy.setAttribute("inert", "");
          tk.appendChild(copy);
        }
      });
      // WCAG 2.2.2: anything that moves for more than 5 seconds can be paused.
      var pp = el("button", "pp", ctx.l.pause);
      pp.type = "button";
      pp.setAttribute("aria-pressed", "false");
      pp.onclick = function () {
        var off = box.classList.toggle("off");
        pp.textContent = off ? ctx.l.play : ctx.l.pause;
        pp.setAttribute("aria-pressed", String(off));
      };
      box.appendChild(pp);
      box.style.marginBottom = "28px";
    }
    ctx.slot.appendChild(box);
    // The same speed in px per second whatever the number of cards.
    var pace = function () {
      tracks.forEach(function (tk) {
        tk.style.setProperty("--dur", Math.max(8, tk.scrollWidth / 2 / (opt.speed * 12)) + "s");
      });
    };
    pace();
    if (window.requestAnimationFrame) requestAnimationFrame(pace);
  };

  W.loaded("marquee");
})(window.PlauditWidget);
