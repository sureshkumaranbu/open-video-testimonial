/*! Plaudit widget: the connected form in a dialog over the page (DISP-06). Loaded by /widget.js on click. */
(function (W) {
  "use strict";

  var CSS =
    "dialog{border:0;border-radius:18px;padding:0;width:min(560px,94vw);height:min(760px,90vh);background:var(--card);overflow:hidden}" +
    "dialog::backdrop{background:rgb(13 16 32/.55)}dialog iframe{border:0;width:100%;height:100%;display:block}" +
    ".x-close{all:unset;cursor:pointer;position:absolute;top:10px;right:10px;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--card);color:var(--text)}.x-close svg{width:18px;height:18px}";

  W.layouts.popup = function (ctx) {
    var el = ctx.el;
    if (!ctx.root.querySelector("style[data-popup]")) {
      var st = el("style", null, CSS);
      st.setAttribute("data-popup", "");
      ctx.root.appendChild(st);
    }
    var dlg = el("dialog");
    dlg.setAttribute("aria-label", ctx.l.cta);
    var f = el("iframe");
    f.src = ctx.abs(ctx.w.cta.embedUrl);
    f.title = ctx.l.cta;
    f.allow = "camera; microphone; clipboard-write";
    var close = el("button", "x-close");
    close.type = "button";
    close.setAttribute("aria-label", ctx.l.dismiss);
    close.appendChild(ctx.icon("M6 6l12 12M18 6L6 18"));
    close.onclick = function () {
      dlg.close();
    };
    dlg.appendChild(f);
    dlg.appendChild(close);
    dlg.addEventListener("close", function () {
      dlg.remove();
    });
    ctx.wrap.appendChild(dlg);
    dlg.showModal();
  };

  W.loaded("popup");
})(window.PlauditWidget);
