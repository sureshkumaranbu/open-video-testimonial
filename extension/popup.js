/**
 * Plaudit browser extension (EXT-01), the review step: from the toolbar button
 * (the current tab's selection, read with activeTab) or from the menu item
 * (the capture the background worker kept). Nothing is sent until the user
 * checks it and confirms the author agreed to be quoted.
 */
import { ext, getSettings, saveTestimonial } from "./lib.js";

const $ = (id) => document.getElementById(id);
const status = (text, error = false) => {
  $("status").textContent = text;
  $("status").className = error ? "status error" : "status";
};

async function currentCapture() {
  if (new URLSearchParams(location.search).has("review")) {
    const { pending } = await ext.storage.session.get("pending");
    return pending ?? null;
  }
  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  await ext.scripting.executeScript({ target: { tabId: tab.id }, files: ["capture.js"] });
  const [r] = await ext.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.plauditCapture(document) });
  return r?.result ?? null;
}

async function start() {
  const settings = await getSettings();
  if (!settings.serverUrl || !settings.apiKey || !settings.project) {
    $("setup").hidden = false;
    return;
  }
  let capture = null;
  try {
    capture = await currentCapture();
  } catch {
    status("This page can't be read by extensions (the browser's own pages and stores). Copy the words into the box instead.", true);
  }
  capture ??= { text: "", url: null, title: null, platform: null, sourceUrl: null, author: {} };
  const a = capture.author || {};
  $("text").value = capture.text || "";
  $("name").value = a.name || a.handle || "";
  $("who").textContent = [a.handle, a.headline].filter(Boolean).join(" · ");
  const src = capture.sourceUrl || capture.url;
  $("source").textContent = capture.title || src || "this page";
  if (src) $("source").href = src;
  $("project").textContent = `to ${settings.project}`;
  $("form").hidden = false;
  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("save").disabled = true;
    status("Saving…");
    try {
      await saveTestimonial(settings, capture, { text: $("text").value, name: $("name").value });
      status("Saved. It's in your Plaudit inbox as Pending.");
      $("form").hidden = true;
      await ext.storage.session.remove("pending");
    } catch (err) {
      status(err instanceof Error ? err.message : String(err), true);
      $("save").disabled = false;
    }
  });
}

void start();
