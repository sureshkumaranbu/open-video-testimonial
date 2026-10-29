/**
 * Plaudit browser extension (EXT-01), the options page: the server address,
 * the API key and the project. On Save it also asks for the optional host
 * permission for exactly that server (requested at runtime, from the click,
 * never at install). The manifest lists https://*\/* and http://*\/* only as
 * *optional* origins, because each person's server is different; nothing is
 * granted until they agree, and only for their own address. The extension
 * works without it, since the server answers CORS for extension origins.
 */
import { ext, getSettings, listProjects, saveSettings, serverOrigin } from "./lib.js";

const $ = (id) => document.getElementById(id);
const status = (text, error = false) => {
  $("status").textContent = text;
  $("status").className = error ? "status error" : "status";
};

function fillProjects(projects, chosen) {
  const select = $("project");
  select.textContent = "";
  for (const p of projects) {
    const o = document.createElement("option");
    o.value = p.slug;
    o.textContent = `${p.name} (${p.slug})`;
    select.appendChild(o);
  }
  if (chosen && projects.some((p) => p.slug === chosen)) select.value = chosen;
}

const form = () => ({ serverUrl: serverOrigin($("server").value) ?? "", apiKey: $("key").value.trim(), project: $("project").value });

async function findProjects() {
  const s = form();
  if (!s.serverUrl) return status("Enter your Plaudit address, starting with https://", true);
  status("Looking…");
  try {
    const projects = await listProjects(s);
    fillProjects(projects, s.project);
    status(projects.length ? `This key reaches ${projects.length} project${projects.length === 1 ? "" : "s"}.` : "This key reaches no projects.", !projects.length);
  } catch (err) {
    status(err instanceof Error ? err.message : String(err), true);
  }
}

$("check").addEventListener("click", () => void findProjects());

$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const s = form();
  if (!s.serverUrl) return status("Enter your Plaudit address, starting with https:// (http:// only for this computer)", true);
  if (!s.project) return status("Find your projects, then choose one.", true);
  // Asked for straight from the click (browsers want a user gesture), but not waited on: saving never depends on the answer.
  let asked = null;
  try {
    asked = ext.permissions?.request({ origins: [`${s.serverUrl}/*`] }) ?? null;
  } catch {
    asked = null;
  }
  void saveSettings(s).then(() => {
    status("Saved. Select some words on a page, then right-click › Save selection as testimonial.");
    asked?.then(
      (granted) => granted || status("Saved. (Without the extra permission, which is fine: your server allows the extension.)"),
      () => {},
    );
  });
});

void getSettings().then(async (s) => {
  $("server").value = s.serverUrl;
  $("key").value = s.apiKey;
  if (s.project) fillProjects([{ slug: s.project, name: s.project }], s.project);
});
