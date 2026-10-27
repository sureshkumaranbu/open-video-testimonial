import { expect, type APIRequestContext } from "@playwright/test";
import { createProject } from "./helpers";

/** Shared by the form specs: a demo form and a project that has it. */

const RUN = Date.now().toString(36);

export const DEMO_PAGES = [
  { type: "rating" },
  { type: "question", key: "q1", primary: true, title: "What changed for your team?", tips: ["A number you can share"] },
  { type: "question", key: "q2", title: "Anything else?", required: false, mode: "text" },
  { type: "question", key: "q3", title: "Say a quick hello on camera", mode: "video", maxVideoSeconds: 30 },
  { type: "consent" },
  {
    type: "about_you",
    custom: [
      { key: "plan", type: "dropdown", label: "Your plan", required: true, options: [{ label: "Starter" }, { label: "Enterprise", tag: "enterprise" }] },
      { key: "nps", type: "nps", label: "How likely are you to recommend us?" },
    ],
  },
  { type: "review", enabled: true },
  { type: "thank_you", copyText: true },
];

/** A project with a step-by-step form made through the admin API. */
export async function formProject(
  api: APIRequestContext,
  name: string,
  config: { pages?: unknown[]; settings?: Record<string, unknown>; language?: string; design?: Record<string, unknown> } = {},
) {
  const slug = `${name.toLowerCase().replace(/\W+/g, "-")}-${RUN}`;
  const project = await createProject(api, name, slug);
  const made = await api.post(`/api/admin/projects/${project.id}/forms`, { data: { name: "Stories", slug: "stories" } });
  expect(made.status(), await made.text()).toBe(201);
  const form = (await made.json()).form as { id: string; slug: string };
  const patched = await api.patch(`/api/admin/forms/${form.id}`, {
    data: { pages: config.pages ?? DEMO_PAGES, settings: config.settings ?? {}, ...(config.language ? { language: config.language } : {}), ...(config.design ? { design: config.design } : {}) },
  });
  expect(patched.status(), await patched.text()).toBe(200);
  return { project, form, url: `/f/${project.slug}/${form.slug}` };
}

