/**
 * Plaudit browser extension (EXT-01), the background worker: the "Save
 * selection as testimonial" menu item. A click reads the selection and the
 * post's author in that tab only (activeTab: no access to any page until the
 * user acts on it), then opens the review window, where the user checks the
 * words and the name and confirms the author agreed to be quoted.
 */
import { ext } from "./lib.js";

const MENU = "plaudit-save-selection";

ext.runtime.onInstalled.addListener(() => {
  ext.contextMenus.create({ id: MENU, title: "Save selection as testimonial", contexts: ["selection"] });
});

/** Runs capture.js in the tab and returns what it read. */
export async function captureTab(tabId) {
  await ext.scripting.executeScript({ target: { tabId }, files: ["capture.js"] });
  const [result] = await ext.scripting.executeScript({ target: { tabId }, func: () => globalThis.plauditCapture(document) });
  return result?.result ?? null;
}

/** Keeps the capture for the review window (this browser session only) and opens it. */
export async function openReview(capture) {
  await ext.storage.session.set({ pending: capture });
  await ext.windows.create({ url: ext.runtime.getURL("popup.html?review=1"), type: "popup", width: 460, height: 680 });
}
// For the e2e test, which can't click a browser menu: the same step the menu takes.
globalThis.plauditOpenReview = openReview;

ext.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU || !tab?.id) return;
  let capture = null;
  try {
    capture = await captureTab(tab.id);
  } catch {
    // A page the extension may not read (the browser's own pages): the menu's selection is still there.
  }
  if (!capture) capture = { text: info.selectionText || "", url: info.pageUrl || tab.url || null, title: tab.title || null, platform: null, sourceUrl: info.pageUrl || null, author: {} };
  if (!capture.text && info.selectionText) capture.text = info.selectionText;
  await openReview(capture);
});
