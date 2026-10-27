/*! Plaudit widget layout "featured" (MIT): one testimonial, large. Loaded by /widget.js. */
(function (W) {
  "use strict";

  var CSS =
    ".ft{max-width:820px;margin:0 auto}.ft .c{margin:0;padding:32px;gap:20px;text-align:center;align-items:center}" +
    ".ft .c p{font-size:clamp(20px,3.2vw,30px);line-height:1.35}.ft .q:before{margin:0 auto;font-size:72px;height:30px}" +
    ".ft .a{border-top:0;padding-top:0;justify-content:center;text-align:left}.ft .av{width:52px;height:52px;font-size:18px}" +
    ".ft .s svg{width:22px;height:22px}";

  W.layouts.featured = function (ctx) {
    ctx.root.appendChild(ctx.el("style", null, CSS));
    var box = ctx.el("figure", "ft");
    box.style.margin = "0 auto";
    box.appendChild(ctx.card(ctx.items[0]));
    ctx.slot.appendChild(box);
  };

  W.loaded("featured");
})(window.PlauditWidget);
