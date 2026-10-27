import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Project, TaskRun } from "@/db/schema";
import { emailEnabled, sendMail } from "../email";
import { env } from "../env";
import { getTestimonial, type TestimonialWithTags } from "../testimonials";
import { reviewUrl, stars } from "./format";

const { testimonials, projects } = schema;

/**
 * The owner and team emails (INT-01): plain text like every Plaudit mail, no
 * tracking, one link per item. Bodies are built when the job runs, so a
 * testimonial deleted in between is simply left out.
 */

export type MailKind = "instant" | "daily" | "weekly" | "monthly" | "import";

const SETTINGS_LINE = () => `\n—\nYou get this because of your notification settings: ${env.publicUrl}/admin/settings#notifications`;

function clip(s: string, max: number) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

function describe(t: TestimonialWithTags) {
  const who = [t.authorName || "Someone", [t.authorTitle, t.authorCompany].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  const quote = t.text ? `“${clip(t.text, 600)}”` : t.videoKey ? "(A video testimonial)" : "";
  return [`${stars(t.rating) ? `${stars(t.rating)}  ` : ""}${who}`, quote, reviewUrl(t.projectId, t.id)].filter(Boolean).join("\n");
}

function projectName(id: string) {
  return getDb().select({ name: projects.name }).from(projects).where(eq(projects.id, id)).get()?.name ?? "your project";
}

/** Projects the person follows (empty = all), as rows. */
function followed(projectIds: string[]): Pick<Project, "id" | "name">[] {
  const q = getDb().select({ id: projects.id, name: projects.name }).from(projects);
  return (projectIds.length ? q.where(inArray(projects.id, projectIds)) : q).all();
}

export function instantMail(to: string, testimonialId: string) {
  const t = getTestimonial(testimonialId);
  if (!t || t.status === "trashed") return null;
  const name = projectName(t.projectId);
  return {
    to,
    subject: `New testimonial for ${clip(name, 80)}${t.rating ? ` (${t.rating}/5)` : ""} from ${clip(t.authorName || "someone", 60)}`,
    text: `${describe(t)}\n${SETTINGS_LINE()}\n`,
  };
}

export function digestMail(to: string, ids: string[]) {
  const items = ids.map((id) => getTestimonial(id)).filter((t): t is TestimonialWithTags => Boolean(t) && t!.status !== "trashed");
  if (!items.length) return null;
  const byProject = new Map<string, TestimonialWithTags[]>();
  for (const t of items) byProject.set(t.projectId, [...(byProject.get(t.projectId) ?? []), t]);
  const sections = [...byProject.entries()].map(([pid, list]) => `${projectName(pid)} (${list.length})\n\n${list.map(describe).join("\n\n")}`);
  return {
    to,
    subject: `${items.length} new ${items.length === 1 ? "testimonial" : "testimonials"} in the last day`,
    text: `Here's what came in over the last day.\n\n${sections.join("\n\n\n")}\n${SETTINGS_LINE()}\n`,
  };
}

/** Testimonials waiting for review, per followed project. */
export function pendingCounts(projectIds: string[]) {
  return followed(projectIds)
    .map((p) => ({
      ...p,
      pending: getDb().select({ n: count() }).from(testimonials).where(and(eq(testimonials.projectId, p.id), eq(testimonials.status, "pending"))).get()?.n ?? 0,
    }))
    .filter((p) => p.pending > 0);
}

export function weeklyMail(to: string, projectIds: string[]) {
  const rows = pendingCounts(projectIds);
  if (!rows.length) return null;
  const total = rows.reduce((n, r) => n + r.pending, 0);
  const lines = rows.map((r) => `${r.name}: ${r.pending} waiting\n${env.publicUrl}/admin/projects/${r.id}?tab=pending`);
  return {
    to,
    subject: `${total} ${total === 1 ? "testimonial is" : "testimonials are"} waiting for review`,
    text: `Approve the ones you like so they can appear on your site.\n\n${lines.join("\n\n")}\n${SETTINGS_LINE()}\n`,
  };
}

/** Last calendar month (UTC) before `now`. */
export function previousMonth(now: Date) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1));
  return { start, end, label: start.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }) };
}

export function monthlyMail(to: string, projectIds: string[], now: Date) {
  const { start, end, label } = previousMonth(now);
  const rows = followed(projectIds).map((p) => {
    const where = and(eq(testimonials.projectId, p.id), gte(testimonials.createdAt, start), lt(testimonials.createdAt, end));
    const s = getDb()
      .select({
        received: count(),
        approved: sql<number>`sum(case when ${testimonials.status} = 'approved' then 1 else 0 end)`,
        video: sql<number>`sum(case when ${testimonials.videoKey} is not null then 1 else 0 end)`,
        avg: sql<number | null>`avg(${testimonials.rating})`,
      })
      .from(testimonials)
      .where(where)
      .get();
    return { ...p, received: s?.received ?? 0, approved: Number(s?.approved ?? 0), video: Number(s?.video ?? 0), avg: s?.avg ?? null };
  });
  const active = rows.filter((r) => r.received > 0);
  if (!active.length) return null;
  const lines = active.map(
    (r) =>
      `${r.name}\n  ${r.received} received, ${r.approved} approved, ${r.video} with video${r.avg ? `, average ${Number(r.avg).toFixed(1)}★` : ""}`,
  );
  return {
    to,
    subject: `Your testimonials in ${label}`,
    text: `${label} in numbers.\n\n${lines.join("\n\n")}\n\n${env.publicUrl}/admin\n${SETTINGS_LINE()}\n`,
  };
}

export function importMail(to: string, run: Pick<TaskRun, "id" | "projectId" | "subject" | "done" | "duplicates" | "skipped" | "failed">) {
  if (!run.projectId) return null;
  const name = projectName(run.projectId);
  const parts = [`${run.done} imported`, run.duplicates ? `${run.duplicates} already there` : "", run.skipped ? `${run.skipped} skipped` : "", run.failed ? `${run.failed} failed` : ""].filter(Boolean);
  return {
    to,
    subject: `Import finished for ${clip(name, 80)}: ${run.done} new`,
    text: `The import from ${run.subject ?? "a review site"} has finished: ${parts.join(", ")}.\n\n${env.publicUrl}/admin/projects/${run.projectId}\n${SETTINGS_LINE()}\n`,
  };
}

export async function sendNotificationMail(mail: { to: string; subject: string; text: string } | null) {
  if (!mail || !emailEnabled()) return false;
  await sendMail({ ...mail, headers: { "Auto-Submitted": "auto-generated", "X-Plaudit-Notification": "1" } });
  return true;
}
