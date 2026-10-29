/**
 * Plaudit browser extension (EXT-01): settings and the one API call, shared by
 * the background worker, the popup and the options page. The key is an
 * /api/v1 key with write access (the least that can add a testimonial),
 * ideally limited to one project; it's kept in chrome.storage.local on this
 * device only and sent only to the server it was made for. No cookies are
 * ever used: the server allows extension origins only with the key.
 */
export const ext = globalThis.browser ?? globalThis.chrome;

export async function getSettings() {
  const s = await ext.storage.local.get(["serverUrl", "apiKey", "project"]);
  return { serverUrl: s.serverUrl || "", apiKey: s.apiKey || "", project: s.project || "" };
}

export async function saveSettings(s) {
  await ext.storage.local.set({ serverUrl: s.serverUrl, apiKey: s.apiKey, project: s.project });
}

/** "https://plaudit.example.com/" → "https://plaudit.example.com"; null for anything else. */
export function serverOrigin(raw) {
  try {
    const u = new URL(String(raw || "").trim());
    if (u.protocol !== "https:" && !(u.protocol === "http:" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname))) return null;
    return u.origin;
  } catch {
    return null;
  }
}

async function call(settings, path, init = {}) {
  const origin = serverOrigin(settings.serverUrl);
  if (!origin) throw new Error("Set your Plaudit address in the extension's options first.");
  if (!settings.apiKey) throw new Error("Add an API key in the extension's options first.");
  let res;
  try {
    res = await fetch(`${origin}/api/v1${path}`, {
      ...init,
      credentials: "omit",
      headers: { Authorization: `Bearer ${settings.apiKey}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
  } catch {
    throw new Error(`Couldn't reach ${origin}. Check the address, and that the server is up.`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `The server answered ${res.status}`);
  return body;
}

/** The projects this key may reach. */
export async function listProjects(settings) {
  return (await call(settings, "/projects")).data.map((p) => ({ slug: p.slug, name: p.name }));
}

const httpUrl = (u) => (typeof u === "string" && /^https?:\/\//i.test(u) ? u.slice(0, 2000) : undefined);

/** The create-testimonial body for a capture and the person's edits. It always lands as Pending. */
export function testimonialPayload(capture, edits = {}) {
  const a = capture.author || {};
  const name = String(edits.name ?? a.name ?? a.handle ?? "").trim().slice(0, 120);
  const text = String(edits.text ?? capture.text ?? "").trim().slice(0, 5000);
  const body = { name, text, status: "pending", consent: true };
  if (capture.platform === "x" || capture.platform === "linkedin") body.platform = capture.platform;
  const source = httpUrl(capture.sourceUrl) || httpUrl(capture.url);
  if (source) body.sourceUrl = source;
  if (capture.platform === "x" && a.handle) body.socials = { x: a.handle };
  if (capture.platform === "linkedin" && a.profileUrl) body.socials = { linkedin: a.profileUrl.slice(0, 200) };
  if (typeof a.avatarUrl === "string" && a.avatarUrl.startsWith("https://")) body.avatarUrl = a.avatarUrl.slice(0, 2000);
  if (a.headline) body.title = String(a.headline).slice(0, 120);
  if (capture.title) body.customFields = { page_title: String(capture.title).slice(0, 200) };
  return body;
}

/** Adds the testimonial to the chosen project; returns its id. */
export async function saveTestimonial(settings, capture, edits) {
  if (!settings.project) throw new Error("Choose a project in the extension's options first.");
  const body = testimonialPayload(capture, edits);
  if (!body.name) throw new Error("Add the author's name.");
  if (!body.text) throw new Error("Select the words to save first.");
  const res = await call(settings, `/projects/${encodeURIComponent(settings.project)}/testimonials`, { method: "POST", body: JSON.stringify(body) });
  return res.data.id;
}
