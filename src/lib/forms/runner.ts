import type { Form, Project } from "@/db/schema";
import type { FormRunnerProps } from "@/components/collect/FormRunner";
import { currentConsentVersionFor } from "@/lib/consent";
import { env } from "@/lib/env";
import { parseBrand } from "@/lib/projects";
import { findRequestByToken, markStarted } from "@/lib/requests";
import { mediaUrl } from "@/lib/storage";
import { consentWordingFor } from "@/lib/submissions";
import { designWithBrand } from "./design";
import { parsePrefill } from "./engine";
import { resolveLabels } from "./labels";
import { parseFormRow, toPublicForm } from "./schema";

type Query = Record<string, string | string[] | undefined>;

/**
 * Everything the public step-by-step pages (/f and the iframe embed) hand
 * the runner: the public form only (no rules), its labels, the consent
 * wording as a stored version, and the link's prefill. A signed request link
 * (?r=) of this project wins over plain parameters, and opening the form with
 * one counts as "started" for that request (M9 tracking).
 */
export function runnerProps(project: Project, form: Form, query: Query): Omit<FormRunnerProps, "embed" | "preview" | "previewPage"> {
  const cfg = parseFormRow(form);
  const brand = parseBrand(project.brand);
  const publicForm = toPublicForm(form, { ...cfg, design: designWithBrand(cfg.design, brand) });
  const r = typeof query.r === "string" ? query.r : null;
  const request = r ? findRequestByToken(r) : null;
  const ownRequest = request && request.projectId === project.id ? request : null;
  if (ownRequest) markStarted(ownRequest);
  const wording = consentWordingFor(project, cfg, form.language);
  const version = currentConsentVersionFor(project, wording);
  return {
    project: { slug: project.slug, name: project.name },
    form: publicForm,
    labels: resolveLabels(form.language, cfg.labels.overrides),
    consent: { versionId: version.id, text: version.text },
    prefill: parsePrefill(query, cfg, ownRequest),
    requestToken: ownRequest ? r : null,
    logoUrl: publicForm.logoUrl ?? (project.logoKey ? mediaUrl(project.logoKey) : null),
    accent: project.accentColor,
    limits: { maxVideoBytes: env.maxVideoBytes, maxImageBytes: env.maxImageBytes },
  };
}
