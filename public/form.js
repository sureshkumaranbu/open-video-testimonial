/*!
 * Plaudit form embed (FORM-11). Plain ES5, no dependencies.
 *
 *   <div data-plaudit-form="<form slug>" data-project="<project slug>"></div>
 *   <script src="https://your-plaudit/form.js" async></script>
 *
 * data-mode="popup" shows a floating button that opens the form in a dialog
 * (data-label sets its text). The form runs in an iframe from this server
 * (/embed/<project>/form/<form>) with camera and microphone allowed, and grows
 * to fit. When it's sent, the element fires a "plaudit:submitted" event.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var origin = "";
  try {
    origin = new URL(script && script.src ? script.src : "", location.href).origin;
  } catch (e) {
    return;
  }
  var frames = [];

  function frameFor(el) {
    var project = el.getAttribute("data-project") || "";
    var form = el.getAttribute("data-plaudit-form") || "";
    var query = "";
    try {
      // The host page's own ?r=, ?name=… and utm_* parameters pass through to the form.
      query = location.search || "";
    } catch (e) {}
    var iframe = document.createElement("iframe");
    iframe.src = origin + "/embed/" + encodeURIComponent(project) + "/form/" + encodeURIComponent(form) + query;
    iframe.title = el.getAttribute("data-title") || "Share your experience";
    iframe.setAttribute("allow", "camera; microphone; clipboard-write");
    iframe.setAttribute("loading", "lazy");
    iframe.style.cssText = "display:block;width:100%;border:0;height:640px;background:transparent;color-scheme:normal";
    frames.push({ iframe: iframe, el: el });
    return iframe;
  }

  function popup(el) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = el.getAttribute("data-label") || "Share your experience";
    button.setAttribute("data-plaudit-open", "");
    var color = el.getAttribute("data-color") || "#161b2e";
    button.style.cssText =
      "position:fixed;bottom:20px;right:20px;z-index:2147483000;padding:12px 20px;border:0;border-radius:999px;" +
      "font:600 15px/1.2 system-ui,sans-serif;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.2);color:#fff;background:" +
      color;
    var overlay = null;
    var opener = null;
    function close() {
      if (!overlay) return;
      overlay.parentNode.removeChild(overlay);
      overlay = null;
      document.removeEventListener("keydown", onKey);
      if (opener) opener.focus();
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }
    button.addEventListener("click", function () {
      if (overlay) return;
      opener = button;
      overlay = document.createElement("div");
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-modal", "true");
      overlay.setAttribute("aria-label", button.textContent);
      overlay.setAttribute("data-plaudit-dialog", "");
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483001;background:rgba(13,16,32,.55);display:flex;align-items:flex-start;" +
        "justify-content:center;overflow:auto;padding:24px 12px";
      var box = document.createElement("div");
      box.style.cssText = "position:relative;width:100%;max-width:720px;background:#fff;border-radius:16px;overflow:hidden";
      var x = document.createElement("button");
      x.type = "button";
      x.setAttribute("aria-label", "Close");
      x.textContent = "×";
      x.style.cssText =
        "position:absolute;top:8px;right:8px;z-index:1;width:36px;height:36px;border:0;border-radius:50%;" +
        "background:rgba(0,0,0,.06);font:20px/1 system-ui,sans-serif;cursor:pointer;color:#161b2e";
      x.addEventListener("click", close);
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) close();
      });
      box.appendChild(x);
      box.appendChild(frameFor(el));
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      document.addEventListener("keydown", onKey);
      x.focus();
    });
    el.appendChild(button);
  }

  function mount() {
    var els = document.querySelectorAll("[data-plaudit-form]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.getAttribute("data-plaudit-mounted")) continue;
      el.setAttribute("data-plaudit-mounted", "1");
      if (el.getAttribute("data-mode") === "popup") popup(el);
      else el.appendChild(frameFor(el));
    }
  }

  window.addEventListener("message", function (e) {
    if (e.origin !== origin || !e.data || typeof e.data !== "object") return;
    for (var i = 0; i < frames.length; i++) {
      var f = frames[i];
      if (f.iframe.contentWindow !== e.source) continue;
      if (e.data.type === "plaudit:form-resize" && typeof e.data.height === "number") {
        f.iframe.style.height = Math.max(200, Math.min(e.data.height, 20000)) + "px";
      } else if (e.data.type === "plaudit:form-submitted") {
        var ev;
        try {
          ev = new CustomEvent("plaudit:submitted", { bubbles: true, detail: { form: e.data.slug } });
        } catch (err) {
          ev = document.createEvent("CustomEvent");
          ev.initCustomEvent("plaudit:submitted", true, false, { form: e.data.slug });
        }
        f.el.dispatchEvent(ev);
      }
    }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
  window.PlauditForm = { mount: mount };
})();
