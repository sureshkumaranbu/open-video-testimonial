import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema, type Tx } from "@/db";
import {
  APPROVERS,
  CAMPAIGN_STATUSES,
  CASE_STUDY_STATUSES,
  DATE_PRECISIONS,
  FEEDBACK_SOURCES,
  FORM_KINDS,
  FORM_LAYOUTS,
  FORM_STATUSES,
  FORM_VIDEO_SLOTS,
  HISTORY_ACTIONS,
  HISTORY_ACTORS,
  INSIGHT_REPORT_KINDS,
  REDIRECT_KINDS,
  SEO_SCHEMA_TYPES,
  TESTIMONIAL_STATUSES,
  WIDGET_LAYOUTS,
  WIDGET_SELECTION_MODES,
  type DatePrecision,
  type Form,
  type Project,
  type TestimonialStatus,
} from "@/db/schema";
import { caseStudyContentSchema } from "./case-studies";
import { purchaseKeyId } from "./commerce/purchases";
import { MAX_DRAFT_CHARS } from "./commerce/social";
import { DEFAULT_RETENTION_DAYS, MAX_RETENTION_DAYS } from "./commerce/stripe-connection";
import { listConsentEvents, listConsentVersions, logConsentEvent } from "./consent";
import { toCsv } from "./csv";
import { countWords } from "./dates";
import { env } from "./env";
import { ensureDefaultForm } from "./forms";
import { formConfigFromProject, mirrorColumns } from "./forms/defaults";
import { parseFormRow, type FormConfig } from "./forms/schema";
import { reanchorHighlights } from "./highlights";
import { parseDiff, recordHistory } from "./history";
import { PermanentJobError } from "./jobs";
import { queueVideoProcessing } from "./media";
import { findProjectBySlugOrAlias } from "./projects";
import { listRequests } from "./requests";
import { deleteObject, saveFile, sniffMime, storage, type MediaKind } from "./storage";
import { createProject, listProjects, listTestimonials, type TestimonialWithTags } from "./testimonials";
import { queueFormVideo } from "./video/form-videos";
import { reelClipSchema, reelConfigSchema } from "./video/reel-config";
import { boosterDesignSchema, boosterLinksSchema } from "./booster-config";
import { canSync, getAdapter } from "./importers/registry";
import { brandSchema, slugSchema } from "./validation";
import { extractEntry, openZip, readEntryText, ZipError, zipStream, type ZipSource } from "./zip";

/**
 * Export and import. An export is one .zip: `plaudit.json` (versioned, with
 * every testimonial, private fields, tags, consent history, requests and
 * project settings), `testimonials.csv` for spreadsheets, and `media/` with
 * every file. Importing that zip on any Plaudit instance recreates the
 * project, so moving servers or restoring a backup is one step.
 *
 * Phase 1 data (forms, customers, answers, images, highlights, history,
 * feedback, widgets, walls, SEO snippets, old links) rides in the same format
 * version 1, as new keys that older versions ignore: they import a new archive
 * as far as they understand it, and this version imports old archives, giving
 * them a default form from the project's settings.
 *
 * M16–M18 (L21, L23, L25) ride the same way: highlight reels (with the newest
 * rendered file when it fits the video limit), owner form videos, multiclip
 * and social clip definitions (made again after a move; the multiclip shown
 * as a testimonial's video keeps its files), case studies, saved reports,
 * survey answers, social post drafts, Verified purchase marks, purchases
 * (never an email, only its keyed hash) and the Stripe connection without
 * its secrets.
 */
export const EXPORT_FORMAT = "plaudit-export";
export const IMPORT_JOB = "import.archive";
export const EXPORT_VERSION = 1;
const MANIFEST = "plaudit.json";

const {
  projects,
  testimonials,
  tags,
  testimonialTags,
  consentVersions,
  consentEvents,
  requests,
  forms,
  answers,
  customers,
  feedback,
  testimonialImages,
  highlights,
  testimonialHistory,
  widgets,
  walls,
  seoSnippets,
  slugRedirects,
  campaigns,
  boosters,
  boosterClicks,
  rewardCodes,
  importSources,
  translations,
  highlightReels,
  videoRenders,
  formVideos,
  caseStudies,
  insightReports,
  surveyResponses,
  socialDrafts,
  purchases,
  stripeConnections,
} = schema;

const MEDIA_PREFIX = "media/";
const mediaPath = (key: string | null) => (key ? `${MEDIA_PREFIX}${key}` : null);
const iso = (d: Date | null) => d?.toISOString() ?? null;

/** The statuses Plaudit had before Phase 1, the only ones older versions accept in `status`. */
export const LEGACY_STATUSES = ["pending", "approved", "rejected"] as const;
export type LegacyStatus = (typeof LEGACY_STATUSES)[number];

/** Hidden and trashed are written as rejected (never public there); `statusV2` carries the real one. */
export function legacyStatus(s: TestimonialStatus): LegacyStatus {
  return (LEGACY_STATUSES as readonly string[]).includes(s) ? (s as LegacyStatus) : "rejected";
}

/** A JSON column's value, or `fallback` when it can't be read or isn't the same kind (object or array). */
function readJson<T extends object>(raw: string | null, fallback: T): T {
  try {
    const value: unknown = JSON.parse(raw ?? "");
    return value && typeof value === "object" && Array.isArray(value) === Array.isArray(fallback) ? (value as T) : fallback;
  } catch {
    return fallback;
  }
}

function byTestimonial<T extends { testimonialId: string }>(rows: T[]) {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const list = map.get(r.testimonialId);
    if (list) list.push(r);
    else map.set(r.testimonialId, [r]);
  }
  return map;
}

/** The project's answers, images, highlights and history, by testimonial (one query each). */
function relatedRows(projectId: string) {
  const db = getDb();
  const ofProject = () => db.select({ id: testimonials.id }).from(testimonials).where(eq(testimonials.projectId, projectId));
  return {
    answers: byTestimonial(
      db.select().from(answers).where(inArray(answers.testimonialId, ofProject())).orderBy(asc(answers.position)).all(),
    ),
    images: byTestimonial(
      db
        .select()
        .from(testimonialImages)
        .where(inArray(testimonialImages.testimonialId, ofProject()))
        .orderBy(asc(testimonialImages.position))
        .all(),
    ),
    highlights: byTestimonial(
      db.select().from(highlights).where(inArray(highlights.testimonialId, ofProject())).orderBy(asc(highlights.start)).all(),
    ),
    translations: byTestimonial(db.select().from(translations).where(inArray(translations.testimonialId, ofProject())).orderBy(asc(translations.lang)).all()),
    history: byTestimonial(
      db
        .select()
        .from(testimonialHistory)
        .where(inArray(testimonialHistory.testimonialId, ofProject()))
        .orderBy(asc(testimonialHistory.createdAt), sql`rowid`)
        .all(),
    ),
  };
}

type Related = ReturnType<typeof relatedRows>;

function exportTestimonial(t: TestimonialWithTags, related: Related) {
  return {
    id: t.id,
    // Older versions only know pending, approved and rejected; new versions read statusV2 first.
    status: legacyStatus(t.status),
    statusV2: t.status,
    rating: t.rating,
    text: t.text,
    transcript: t.transcript,
    captionsVtt: t.captionsVtt,
    author: {
      name: t.authorName,
      email: t.authorEmail,
      title: t.authorTitle,
      company: t.authorCompany,
      website: t.authorWebsite,
      phone: t.authorPhone,
      socials: readJson<Record<string, string>>(t.authorSocials, {}),
    },
    tags: t.tags,
    source: t.source,
    requestId: t.requestId,
    approvedBy: t.approvedBy,
    approvedAt: iso(t.approvedAt),
    approvalRule: t.approvalRule,
    consent: {
      at: t.consentAt.toISOString(),
      scopes: JSON.parse(t.consentScopes) as string[],
      editedAfterConsent: t.editedAfterConsent,
      withdrawnAt: iso(t.withdrawnAt),
      events: listConsentEvents(t.id).map((e) => ({
        type: e.type,
        actor: e.actor,
        versionId: e.versionId,
        text: e.text,
        textHash: e.textHash,
        scopes: e.scopes ? (JSON.parse(e.scopes) as string[]) : null,
        ipHash: e.ipHash,
        detail: e.detail,
        at: e.createdAt.toISOString(),
      })),
    },
    media: {
      video: mediaPath(t.videoKey),
      videoMime: t.videoMime,
      videoOriginal: t.videoOriginalKey !== t.videoKey ? mediaPath(t.videoOriginalKey) : null,
      poster: mediaPath(t.posterKey),
      avatar: mediaPath(t.avatarKey),
      companyLogo: mediaPath(t.companyLogoKey),
      durationMs: t.videoDurationMs,
      width: t.videoWidth,
      height: t.videoHeight,
    },
    formId: t.formId,
    customerId: t.customerId,
    headline: t.headline,
    platform: t.platform,
    sourceUrl: t.sourceUrl,
    sourceReviewId: t.sourceReviewId,
    sourceDate: iso(t.sourceDate),
    datePrecision: t.datePrecision,
    importedAt: iso(t.importedAt),
    language: t.language,
    primaryQuestion: t.primaryQuestion,
    customFields: readJson<Record<string, unknown>>(t.customFields, {}),
    hiddenFields: readJson<Record<string, string>>(t.hiddenFields, {}),
    isFeatured: t.isFeatured,
    pinOrder: t.pinOrder,
    consentPublic: t.consentPublic,
    trashedAt: iso(t.trashedAt),
    statusBeforeTrash: t.statusBeforeTrash,
    answers: (related.answers.get(t.id) ?? []).map((a) => ({
      id: a.id,
      questionKey: a.questionKey,
      questionTitle: a.questionTitle,
      position: a.position,
      text: a.text,
      transcript: a.transcript,
      captionsVtt: a.captionsVtt,
      media: {
        video: mediaPath(a.videoKey),
        videoMime: a.videoMime,
        videoOriginal: a.videoOriginalKey !== a.videoKey ? mediaPath(a.videoOriginalKey) : null,
        poster: mediaPath(a.posterKey),
        durationMs: a.videoDurationMs,
        width: a.videoWidth,
        height: a.videoHeight,
      },
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
    })),
    images: (related.images.get(t.id) ?? []).map((i) => ({
      questionKey: i.questionKey,
      image: mediaPath(i.key),
      alt: i.alt,
      position: i.position,
      // M13 (INBOX-11): merged in from a testimonial that wasn't public; stays owner-only.
      ownerOnly: i.ownerOnly,
      createdAt: i.createdAt.toISOString(),
    })),
    // M13 (INBOX-13): its translations.
    translations: (related.translations.get(t.id) ?? []).map((x) => ({
      lang: x.lang,
      headline: x.headline,
      text: x.text,
      machine: x.machine,
      createdAt: x.createdAt.toISOString(),
      updatedAt: x.updatedAt.toISOString(),
    })),
    // M13 (INBOX-11): the testimonial this one was merged into.
    mergedIntoId: t.mergedIntoId,
    // M18 (INT-07): marked "Verified purchase".
    verifiedPurchaseAt: iso(t.verifiedPurchaseAt),
    highlights: (related.highlights.get(t.id) ?? []).map((h) => ({
      answerId: h.answerId,
      start: h.start,
      end: h.end,
      phrase: h.phrase,
      createdAt: h.createdAt.toISOString(),
    })),
    history: (related.history.get(t.id) ?? []).map((h) => ({
      actor: h.actor,
      actorEmail: h.actorEmail,
      action: h.action,
      diff: parseDiff(h.diff),
      at: h.createdAt.toISOString(),
    })),
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

/** Every form with its whole config, the default first. */
function exportForms(project: Project) {
  return getDb()
    .select()
    .from(forms)
    .where(eq(forms.projectId, project.id))
    .orderBy(desc(forms.isDefault), asc(forms.createdAt))
    .all()
    .map((f) => {
      // A default form migration 0009 made and nothing has read since is what the project's columns say.
      const cfg = f.configVersion === 0 ? formConfigFromProject(project) : parseFormRow(f);
      return {
        id: f.id,
        slug: f.slug,
        name: f.name,
        status: f.status,
        layout: f.layout,
        kind: f.kind,
        isDefault: f.isDefault,
        language: f.language,
        template: f.template,
        logo: mediaPath(f.logoKey),
        pages: cfg.pages,
        design: cfg.design,
        labels: cfg.labels,
        settings: cfg.settings,
        reward: readJson<Record<string, unknown>>(f.reward, {}),
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      };
    });
}

export function buildManifest(project: Project) {
  const db = getDb();
  const items = listTestimonials(project.id);
  const related = relatedRows(project.id);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    generator: "Plaudit",
    project: {
      slug: project.slug,
      name: project.name,
      // The legacy form fields mirror the default form (forms[] has the whole of it), so older versions still get its settings.
      prompt: project.prompt,
      thankYouMessage: project.thankYouMessage,
      accentColor: project.accentColor,
      allowVideo: project.allowVideo,
      allowText: project.allowText,
      questions: project.questions,
      maxVideoSeconds: project.maxVideoSeconds,
      consentText: project.consentText,
      inviteSubject: project.inviteSubject,
      inviteMessage: project.inviteMessage,
      reminderDays: project.reminderDays,
      thankYouEmail: project.thankYouEmail,
      autoApprove: project.autoApprove,
      autoApproveMinRating: project.autoApproveMinRating,
      autoApproveVideo: project.autoApproveVideo,
      website: project.website,
      businessType: project.businessType,
      brand: readJson<Record<string, unknown>>(project.brand, {}),
      logo: mediaPath(project.logoKey),
      createdAt: project.createdAt.toISOString(),
    },
    consentVersions: listConsentVersions(project.id).map((v) => ({
      id: v.id,
      version: v.version,
      text: v.text,
      hash: v.hash,
      createdAt: v.createdAt.toISOString(),
    })),
    forms: exportForms(project),
    customers: db
      .select()
      .from(customers)
      .where(eq(customers.projectId, project.id))
      .orderBy(asc(customers.createdAt))
      .all()
      .map((c) => ({
        id: c.id,
        email: c.email,
        name: c.name,
        title: c.title,
        company: c.company,
        website: c.website,
        avatar: mediaPath(c.avatarKey),
        socials: readJson<Record<string, string>>(c.socials, {}),
        custom: readJson<Record<string, unknown>>(c.custom, {}),
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    testimonials: items.map((t) => exportTestimonial(t, related)),
    requests: listRequests(project.id).map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      company: r.company,
      status: r.status,
      sentAt: iso(r.sentAt),
      remindersSent: r.remindersSent,
      respondedAt: iso(r.respondedAt),
      unsubscribedAt: iso(r.unsubscribedAt),
      testimonialId: r.testimonialId,
      formId: r.formId,
      createdAt: r.createdAt.toISOString(),
      // M9 (L14): campaign recipients stay recipients of their campaign.
      campaignId: r.campaignId,
      title: r.title,
      custom: readJson<Record<string, string>>(r.custom, {}),
      scheduledFor: iso(r.scheduledFor),
      openedAt: iso(r.openedAt),
      clickedAt: iso(r.clickedAt),
      startedAt: iso(r.startedAt),
      declinedAt: iso(r.declinedAt),
    })),
    // L14: campaigns (M9), review boosters and their clicks, reward code pools (M10); M13's synced sources (never a secret).
    campaigns: db
      .select()
      .from(campaigns)
      .where(eq(campaigns.projectId, project.id))
      .orderBy(asc(campaigns.createdAt))
      .all()
      .map((c) => ({
        id: c.id,
        formId: c.formId,
        name: c.name,
        status: c.status,
        senderName: c.senderName,
        replyTo: c.replyTo,
        subject: c.subject,
        body: c.body,
        buttonText: c.buttonText,
        rtl: c.rtl,
        reminders: readJson<number[]>(c.reminders, []),
        trackOpens: c.trackOpens,
        rewardCodes: c.rewardCodes,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    boosters: db
      .select()
      .from(boosters)
      .where(eq(boosters.projectId, project.id))
      .orderBy(asc(boosters.createdAt))
      .all()
      .map((b) => ({
        id: b.id,
        slug: b.slug,
        name: b.name,
        published: b.published,
        title: b.title,
        message: b.message,
        links: readJson<unknown[]>(b.links, []),
        design: readJson<Record<string, unknown>>(b.design, {}),
        logo: mediaPath(b.logoKey),
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
      })),
    boosterClicks: db
      .select({ boosterId: boosterClicks.boosterId, linkId: boosterClicks.linkId, day: boosterClicks.day, count: boosterClicks.count })
      .from(boosterClicks)
      .innerJoin(boosters, eq(boosters.id, boosterClicks.boosterId))
      .where(eq(boosters.projectId, project.id))
      .orderBy(asc(boosterClicks.day))
      .all(),
    rewardCodes: db
      .select()
      .from(rewardCodes)
      .where(eq(rewardCodes.projectId, project.id))
      .orderBy(asc(rewardCodes.createdAt))
      .all()
      .map((r) => ({
        formId: r.formId,
        code: r.code,
        claimedAt: iso(r.claimedAt),
        testimonialId: r.testimonialId,
        feedbackId: r.feedbackId,
        requestId: r.requestId,
        createdAt: r.createdAt.toISOString(),
      })),
    importSources: db
      .select()
      .from(importSources)
      .where(eq(importSources.projectId, project.id))
      .orderBy(asc(importSources.createdAt))
      .all()
      .map((x) => ({
        adapter: x.adapter,
        input: Object.fromEntries(Object.entries(readJson<Record<string, unknown>>(x.input, {})).filter(([k]) => !SECRET_KEYS.test(k))),
        options: readJson<Record<string, unknown>>(x.options, {}),
        label: x.label,
        intervalHours: x.intervalHours,
        paused: x.paused,
        itemsAdded: x.itemsAdded,
        createdAt: x.createdAt.toISOString(),
      })),
    feedback: db
      .select()
      .from(feedback)
      .where(eq(feedback.projectId, project.id))
      .orderBy(asc(feedback.createdAt))
      .all()
      .map((f) => ({
        id: f.id,
        formId: f.formId,
        customerId: f.customerId,
        testimonialId: f.testimonialId,
        source: f.source,
        rating: f.rating,
        text: f.text,
        authorName: f.authorName,
        authorEmail: f.authorEmail,
        trashedAt: iso(f.trashedAt),
        createdAt: f.createdAt.toISOString(),
      })),
    // Deleted widgets too: their embeds keep showing nothing rather than an error.
    widgets: db
      .select()
      .from(widgets)
      .where(eq(widgets.projectId, project.id))
      .orderBy(asc(widgets.createdAt))
      .all()
      .map((w) => ({
        id: w.id,
        name: w.name,
        layout: w.layout,
        selectionMode: w.selectionMode,
        manualIds: readJson<string[]>(w.manualIds, []),
        pinnedIds: readJson<string[]>(w.pinnedIds, []),
        filters: readJson<Record<string, unknown>>(w.filters, {}),
        design: readJson<Record<string, unknown>>(w.design, {}),
        labels: readJson<Record<string, unknown>>(w.labels, {}),
        options: readJson<Record<string, unknown>>(w.options, {}),
        configVersion: w.configVersion,
        connectedFormId: w.connectedFormId,
        placement: w.placement,
        deletedAt: iso(w.deletedAt),
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
      })),
    walls: db
      .select()
      .from(walls)
      .where(eq(walls.projectId, project.id))
      .orderBy(asc(walls.createdAt))
      .all()
      .map((w) => ({
        id: w.id,
        slug: w.slug,
        name: w.name,
        published: w.published,
        isMain: w.isMain,
        theme: w.theme,
        config: readJson<Record<string, unknown>>(w.config, {}),
        logo: mediaPath(w.logoKey),
        cover: mediaPath(w.coverKey),
        featuredTestimonialId: w.featuredTestimonialId,
        connectedFormId: w.connectedFormId,
        configVersion: w.configVersion,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
      })),
    seoSnippets: db
      .select()
      .from(seoSnippets)
      .where(eq(seoSnippets.projectId, project.id))
      .orderBy(asc(seoSnippets.createdAt))
      .all()
      .map((s) => ({
        id: s.id,
        name: s.name,
        schemaType: s.schemaType,
        scope: readJson<Record<string, unknown>>(s.scope, {}),
        item: readJson<Record<string, unknown>>(s.item, {}),
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
      })),
    // Old slugs of the project, its forms and its walls, so links made before a rename keep working after a move.
    redirects: db
      .select()
      .from(slugRedirects)
      .where(eq(slugRedirects.projectId, project.id))
      .orderBy(asc(slugRedirects.createdAt))
      .all()
      .map((r) => ({ kind: r.kind, oldSlug: r.oldSlug, formId: r.formId, wallId: r.wallId, boosterId: r.boosterId, createdAt: r.createdAt.toISOString() })),
    ...m16to18(project),
  };
}

/** L21, L23, L25: what M16, M17 and M18 added, as manifest keys older versions ignore. */
function m16to18(project: Project) {
  const db = getDb();
  const renders = db.select().from(videoRenders).where(eq(videoRenders.projectId, project.id)).orderBy(asc(videoRenders.createdAt)).all();
  const reels = db.select().from(highlightReels).where(eq(highlightReels.projectId, project.id)).orderBy(asc(highlightReels.createdAt)).all();
  const formIds = db.select({ id: forms.id }).from(forms).where(eq(forms.projectId, project.id));
  const connection = db.select().from(stripeConnections).where(eq(stripeConnections.projectId, project.id)).get();
  return {
    highlightReels: reels.map((r) => {
      // The newest rendered file comes along when it fits the video limit an import checks; otherwise it's made again.
      const file = renders
        .filter((x) => x.reelId === r.id && x.kind === "reel" && x.status === "ready" && x.key && (x.sizeBytes ?? 0) <= env.maxVideoBytes)
        .at(-1);
      return {
        id: r.id,
        name: r.name,
        config: readJson<Record<string, unknown>>(r.config, {}),
        render: file
          ? { video: mediaPath(file.key), options: readJson<Record<string, unknown>>(file.options, {}), durationMs: file.durationMs, width: file.width, height: file.height, sizeBytes: file.sizeBytes, createdAt: file.createdAt.toISOString() }
          : null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    }),
    // Multiclips and social clips as definitions; the one in use as a testimonial's video keeps the answer's own file, so switching back still works.
    renders: renders
      .filter((r) => (r.kind === "multiclip" || r.kind === "social") && r.testimonialId && (r.status === "ready" || r.usedAsVideo))
      .map((r) => ({
        testimonialId: r.testimonialId,
        kind: r.kind,
        options: readJson<Record<string, unknown>>(r.options, {}),
        usedAsVideo: r.usedAsVideo,
        replaced: r.usedAsVideo ? mediaPath(r.replacedKey) : null,
        createdAt: r.createdAt.toISOString(),
      })),
    formVideos: db
      .select()
      .from(formVideos)
      .where(inArray(formVideos.formId, formIds))
      .orderBy(asc(formVideos.createdAt))
      .all()
      .map((v) => ({
        formId: v.formId,
        slot: v.slot,
        media: {
          video: mediaPath(v.videoKey),
          videoMime: v.videoMime,
          videoOriginal: v.videoOriginalKey !== v.videoKey ? mediaPath(v.videoOriginalKey) : null,
          poster: mediaPath(v.posterKey),
          durationMs: v.videoDurationMs,
          width: v.videoWidth,
          height: v.videoHeight,
        },
        transcript: v.transcript,
        captionsVtt: v.captionsVtt,
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
      })),
    caseStudies: db
      .select()
      .from(caseStudies)
      .where(eq(caseStudies.projectId, project.id))
      .orderBy(asc(caseStudies.createdAt))
      .all()
      .map((c) => ({
        id: c.id,
        testimonialId: c.testimonialId,
        status: c.status,
        title: c.title,
        content: readJson<Record<string, unknown>>(c.content, {}),
        aiDraftedAt: iso(c.aiDraftedAt),
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    insightReports: db
      .select()
      .from(insightReports)
      .where(eq(insightReports.projectId, project.id))
      .orderBy(asc(insightReports.createdAt))
      .all()
      .map((r) => ({
        kind: r.kind,
        name: r.name,
        params: readJson<Record<string, unknown>>(r.params, {}),
        result: readJson<Record<string, unknown>>(r.result, {}),
        createdBy: r.createdBy,
        createdAt: r.createdAt.toISOString(),
      })),
    surveyResponses: db
      .select()
      .from(surveyResponses)
      .where(eq(surveyResponses.projectId, project.id))
      .orderBy(asc(surveyResponses.createdAt))
      .all()
      .map((r) => ({
        formId: r.formId,
        testimonialId: r.testimonialId,
        questionKey: r.questionKey,
        score: r.score,
        comment: r.comment,
        authorName: r.authorName,
        authorEmail: r.authorEmail,
        createdAt: r.createdAt.toISOString(),
      })),
    socialDrafts: db
      .select()
      .from(socialDrafts)
      .where(eq(socialDrafts.projectId, project.id))
      .orderBy(asc(socialDrafts.createdAt))
      .all()
      .map((d) => ({ testimonialId: d.testimonialId, text: d.text, editedBy: d.editedBy, aiRewrittenAt: iso(d.aiRewrittenAt), createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString() })),
    // Which server's key made the hashes: another server's can't match them, so it drops them on import.
    purchaseKeyId: purchaseKeyId(),
    purchases: db
      .select()
      .from(purchases)
      .where(eq(purchases.projectId, project.id))
      .orderBy(asc(purchases.purchasedAt))
      .all()
      .map((x) => ({
        externalId: x.externalId,
        eventType: x.eventType,
        firstName: x.firstName,
        place: x.place,
        product: x.product,
        amount: x.amount,
        currency: x.currency,
        emailHash: x.emailHash,
        purchasedAt: x.purchasedAt.toISOString(),
        createdAt: x.createdAt.toISOString(),
      })),
    // Never the signing secret or the restricted key: they're pasted again after an import.
    stripeConnection: connection
      ? {
          enabled: connection.enabled,
          retentionDays: connection.retentionDays,
          verifyPurchases: connection.verifyPurchases,
          defaultProduct: connection.defaultProduct,
          createdAt: connection.createdAt.toISOString(),
        }
      : null,
  };
}

export type Manifest = ReturnType<typeof buildManifest>;

/** Keys that could hold a secret: never exported (a synced source's input never has one, but this makes sure). */
const SECRET_KEYS = /key|token|secret|password/i;

/** Every stored file the manifest points at, once each. */
function manifestKeys(m: Manifest): string[] {
  const refs = [
    m.project.logo,
    ...m.forms.map((f) => f.logo),
    ...m.customers.map((c) => c.avatar),
    ...m.walls.flatMap((w) => [w.logo, w.cover]),
    ...m.boosters.map((b) => b.logo),
    ...m.formVideos.flatMap((v) => [v.media.video, v.media.videoOriginal, v.media.poster]),
    ...m.highlightReels.map((r) => r.render?.video ?? null),
    ...m.renders.map((r) => r.replaced),
    ...m.testimonials.flatMap((t) => [
      t.media.video,
      t.media.videoOriginal,
      t.media.poster,
      t.media.avatar,
      t.media.companyLogo,
      ...t.answers.flatMap((a) => [a.media.video, a.media.videoOriginal, a.media.poster]),
      ...t.images.map((i) => i.image),
    ]),
  ];
  return [...new Set(refs.filter((r): r is string => Boolean(r)).map((r) => r.slice(MEDIA_PREFIX.length)))];
}

// --------------------------------------------------------------------- CSV

export const CSV_HEADERS = [
  "id", "status", "name", "email", "title", "company", "rating", "text", "transcript", "tags",
  "video_url", "poster_url", "avatar_url", "source", "consent_scopes", "edited_after_consent",
  "withdrawn_at", "created_at",
];

/** Phase 1 columns, after the original ones (which keep their places, so older spreadsheets still line up). */
export const CSV_V1X_HEADERS = ["form", "headline", "platform", "source_url", "source_date", "language"];

/** The custom and hidden field keys that get a column each (`custom:<key>`, `hidden:<key>`). */
export type CsvKeys = { customKeys: string[]; hiddenKeys: string[] };

/** Every custom and hidden field key these testimonials use, sorted. */
export function csvKeys(items: TestimonialWithTags[]): CsvKeys {
  const custom = new Set<string>();
  const hidden = new Set<string>();
  for (const t of items) {
    for (const k of Object.keys(readJson(t.customFields, {}))) custom.add(k);
    for (const k of Object.keys(readJson(t.hiddenFields, {}))) hidden.add(k);
  }
  return { customKeys: [...custom].sort(), hiddenKeys: [...hidden].sort() };
}

/** A source date only as exact as it's known: 2026-10-12, 2026-10 or 2026. */
const SOURCE_DATE_LENGTH: Record<DatePrecision, number> = { day: 10, month: 7, year: 4 };

function fieldValue(v: unknown): unknown {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.map(fieldValue).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return v;
}

function formNames(items: TestimonialWithTags[]) {
  const ids = [...new Set(items.flatMap((t) => (t.formId ? [t.formId] : [])))];
  if (!ids.length) return new Map<string, string>();
  return new Map(
    getDb()
      .select({ id: forms.id, name: forms.name })
      .from(forms)
      .where(inArray(forms.id, ids))
      .all()
      .map((f) => [f.id, f.name]),
  );
}

/**
 * testimonials.csv as headers and rows. Without `keys`, there's a column for
 * every custom and hidden field these testimonials use; an export that writes
 * in chunks passes the keys of the whole set, so every chunk has the same
 * columns.
 */
export function csvRows(items: TestimonialWithTags[], keys: Partial<CsvKeys> = {}) {
  const used = keys.customKeys && keys.hiddenKeys ? null : csvKeys(items);
  const customKeys = keys.customKeys ?? used!.customKeys;
  const hiddenKeys = keys.hiddenKeys ?? used!.hiddenKeys;
  const names = formNames(items);
  const url = (key: string | null) => (key ? `${env.publicUrl}/api/media/${key}` : "");
  return {
    headers: [...CSV_HEADERS, ...CSV_V1X_HEADERS, ...customKeys.map((k) => `custom:${k}`), ...hiddenKeys.map((k) => `hidden:${k}`)],
    rows: items.map((t) => {
      const custom = readJson<Record<string, unknown>>(t.customFields, {});
      const hidden = readJson<Record<string, unknown>>(t.hiddenFields, {});
      return [
        t.id, t.status, t.authorName, t.authorEmail, t.authorTitle, t.authorCompany, t.rating, t.text, t.transcript,
        t.tags.join(", "), url(t.videoKey), url(t.posterKey), url(t.avatarKey), t.source,
        (JSON.parse(t.consentScopes) as string[]).join(", "), t.editedAfterConsent ? "yes" : "no",
        t.withdrawnAt?.toISOString() ?? "", t.createdAt.toISOString(),
        t.formId ? (names.get(t.formId) ?? "") : "", t.headline, t.platform, t.sourceUrl,
        t.sourceDate?.toISOString().slice(0, SOURCE_DATE_LENGTH[t.datePrecision]) ?? "", t.language,
        ...customKeys.map((k) => fieldValue(custom[k])),
        ...hiddenKeys.map((k) => fieldValue(hidden[k])),
      ];
    }),
  };
}

export function testimonialsCsv(items: TestimonialWithTags[]) {
  const { headers, rows } = csvRows(items);
  return toCsv(headers, rows);
}

// ------------------------------------------------------------------ export

/**
 * Each stored file as a zip entry, read through the storage driver: on S3 a
 * temporary local copy, kept until the zip writer has read it (it reads an
 * entry whole before asking for the next) and then removed.
 */
async function* mediaEntries(keys: string[]): AsyncGenerator<ZipSource> {
  for (const key of keys) {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let located!: (file: string) => void;
    const local = new Promise<string>((resolve) => (located = resolve));
    const held = storage().withLocalFile(key, async (file) => {
      located(file);
      await released;
    });
    try {
      const file = await Promise.race([local, held.then(() => null)]);
      if (file && fs.existsSync(file)) yield { name: `${MEDIA_PREFIX}${key}`, file };
    } finally {
      release();
      await held;
    }
  }
}

/** The export archive as a byte stream. */
export function exportZip(project: Project): ReadableStream<Uint8Array> {
  const manifest = buildManifest(project);
  const items = listTestimonials(project.id);
  async function* entries(): AsyncGenerator<ZipSource> {
    yield { name: MANIFEST, data: JSON.stringify(manifest, null, 2) };
    yield { name: "testimonials.csv", data: testimonialsCsv(items) };
    yield {
      name: "README.txt",
      data:
        `Plaudit export of "${project.name}" (${manifest.exportedAt}).\n\n` +
        "plaudit.json     everything, including private fields and consent history (format version 1)\n" +
        "testimonials.csv one row per testimonial, for spreadsheets\n" +
        "media/           videos, posters, photos, logos, images and highlight reels\n\n" +
        "Import it on any Plaudit server from the admin home page (Import a project).\n" +
        "This file contains personal data (names, emails, consent records). Store it securely.\n",
    };
    yield* mediaEntries(manifestKeys(manifest));
  }
  const iterator = zipStream(entries());
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}

// ------------------------------------------------------------------ import

const isoDate = z.iso.datetime({ offset: true });
const nullableIso = isoDate.nullable().optional();

// Phase 1 keys are read leniently: a value this version can't use falls back
// to its default instead of failing the import, so an archive from a newer
// version (new enum values, new config keys) still comes in.
const when = isoDate.nullable().catch(null);
const textOrNull = (max: number) => z.string().max(max).nullable().catch(null);
const mediaRef = z.string().max(200).nullable().catch(null);
/** An id in the archive; `undefined` when the key is missing (an archive from before it existed). */
const ref = z.string().max(200).nullable().optional().catch(null);
const jsonObject = z.record(z.string(), z.unknown()).catch({});
const stringRecord = z.record(z.string(), z.string()).catch({});
const idList = z.array(z.string()).catch([]);
const label = (max: number, fallback: string) =>
  z
    .string()
    .catch("")
    .transform((s) => s.trim().slice(0, max).trim() || fallback);
/** Only http(s) addresses: these may become links on public pages. Optional first, or zod counts the key as required. */
const webAddress = z
  .unknown()
  .optional()
  .transform((v) => (typeof v === "string" && v.length <= 2000 && /^https?:\/\//i.test(v) && URL.canParse(v) ? v : null));

/** A list where an entry that can't be read is left out instead of failing the whole import. */
const listOf = <T extends z.ZodType>(item: T) =>
  z
    .array(z.unknown())
    .catch([])
    .transform((items) =>
      items.flatMap((i) => {
        const parsed = item.safeParse(i);
        return parsed.success ? [parsed.data as z.output<T>] : [];
      }),
    );

const mediaSchema = z
  .object({
    video: mediaRef,
    videoMime: textOrNull(100),
    videoOriginal: mediaRef,
    poster: mediaRef,
    durationMs: z.number().int().nullable().catch(null),
    width: z.number().int().nullable().catch(null),
    height: z.number().int().nullable().catch(null),
  })
  // Each field falls back by itself; this only catches a missing or non-object value.
  .catch({ video: null, videoMime: null, videoOriginal: null, poster: null, durationMs: null, width: null, height: null });

const answerSchema = z.object({
  id: z.string(),
  questionKey: z.string().min(1).max(40),
  questionTitle: z.string().max(300).catch(""),
  position: z.number().int().catch(0),
  text: textOrNull(10_000),
  transcript: textOrNull(50_000),
  captionsVtt: textOrNull(200_000),
  media: mediaSchema,
  createdAt: when,
  updatedAt: when,
});

const imageSchema = z.object({
  questionKey: textOrNull(40),
  image: z.string().max(200),
  alt: textOrNull(500),
  position: z.number().int().catch(0),
  ownerOnly: z.boolean().catch(false),
  createdAt: when,
});

const translationSchema = z.object({
  lang: z.string().trim().toLowerCase().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8}){0,2}$/),
  headline: textOrNull(200),
  text: textOrNull(10_000),
  machine: z.boolean().catch(false),
  createdAt: when,
  updatedAt: when,
});

const campaignSchema = z.object({
  id: z.string(),
  formId: ref,
  name: label(120, "Campaign"),
  status: z.enum(CAMPAIGN_STATUSES).catch("draft"),
  senderName: z.string().max(80).catch(""),
  replyTo: z.string().max(254).catch(""),
  subject: z.string().max(200).catch(""),
  body: z.string().max(10_000).catch(""),
  buttonText: z.string().max(60).catch(""),
  rtl: z.boolean().catch(false),
  reminders: z.array(z.number().int().min(1).max(60)).max(3).catch([]),
  trackOpens: z.boolean().catch(false),
  rewardCodes: z.boolean().catch(false),
  createdAt: when,
  updatedAt: when,
});

const boosterSchema = z.object({
  id: z.string(),
  slug: z.string().max(48).catch(""),
  name: label(120, "Review booster"),
  published: z.boolean().catch(false),
  title: z.string().max(200).catch(""),
  message: z.string().max(2000).catch(""),
  links: z.array(z.unknown()).max(50).catch([]),
  design: jsonObject,
  logo: mediaRef,
  createdAt: when,
  updatedAt: when,
});

const boosterClickSchema = z.object({
  boosterId: z.string(),
  linkId: z.string().min(1).max(64),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  count: z.number().int().min(0),
});

const rewardCodeSchema = z.object({
  formId: z.string(),
  code: z.string().min(1).max(100),
  claimedAt: when,
  testimonialId: ref,
  feedbackId: ref,
  requestId: ref,
  createdAt: when,
});

const importSourceSchema = z.object({
  adapter: z.string().max(40),
  input: jsonObject,
  options: jsonObject,
  label: z.string().max(200).catch(""),
  intervalHours: z.union([z.literal(12), z.literal(24)]).catch(24),
  paused: z.boolean().catch(false),
  itemsAdded: z.number().int().min(0).catch(0),
  createdAt: when,
});

const highlightSchema = z
  .object({
    answerId: z.string().nullable().catch(null),
    start: z.number().int().min(0),
    end: z.number().int().min(1),
    phrase: z.string().min(1).max(10_000),
    createdAt: when,
  })
  .refine((h) => h.start < h.end);

const historySchema = z.object({
  actor: z.enum(HISTORY_ACTORS).catch("system"),
  actorEmail: textOrNull(254),
  // An action this version doesn't know leaves the entry out (listOf).
  action: z.enum(HISTORY_ACTIONS),
  diff: jsonObject,
  at: isoDate,
});

const formSchema = z.object({
  id: z.string(),
  slug: z.string().max(48).catch(""),
  name: label(120, "Form"),
  status: z.enum(FORM_STATUSES).catch("live"),
  layout: z.enum(FORM_LAYOUTS).catch("steps"),
  // NPS-01 (M17); older archives have none.
  kind: z.enum(FORM_KINDS).catch("testimonial"),
  isDefault: z.boolean().catch(false),
  language: z.string().trim().min(1).max(16).catch("en"),
  template: textOrNull(40),
  logo: mediaRef,
  // Checked by parseFormRow on import, which keeps what's valid and fills in the rest.
  pages: z.unknown(),
  design: z.unknown(),
  labels: z.unknown(),
  settings: z.unknown(),
  reward: jsonObject,
  createdAt: when,
  updatedAt: when,
});

const customerSchema = z.object({
  id: z.string(),
  email: textOrNull(254),
  name: z.string().trim().min(1).max(120),
  title: textOrNull(120),
  company: textOrNull(120),
  website: webAddress,
  avatar: mediaRef,
  socials: stringRecord,
  custom: jsonObject,
  createdAt: when,
  updatedAt: when,
});

const feedbackSchema = z.object({
  id: z.string(),
  formId: ref,
  customerId: ref,
  testimonialId: ref,
  source: z.enum(FEEDBACK_SOURCES).catch("private-question"),
  rating: z.number().int().min(0).max(10).nullable().catch(null),
  text: z.string().min(1).max(10_000),
  authorName: textOrNull(120),
  authorEmail: textOrNull(254),
  trashedAt: when,
  createdAt: when,
});

const widgetSchema = z.object({
  id: z.string(),
  name: label(120, "Widget"),
  layout: z.enum(WIDGET_LAYOUTS).catch("grid"),
  selectionMode: z.enum(WIDGET_SELECTION_MODES).catch("auto"),
  manualIds: idList,
  pinnedIds: idList,
  filters: jsonObject,
  design: jsonObject,
  labels: jsonObject,
  options: jsonObject,
  configVersion: z.number().int().min(0).catch(1),
  connectedFormId: ref,
  placement: textOrNull(200),
  deletedAt: when,
  createdAt: when,
  updatedAt: when,
});

const wallSchema = z.object({
  id: z.string(),
  slug: z.string().max(48).catch(""),
  name: label(120, "Wall of love"),
  published: z.boolean().catch(false),
  isMain: z.boolean().catch(false),
  theme: z.string().trim().min(1).max(40).catch("paper"),
  config: jsonObject,
  logo: mediaRef,
  cover: mediaRef,
  featuredTestimonialId: ref,
  connectedFormId: ref,
  configVersion: z.number().int().min(0).catch(1),
  createdAt: when,
  updatedAt: when,
});

const seoSnippetSchema = z.object({
  id: z.string(),
  name: label(120, "Rich snippet"),
  schemaType: z.enum(SEO_SCHEMA_TYPES).catch("Product"),
  scope: jsonObject,
  item: jsonObject,
  createdAt: when,
  updatedAt: when,
});

const redirectSchema = z.object({
  kind: z.enum(REDIRECT_KINDS),
  oldSlug: z.string().max(48),
  formId: ref,
  wallId: ref,
  boosterId: ref,
  createdAt: when,
});

// M16–M18 (L21, L23, L25). Each list falls back to empty, so archives from before them still import.
const reelSchema = z.object({
  id: z.string(),
  name: label(120, "Highlight reel"),
  // Checked with reelConfigSchema once its testimonial ids are mapped.
  config: jsonObject,
  render: z
    .object({
      video: z.string().max(200),
      options: jsonObject,
      durationMs: z.number().int().nullable().catch(null),
      width: z.number().int().nullable().catch(null),
      height: z.number().int().nullable().catch(null),
      sizeBytes: z.number().int().nullable().catch(null),
      createdAt: when,
    })
    .nullable()
    .catch(null),
  createdAt: when,
  updatedAt: when,
});

const renderDefSchema = z.object({
  testimonialId: z.string(),
  kind: z.enum(["multiclip", "social"]),
  options: jsonObject,
  usedAsVideo: z.boolean().catch(false),
  replaced: mediaRef,
  createdAt: when,
});

const formVideoSchema = z.object({
  formId: z.string(),
  slot: z.enum(FORM_VIDEO_SLOTS),
  media: mediaSchema,
  transcript: textOrNull(50_000),
  captionsVtt: textOrNull(200_000),
  createdAt: when,
  updatedAt: when,
});

const caseStudySchema = z.object({
  id: z.string(),
  testimonialId: z.string(),
  status: z.enum(CASE_STUDY_STATUSES).catch("draft"),
  title: label(160, "Case study"),
  content: z.unknown(),
  aiDraftedAt: when,
  createdAt: when,
  updatedAt: when,
});

const insightReportSchema = z.object({
  kind: z.enum(INSIGHT_REPORT_KINDS),
  name: label(120, "Report"),
  params: jsonObject,
  result: jsonObject,
  createdBy: textOrNull(254),
  createdAt: when,
});

const surveyResponseSchema = z.object({
  formId: ref,
  testimonialId: ref,
  questionKey: z.string().min(1).max(40),
  score: z.number().int().min(0).max(10),
  comment: textOrNull(10_000),
  authorName: textOrNull(120),
  authorEmail: textOrNull(254),
  createdAt: when,
});

const socialDraftSchema = z.object({
  testimonialId: z.string(),
  text: z.string().trim().min(1).max(MAX_DRAFT_CHARS),
  editedBy: textOrNull(254),
  aiRewrittenAt: when,
  createdAt: when,
  updatedAt: when,
});

const purchaseSchema = z.object({
  externalId: z.string().min(1).max(200),
  eventType: z.string().max(60).catch("checkout.session.completed"),
  firstName: textOrNull(40),
  place: textOrNull(60),
  product: textOrNull(80),
  amount: z.number().int().min(0).nullable().catch(null),
  currency: z.string().regex(/^[a-z]{3}$/).nullable().catch(null),
  emailHash: z.string().regex(/^[0-9a-f]{64}$/).nullable().catch(null),
  purchasedAt: isoDate,
  createdAt: when,
});

const stripeConnectionSchema = z
  .object({
    enabled: z.boolean().catch(true),
    retentionDays: z.number().int().min(1).max(MAX_RETENTION_DAYS).catch(DEFAULT_RETENTION_DAYS),
    verifyPurchases: z.boolean().catch(true),
    defaultProduct: z.string().trim().max(80).catch(""),
    createdAt: when,
  })
  .nullable()
  .optional()
  .catch(null);

const manifestSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  project: z.object({
    slug: z.string().max(48),
    name: z.string().min(1).max(80),
    prompt: z.string().max(300),
    thankYouMessage: z.string().max(300),
    accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    allowVideo: z.boolean(),
    allowText: z.boolean(),
    questions: z.string().max(1200).default(""),
    maxVideoSeconds: z.number().int().min(15).max(600).default(120),
    consentText: z.string().max(1000).default(""),
    inviteSubject: z.string().max(200).default(""),
    inviteMessage: z.string().max(5000).default(""),
    reminderDays: z.string().max(40).default("3,7"),
    thankYouEmail: z.boolean().default(true),
    // Exports from before auto-approve existed import with it off.
    autoApprove: z.boolean().default(false),
    autoApproveMinRating: z.union([z.literal(4), z.literal(5)]).default(4),
    autoApproveVideo: z.boolean().default(false),
    website: webAddress,
    businessType: z.string().trim().max(40).nullable().catch(null),
    brand: brandSchema.catch({ colors: {}, fonts: {} }),
    logo: mediaRef,
  }),
  consentVersions: z
    .array(z.object({ id: z.string(), version: z.number().int(), text: z.string(), hash: z.string(), createdAt: isoDate }))
    .default([]),
  forms: listOf(formSchema),
  customers: listOf(customerSchema),
  testimonials: z.array(
    z.object({
      id: z.string(),
      // Every status, so an archive holding hidden or trashed rows still imports.
      status: z.enum(TESTIMONIAL_STATUSES),
      /** The real status when `status` had to say rejected for older versions (hidden, trashed). */
      statusV2: z.enum(TESTIMONIAL_STATUSES).optional().catch(undefined),
      rating: z.number().int().min(1).max(5).nullable(),
      text: z.string().max(5000).nullable(),
      transcript: z.string().max(50_000).nullable().default(null),
      captionsVtt: z.string().max(200_000).nullable().default(null),
      author: z.object({
        name: z.string().min(1).max(120),
        email: z.string().max(254).nullable(),
        title: z.string().max(120).nullable(),
        company: z.string().max(120).nullable(),
        website: webAddress,
        phone: textOrNull(40),
        socials: stringRecord,
      }),
      tags: z.array(z.string().max(32)).max(20).default([]),
      source: z.string().max(40).default("form"),
      requestId: z.string().nullable().default(null),
      approvedBy: z.enum(APPROVERS).nullable().default(null),
      approvedAt: nullableIso,
      approvalRule: z.string().max(40).nullable().default(null),
      consent: z.object({
        at: isoDate,
        scopes: z.array(z.string()).default(["website"]),
        editedAfterConsent: z.boolean().default(false),
        withdrawnAt: nullableIso,
        events: z
          .array(
            z.object({
              type: z.enum(["granted", "edited", "withdrawn", "imported"]),
              actor: z.enum(["customer", "owner", "api", "import"]),
              versionId: z.string().nullable(),
              text: z.string().nullable(),
              textHash: z.string().nullable(),
              scopes: z.array(z.string()).nullable(),
              ipHash: z.string().nullable(),
              detail: z.string().nullable(),
              at: isoDate,
            }),
          )
          .default([]),
      }),
      media: z.object({
        video: z.string().nullable(),
        videoMime: z.string().nullable().default(null),
        videoOriginal: z.string().nullable().default(null),
        poster: z.string().nullable().default(null),
        avatar: z.string().nullable().default(null),
        companyLogo: mediaRef,
        durationMs: z.number().int().nullable().default(null),
        width: z.number().int().nullable().default(null),
        height: z.number().int().nullable().default(null),
      }),
      formId: ref,
      customerId: ref,
      headline: textOrNull(200),
      platform: z
        .string()
        .trim()
        .toLowerCase()
        .max(40)
        .regex(/^[a-z0-9][a-z0-9._-]*$/)
        .nullable()
        .catch(null),
      sourceUrl: webAddress,
      sourceReviewId: textOrNull(200),
      sourceDate: when,
      datePrecision: z.enum(DATE_PRECISIONS).catch("day"),
      importedAt: when,
      language: z
        .string()
        .trim()
        .max(35)
        .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/)
        .nullable()
        .catch(null),
      primaryQuestion: textOrNull(300),
      customFields: jsonObject,
      hiddenFields: stringRecord,
      isFeatured: z.boolean().catch(false),
      pinOrder: z.number().int().min(0).max(10_000).nullable().catch(null),
      consentPublic: z.boolean().catch(true),
      trashedAt: when,
      statusBeforeTrash: z.enum(TESTIMONIAL_STATUSES).nullable().catch(null),
      answers: listOf(answerSchema),
      images: listOf(imageSchema),
      highlights: listOf(highlightSchema),
      history: listOf(historySchema),
      translations: listOf(translationSchema),
      mergedIntoId: ref,
      verifiedPurchaseAt: when.optional(),
      createdAt: isoDate,
      updatedAt: isoDate,
    }),
  ),
  requests: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().max(120).nullable(),
        email: z.string().max(254),
        company: z.string().max(120).nullable(),
        // "declined" since M9 (a campaign's "No thanks"); campaigns ride along since M13 (L14).
        status: z.enum(["waiting", "responded", "unsubscribed", "declined"]),
        sentAt: nullableIso,
        remindersSent: z.number().int().default(0),
        respondedAt: nullableIso,
        unsubscribedAt: nullableIso,
        testimonialId: z.string().nullable(),
        formId: ref,
        createdAt: isoDate,
        campaignId: ref,
        title: textOrNull(120),
        custom: stringRecord,
        scheduledFor: when,
        openedAt: when,
        clickedAt: when,
        startedAt: when,
        declinedAt: when,
      }),
    )
    .default([]),
  feedback: listOf(feedbackSchema),
  widgets: listOf(widgetSchema),
  walls: listOf(wallSchema),
  seoSnippets: listOf(seoSnippetSchema),
  redirects: listOf(redirectSchema),
  campaigns: listOf(campaignSchema),
  boosters: listOf(boosterSchema),
  boosterClicks: listOf(boosterClickSchema),
  rewardCodes: listOf(rewardCodeSchema),
  importSources: listOf(importSourceSchema),
  highlightReels: listOf(reelSchema),
  renders: listOf(renderDefSchema),
  formVideos: listOf(formVideoSchema),
  caseStudies: listOf(caseStudySchema),
  insightReports: listOf(insightReportSchema),
  surveyResponses: listOf(surveyResponseSchema),
  socialDrafts: listOf(socialDraftSchema),
  purchaseKeyId: z.string().max(64).nullable().optional().catch(null),
  purchases: listOf(purchaseSchema),
  stripeConnection: stripeConnectionSchema,
});

export type ImportManifest = z.infer<typeof manifestSchema>;

export class ImportError extends Error {}

/** Reads and validates `plaudit.json` from an uploaded archive. */
export async function readManifest(zipPath: string) {
  let zip;
  try {
    zip = await openZip(zipPath);
  } catch (err) {
    throw new ImportError(err instanceof ZipError ? `${err.message}. Upload the .zip from a Plaudit export.` : String(err));
  }
  const entry = zip.entries.get(MANIFEST);
  if (!entry) throw new ImportError("This zip has no plaudit.json. Upload the .zip from a Plaudit export.");
  const text = await readEntryText(zip, entry, 200 * 1024 * 1024, `${zipPath}.manifest`);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ImportError("plaudit.json isn't valid JSON");
  }
  const parsed = manifestSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ImportError(`plaudit.json doesn't match export format ${EXPORT_VERSION}: ${issue.path.join(".")} ${issue.message}`);
  }
  return { zip, manifest: parsed.data };
}

/**
 * A free slug based on `wanted` (acme, acme-2, acme-3…). An old link of
 * another project counts as taken, so an import never takes over links made
 * before a rename (D17).
 */
export function freeSlug(wanted: string) {
  const base = wanted.replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "").slice(0, 40) || "imported";
  if (!findProjectBySlugOrAlias(base)) return base;
  for (let i = 2; ; i++) if (!findProjectBySlugOrAlias(`${base}-${i}`)) return `${base}-${i}`;
}

/** The name, or "Name (imported)", "Name (imported 2)"… if a project here already has it. */
export function freeName(wanted: string) {
  const taken = new Set(listProjects().map((p) => p.name.trim().toLowerCase()));
  if (!taken.has(wanted.trim().toLowerCase())) return wanted;
  const base = wanted.slice(0, 64);
  for (let i = 1; ; i++) {
    const name = `${base} (imported${i > 1 ? ` ${i}` : ""})`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

/** Creates the (empty) target project for an import so the dashboard can link to it right away. */
export function createImportTarget(manifest: ImportManifest, opts: { slug?: string; name?: string }) {
  const p = manifest.project;
  const project = createProject({
    // A copy beside the original shouldn't look identical on the dashboard.
    name: opts.name || freeName(p.name),
    slug: freeSlug(opts.slug || p.slug),
    prompt: p.prompt,
    thankYouMessage: p.thankYouMessage,
    accentColor: p.accentColor,
    allowVideo: p.allowVideo,
    allowText: p.allowText,
    questions: p.questions,
    maxVideoSeconds: p.maxVideoSeconds,
    consentText: p.consentText,
    inviteSubject: p.inviteSubject,
    inviteMessage: p.inviteMessage,
    reminderDays: p.reminderDays,
    thankYouEmail: p.thankYouEmail,
    autoApprove: p.autoApprove,
    autoApproveMinRating: p.autoApproveMinRating,
    autoApproveVideo: p.autoApproveVideo,
  });
  // The logo is a file, so it arrives with the rest of the media in importArchive.
  const branded = Object.keys(p.brand.colors).length || Object.keys(p.brand.fonts).length || p.brand.name || p.brand.description;
  return (
    getDb()
      .update(projects)
      .set({ website: p.website, businessType: p.businessType, brand: branded ? JSON.stringify(p.brand) : "{}" })
      .where(eq(projects.id, project.id))
      .returning()
      .get() ?? project
  );
}

/** `wanted` when it's a valid link no other row here uses, else `<base>-2`, `<base>-3`…; added to `taken`. */
function claimSlug(taken: Set<string>, wanted: string, fallback: string) {
  const parsed = slugSchema.safeParse(wanted);
  const base = parsed.success ? parsed.data : fallback;
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const slug = base.slice(0, 48 - suffix.length).replace(/-+$/, "") + suffix;
    if (!taken.has(slug)) {
      taken.add(slug);
      return slug;
    }
  }
}

/** What an imported multiclip or social clip says until it's made again. */
export const NOT_IN_EXPORT = "Imported without its video file. Make it again to get the file.";
/** What an imported Stripe connection says until its secrets are pasted again. */
export const STRIPE_IMPORTED = "Imported from a Plaudit export. Paste the signing secret and restricted key again, and point Stripe's webhook at the address above.";
/** As src/lib/insights/reports.ts caps them. */
const MAX_REPORTS = 200;
const MAX_REPORT_BYTES = 512 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WIDGET_ID = /^w_[a-z0-9]{12}$/;
const SNIPPET_ID = /^s_[a-z0-9]{12}$/;

/** A public id such as `w_k3j9x0q2m7ab`: the prefix and 12 base36 characters. */
function publicId(prefix: "w" | "s") {
  return `${prefix}_${Array.from(crypto.randomBytes(12), (b) => (b % 36).toString(36)).join("")}`;
}

/**
 * Replaces archive ids with the new ones wherever they appear in a widget,
 * wall or snippet config (manual picks, include and exclude filters, a
 * connected form…), whose shapes later versions define. Only id-shaped
 * strings are mapped, so wording and colours are never touched.
 */
function remapIds(value: unknown, map: Map<string, string>): unknown {
  if (typeof value === "string") return map.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v) => remapIds(v, map));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapIds(v, map)]));
  }
  return value;
}

type FormEntry = ImportManifest["forms"][number];

/**
 * The archive's form config as this version reads it (parseFormRow keeps what
 * parses and fills in the rest). A rule that is on applies from the import
 * on, never to the testimonials that came with it.
 */
function importedFormConfig(f: FormEntry, now: Date): FormConfig {
  const cfg = parseFormRow({
    id: f.id,
    layout: f.layout,
    configVersion: 1,
    pages: JSON.stringify(f.pages ?? null),
    design: JSON.stringify(f.design ?? {}),
    labels: JSON.stringify(f.labels ?? {}),
    settings: JSON.stringify(f.settings ?? {}),
  } as Form);
  const rule = cfg.settings.autoApprove;
  rule.since = rule.mode === "off" ? null : now;
  return cfg;
}

const configColumns = (cfg: FormConfig) => ({
  pages: JSON.stringify(cfg.pages),
  design: JSON.stringify(cfg.design),
  labels: JSON.stringify(cfg.labels),
  settings: JSON.stringify(cfg.settings),
});

/**
 * The archive's forms. Its default form takes the place of the one the
 * target project was made with (and the project's mirrored columns follow
 * it, D2); without one, that form stays as made from the project's settings.
 */
function importForms(tx: Tx, projectId: string, list: FormEntry[], file: (ref: string | null) => string | null, now: Date) {
  const project = tx.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new ImportError("The project to import into no longer exists");
  const current = ensureDefaultForm(project, tx);
  const ids = new Map<string, string>();
  const archiveDefault = list.find((f) => f.isDefault);
  const taken = new Set(
    tx
      .select({ slug: forms.slug })
      .from(forms)
      .where(and(eq(forms.projectId, projectId), ne(forms.id, current.id)))
      .all()
      .map((r) => r.slug),
  );
  if (!archiveDefault) taken.add(current.slug);
  const at = (s: string | null) => (s ? new Date(s) : now);
  for (const f of archiveDefault ? [archiveDefault, ...list.filter((x) => x !== archiveDefault)] : list) {
    if (ids.has(f.id)) continue;
    const isDefault = f === archiveDefault;
    const cfg = importedFormConfig(f, now);
    const values = {
      slug: claimSlug(taken, f.slug, isDefault ? "default" : "form"),
      name: f.name,
      status: f.status,
      layout: f.layout,
      // A survey can't be the default form.
      kind: isDefault ? ("testimonial" as const) : f.kind,
      configVersion: 1,
      ...configColumns(cfg),
      reward: JSON.stringify(f.reward),
      language: f.language,
      logoKey: file(f.logo),
      template: f.template,
      createdAt: at(f.createdAt),
      updatedAt: at(f.updatedAt),
    };
    if (isDefault) {
      tx.update(forms).set(values).where(eq(forms.id, current.id)).run();
      ids.set(f.id, current.id);
      const columns = mirrorColumns(project, cfg);
      if (Object.keys(columns).length) tx.update(projects).set(columns).where(eq(projects.id, projectId)).run();
    } else {
      const id = crypto.randomUUID();
      tx.insert(forms).values({ id, projectId, isDefault: false, ...values }).run();
      ids.set(f.id, id);
    }
  }
  return { ids, defaultId: current.id, slugs: taken };
}

/**
 * Fills `projectId` from the archive. Media is copied first; database rows
 * go in one transaction, so a failed import leaves no half-imported rows.
 * Request reminders are not resumed and no webhooks fire for imported data.
 * Every row gets a new id (references inside the archive follow), except a
 * widget or snippet id that is still free here, so embeds and snippets on
 * other sites keep working after a move.
 */
export async function importArchive(zipPath: string, projectId: string) {
  const { zip, manifest } = await readManifest(zipPath);
  const db = getDb();
  const saved: string[] = [];
  const keyFor = new Map<string, { key: string; mime: string }>();
  await fs.promises.mkdir(env.tmpDir, { recursive: true });

  async function media(ref: string | null, kind: MediaKind) {
    if (!ref) return null;
    if (keyFor.has(ref)) return keyFor.get(ref)!;
    const entry = zip.entries.get(ref);
    if (!entry) return null; // listed but not in the archive: skip it, keep the testimonial
    const tmp = path.join(env.tmpDir, `import-${crypto.randomUUID()}`);
    try {
      await extractEntry(zip, entry, tmp, kind === "video" ? env.maxVideoBytes : env.maxImageBytes);
      const head = Buffer.alloc(16);
      const fd = await fs.promises.open(tmp, "r");
      await fd.read(head, 0, 16, 0);
      await fd.close();
      const stored = await saveFile(tmp, sniffMime(head), kind, { move: true });
      saved.push(stored.key);
      keyFor.set(ref, stored);
      return stored;
    } finally {
      await fs.promises.rm(tmp, { force: true });
    }
  }

  try {
    const refs: [string | null, MediaKind][] = [
      [manifest.project.logo, "image"],
      ...manifest.forms.map((f): [string | null, MediaKind] => [f.logo, "image"]),
      ...manifest.customers.map((c): [string | null, MediaKind] => [c.avatar, "image"]),
      ...manifest.walls.flatMap((w): [string | null, MediaKind][] => [
        [w.logo, "image"],
        [w.cover, "image"],
      ]),
      ...manifest.boosters.map((b): [string | null, MediaKind] => [b.logo, "image"]),
      ...manifest.formVideos.flatMap((v): [string | null, MediaKind][] => [
        [v.media.video, "video"],
        [v.media.videoOriginal, "video"],
        [v.media.poster, "image"],
      ]),
      ...manifest.highlightReels.map((r): [string | null, MediaKind] => [r.render?.video ?? null, "video"]),
      ...manifest.renders.map((r): [string | null, MediaKind] => [r.replaced, "video"]),
    ];
    for (const t of manifest.testimonials) {
      refs.push(
        [t.media.video, "video"],
        [t.media.videoOriginal, "video"],
        [t.media.poster, "image"],
        [t.media.avatar, "image"],
        [t.media.companyLogo, "image"],
      );
      for (const a of t.answers) refs.push([a.media.video, "video"], [a.media.videoOriginal, "video"], [a.media.poster, "image"]);
      for (const i of t.images) refs.push([i.image, "image"]);
    }
    for (const [ref, kind] of refs) await media(ref, kind);
    const stored = (ref: string | null) => (ref ? (keyFor.get(ref) ?? null) : null);
    const file = (ref: string | null) => stored(ref)?.key ?? null;

    const ids = new Map(manifest.testimonials.map((t) => [t.id, crypto.randomUUID()]));
    const versionIds = new Map(manifest.consentVersions.map((v) => [v.id, crypto.randomUUID()]));
    const requestIds = new Map(manifest.requests.map((r) => [r.id, crypto.randomUUID()]));
    const customerIds = new Map<string, string>();
    const answerIds = new Map<string, string>();
    const wallIds = new Map(manifest.walls.map((w) => [w.id, crypto.randomUUID()]));
    const widgetIds = new Map<string, string>();
    const snippetIds = new Map<string, string>();
    const feedbackIds = new Map<string, string>();
    const campaignIds = new Map(manifest.campaigns.map((c) => [c.id, crypto.randomUUID()]));
    const boosterIds = new Map(manifest.boosters.map((b) => [b.id, crypto.randomUUID()]));
    const extra = {
      campaigns: 0,
      boosters: 0,
      rewardCodes: 0,
      importSources: 0,
      translations: 0,
      highlightReels: 0,
      renders: 0,
      formVideos: 0,
      caseStudies: 0,
      insightReports: 0,
      surveyResponses: 0,
      socialDrafts: 0,
      purchases: 0,
      stripeConnection: 0,
    };
    // L25: hashes another server made can't match anything here (its key differs), so they're dropped.
    const sameKey = manifest.purchaseKeyId === purchaseKeyId();
    const convertFormVideos: string[] = [];
    const now = new Date();
    const date = (s: string | null | undefined) => (s ? new Date(s) : null);
    const at = (s: string | null | undefined) => date(s) ?? now;
    const lookup = (map: Map<string, string>, id: string | null | undefined) => (id ? (map.get(id) ?? null) : null);

    db.transaction((tx) => {
      for (const v of manifest.consentVersions) {
        tx.insert(consentVersions)
          .values({ id: versionIds.get(v.id)!, projectId, version: v.version, text: v.text, hash: v.hash, createdAt: new Date(v.createdAt) })
          .run();
      }

      const formsIn = importForms(tx, projectId, manifest.forms, file, now);
      const formIds = formsIn.ids;
      // An archive from before forms existed: what came through the collection page came through the default form, as migration 0009 has it.
      const formFor = (id: string | null | undefined, legacy: string | null) => (id === undefined ? legacy : lookup(formIds, id));

      for (const c of manifest.customers) {
        const email = c.email?.trim().toLowerCase() || null;
        const added = tx
          .insert(customers)
          .values({
            id: crypto.randomUUID(),
            projectId,
            email,
            name: c.name,
            title: c.title,
            company: c.company,
            website: c.website,
            avatarKey: file(c.avatar),
            socials: JSON.stringify(c.socials),
            custom: JSON.stringify(c.custom),
            createdAt: at(c.createdAt),
            updatedAt: at(c.updatedAt),
          })
          .onConflictDoNothing()
          .returning({ id: customers.id })
          .get();
        // Two entries with one email (a hand-edited archive) become one customer.
        const row =
          added ??
          (email
            ? tx.select({ id: customers.id }).from(customers).where(and(eq(customers.projectId, projectId), eq(customers.email, email))).get()
            : undefined);
        if (row) customerIds.set(c.id, row.id);
      }

      for (const t of manifest.testimonials) {
        const [video, original, poster] = [stored(t.media.video), stored(t.media.videoOriginal), stored(t.media.poster)];
        const id = ids.get(t.id)!;
        const playable = video ?? original;
        const wanted = t.statusV2 ?? t.status;
        const withdrawn = Boolean(t.consent.withdrawnAt);
        // A withdrawn testimonial stays unpublished or in the trash; a private one is never public (D11), so it's kept for internal use.
        const status: TestimonialStatus = withdrawn
          ? wanted === "trashed"
            ? "trashed"
            : "rejected"
          : wanted === "approved" && !t.consentPublic
            ? "hidden"
            : wanted;
        const before = t.statusBeforeTrash === "approved" && !t.consentPublic ? "hidden" : t.statusBeforeTrash;
        const statusBeforeTrash = status === "trashed" && before !== "trashed" ? before : null;
        // The trash keeps an approval, so restoring puts it back as it was.
        const approved = !withdrawn && (status === "approved" || (status === "trashed" && statusBeforeTrash === "approved"));
        tx.insert(testimonials)
          .values({
            id,
            projectId,
            status,
            rating: t.rating,
            text: t.text,
            authorName: t.author.name,
            authorEmail: t.author.email,
            authorTitle: t.author.title,
            authorCompany: t.author.company,
            avatarKey: file(t.media.avatar),
            videoKey: playable?.key ?? null,
            videoMime: playable?.mime ?? null,
            videoOriginalKey: (original ?? video)?.key ?? null,
            posterKey: poster?.key ?? null,
            videoDurationMs: t.media.durationMs,
            videoWidth: t.media.width,
            videoHeight: t.media.height,
            mediaStatus: !playable ? "none" : video && poster && video.mime === "video/mp4" && original ? "ready" : "none",
            transcript: t.transcript,
            captionsVtt: t.captionsVtt,
            transcriptStatus: t.transcript || t.captionsVtt ? "ready" : "none",
            consentAt: new Date(t.consent.at),
            consentScopes: JSON.stringify(t.consent.scopes),
            editedAfterConsent: t.consent.editedAfterConsent,
            withdrawnAt: date(t.consent.withdrawnAt),
            source: t.source,
            requestId: t.requestId ? (requestIds.get(t.requestId) ?? null) : null,
            ...(approved ? { approvedBy: t.approvedBy, approvedAt: date(t.approvedAt), approvalRule: t.approvalRule } : {}),
            createdAt: new Date(t.createdAt),
            updatedAt: new Date(t.updatedAt),
            formId: formFor(t.formId, t.source === "form" ? formsIn.defaultId : null),
            customerId: lookup(customerIds, t.customerId),
            headline: t.headline,
            platform: t.platform,
            sourceUrl: t.sourceUrl,
            sourceReviewId: t.sourceReviewId,
            sourceDate: date(t.sourceDate),
            datePrecision: t.datePrecision,
            importedAt: date(t.importedAt),
            language: t.language,
            authorWebsite: t.author.website,
            authorPhone: t.author.phone,
            authorSocials: JSON.stringify(t.author.socials),
            companyLogoKey: file(t.media.companyLogo),
            primaryQuestion: t.primaryQuestion,
            customFields: JSON.stringify(t.customFields),
            hiddenFields: JSON.stringify(t.hiddenFields),
            isFeatured: t.isFeatured,
            pinOrder: t.pinOrder,
            wordCount: t.answers.reduce((n, a) => n + countWords(a.text), countWords(t.text)),
            trashedAt: status === "trashed" ? at(t.trashedAt) : null,
            statusBeforeTrash,
            consentPublic: t.consentPublic,
            verifiedPurchaseAt: date(t.verifiedPurchaseAt),
          })
          .run();
        for (const name of new Set(t.tags.map((x) => x.trim().toLowerCase()).filter(Boolean))) {
          tx.insert(tags).values({ id: crypto.randomUUID(), projectId, name }).onConflictDoNothing().run();
          const tag = tx
            .select()
            .from(tags)
            .where(and(eq(tags.projectId, projectId), eq(tags.name, name)))
            .get()!;
          tx.insert(testimonialTags).values({ testimonialId: id, tagId: tag.id }).onConflictDoNothing().run();
        }
        for (const e of t.consent.events) {
          tx.insert(consentEvents)
            .values({
              id: crypto.randomUUID(),
              testimonialId: id,
              type: e.type,
              actor: e.actor,
              versionId: e.versionId ? (versionIds.get(e.versionId) ?? null) : null,
              text: e.text,
              textHash: e.textHash,
              scopes: e.scopes ? JSON.stringify(e.scopes) : null,
              ipHash: e.ipHash,
              detail: e.detail,
              createdAt: new Date(e.at),
            })
            .run();
        }

        const texts = new Map<string | null, string | null>([[null, t.text]]);
        for (const a of t.answers) {
          const [aVideo, aOriginal, aPoster] = [stored(a.media.video), stored(a.media.videoOriginal), stored(a.media.poster)];
          const aPlayable = aVideo ?? aOriginal;
          const row = tx
            .insert(answers)
            .values({
              id: crypto.randomUUID(),
              testimonialId: id,
              questionKey: a.questionKey,
              questionTitle: a.questionTitle,
              position: a.position,
              text: a.text,
              videoKey: aPlayable?.key ?? null,
              videoMime: aPlayable?.mime ?? null,
              videoOriginalKey: (aOriginal ?? aVideo)?.key ?? null,
              posterKey: aPoster?.key ?? null,
              videoDurationMs: a.media.durationMs,
              videoWidth: a.media.width,
              videoHeight: a.media.height,
              mediaStatus: !aPlayable ? "none" : aVideo && aPoster && aVideo.mime === "video/mp4" && aOriginal ? "ready" : "none",
              transcript: a.transcript,
              captionsVtt: a.captionsVtt,
              transcriptStatus: a.transcript || a.captionsVtt ? "ready" : "none",
              createdAt: at(a.createdAt),
              updatedAt: at(a.updatedAt),
            })
            .onConflictDoNothing()
            .returning({ id: answers.id })
            .get();
          if (!row) continue; // a second answer to the same question
          answerIds.set(a.id, row.id);
          texts.set(row.id, a.text);
        }
        for (const i of t.images) {
          const key = file(i.image);
          if (!key) continue;
          tx.insert(testimonialImages)
            .values({
              id: crypto.randomUUID(),
              testimonialId: id,
              questionKey: i.questionKey,
              key,
              alt: i.alt,
              position: i.position,
              ownerOnly: i.ownerOnly,
              createdAt: at(i.createdAt),
            })
            .run();
        }
        for (const x of t.translations) {
          const added = tx
            .insert(translations)
            .values({ id: crypto.randomUUID(), testimonialId: id, lang: x.lang, headline: x.headline, text: x.text, machine: x.machine, createdAt: at(x.createdAt), updatedAt: at(x.updatedAt) })
            .onConflictDoNothing()
            .run();
          extra.translations += added.changes;
        }
        const anchored = new Set<string | null>();
        for (const h of t.highlights) {
          const answerId = h.answerId === null ? null : answerIds.get(h.answerId);
          if (answerId === undefined) continue;
          tx.insert(highlights)
            .values({ id: crypto.randomUUID(), testimonialId: id, answerId, start: h.start, end: h.end, phrase: h.phrase, createdAt: at(h.createdAt) })
            .run();
          anchored.add(answerId);
        }
        // Each highlight must sit on its phrase: moved to where it is, or dropped when the text no longer has it.
        for (const answerId of anchored) reanchorHighlights(tx, id, answerId, texts.get(answerId) ?? null);
        if (t.history.length) {
          for (const h of t.history) {
            tx.insert(testimonialHistory)
              .values({
                id: crypto.randomUUID(),
                testimonialId: id,
                actor: h.actor,
                actorEmail: h.actorEmail,
                action: h.action,
                diff: JSON.stringify(h.diff),
                createdAt: new Date(h.at),
              })
              .run();
          }
        } else {
          // An archive without history (made before it was kept): its history starts here.
          recordHistory(tx, { testimonialId: id, actor: "import", action: "created", diff: { source: [null, t.source] }, at: now });
        }
      }

      // L14: campaigns, before their recipients. An active one comes in paused, so nothing is sent until the owner says so.
      for (const c of manifest.campaigns) {
        tx.insert(campaigns)
          .values({
            id: campaignIds.get(c.id)!,
            projectId,
            formId: lookup(formIds, c.formId),
            name: c.name,
            status: c.status === "active" ? "paused" : c.status,
            senderName: c.senderName,
            replyTo: c.replyTo,
            subject: c.subject,
            body: c.body,
            buttonText: c.buttonText,
            rtl: c.rtl,
            reminders: JSON.stringify(c.reminders),
            trackOpens: c.trackOpens,
            rewardCodes: c.rewardCodes,
            createdAt: at(c.createdAt),
            updatedAt: at(c.updatedAt),
          })
          .run();
        extra.campaigns++;
      }

      for (const r of manifest.requests) {
        tx.insert(requests)
          .values({
            id: requestIds.get(r.id)!,
            projectId,
            name: r.name,
            email: r.email,
            company: r.company,
            status: r.status,
            // Imported requests never send email by themselves.
            emailStatus: r.sentAt ? "sent" : "not_sent",
            sentAt: date(r.sentAt),
            remindersSent: r.remindersSent,
            nextReminderAt: null,
            respondedAt: date(r.respondedAt),
            unsubscribedAt: date(r.unsubscribedAt),
            testimonialId: r.testimonialId ? (ids.get(r.testimonialId) ?? null) : null,
            formId: formFor(r.formId, formsIn.defaultId),
            createdAt: new Date(r.createdAt),
            campaignId: lookup(campaignIds, r.campaignId),
            title: r.title,
            custom: JSON.stringify(r.custom),
            // A delayed invitation isn't sent from an import either.
            scheduledFor: null,
            openedAt: date(r.openedAt),
            clickedAt: date(r.clickedAt),
            startedAt: date(r.startedAt),
            declinedAt: date(r.declinedAt),
          })
          .run();
        // Unsubscribing is project-wide (M9): the imported project remembers the address too.
        if (r.unsubscribedAt) {
          tx.insert(schema.unsubscribes)
            .values({ projectId, email: r.email.toLowerCase(), createdAt: new Date(r.unsubscribedAt) })
            .onConflictDoNothing()
            .run();
        }
      }

      for (const f of manifest.feedback) {
        const feedbackId = crypto.randomUUID();
        feedbackIds.set(f.id, feedbackId);
        tx.insert(feedback)
          .values({
            id: feedbackId,
            projectId,
            formId: lookup(formIds, f.formId),
            customerId: lookup(customerIds, f.customerId),
            testimonialId: lookup(ids, f.testimonialId),
            source: f.source,
            rating: f.rating,
            text: f.text,
            authorName: f.authorName,
            authorEmail: f.authorEmail,
            trashedAt: date(f.trashedAt),
            createdAt: at(f.createdAt),
          })
          .run();
      }

      // L14: reward code pools, with who claimed what (each code once per form, one per submission and recipient).
      for (const r of manifest.rewardCodes) {
        const formId = lookup(formIds, r.formId);
        if (!formId) continue;
        const added = tx
          .insert(rewardCodes)
          .values({
            id: crypto.randomUUID(),
            projectId,
            formId,
            code: r.code,
            claimedAt: date(r.claimedAt),
            testimonialId: lookup(ids, r.testimonialId),
            feedbackId: lookup(feedbackIds, r.feedbackId),
            requestId: lookup(requestIds, r.requestId),
            createdAt: at(r.createdAt),
          })
          .onConflictDoNothing()
          .run();
        extra.rewardCodes += added.changes;
      }

      // INBOX-11: where merged testimonials went, once every row is in.
      for (const t of manifest.testimonials) {
        const into = lookup(ids, t.mergedIntoId);
        if (into) tx.update(testimonials).set({ mergedIntoId: into }).where(eq(testimonials.id, ids.get(t.id)!)).run();
      }

      // IMP-02: synced sources come in paused, so a moved project doesn't start fetching on its own.
      for (const x of manifest.importSources) {
        const adapter = getAdapter(x.adapter);
        if (!adapter || !canSync(adapter)) continue;
        tx.insert(importSources)
          .values({
            id: crypto.randomUUID(),
            projectId,
            adapter: adapter.id,
            input: JSON.stringify(Object.fromEntries(Object.entries(x.input).filter(([k]) => !SECRET_KEYS.test(k)))),
            options: JSON.stringify(x.options),
            label: x.label.slice(0, 120),
            intervalHours: x.intervalHours,
            paused: true,
            nextRunAt: new Date(now.getTime() + x.intervalHours * 60 * 60 * 1000),
            itemsAdded: x.itemsAdded,
            createdAt: at(x.createdAt),
            updatedAt: now,
          })
          .run();
        extra.importSources++;
      }

      // Public ids are kept when no row here has them yet, so embeds on other sites still find their widget.
      const keep = (id: string, pattern: RegExp, taken: (id: string) => boolean) => pattern.test(id) && !taken(id);
      const widgetTaken = (id: string) =>
        [...widgetIds.values()].includes(id) || Boolean(tx.select({ id: widgets.id }).from(widgets).where(eq(widgets.id, id)).get());
      for (const w of manifest.widgets) {
        if (!widgetIds.has(w.id)) widgetIds.set(w.id, keep(w.id, WIDGET_ID, widgetTaken) ? w.id : publicId("w"));
      }
      const snippetTaken = (id: string) =>
        [...snippetIds.values()].includes(id) || Boolean(tx.select({ id: seoSnippets.id }).from(seoSnippets).where(eq(seoSnippets.id, id)).get());
      for (const s of manifest.seoSnippets) {
        if (!snippetIds.has(s.id)) snippetIds.set(s.id, keep(s.id, SNIPPET_ID, snippetTaken) ? s.id : publicId("s"));
      }
      const idMap = new Map(
        [ids, formIds, customerIds, answerIds, wallIds, widgetIds, snippetIds]
          .flatMap((m) => [...m])
          .filter(([old]) => UUID.test(old) || WIDGET_ID.test(old) || SNIPPET_ID.test(old)),
      );
      const remapObject = (v: Record<string, unknown>) => JSON.stringify(remapIds(v, idMap));
      const testimonialIds = (list: string[]) => JSON.stringify(list.flatMap((x) => (ids.has(x) ? [ids.get(x)!] : [])));

      const wallSlugs = new Set(tx.select({ slug: walls.slug }).from(walls).where(eq(walls.projectId, projectId)).all().map((r) => r.slug));
      let hasMain = Boolean(tx.select({ id: walls.id }).from(walls).where(and(eq(walls.projectId, projectId), eq(walls.isMain, true))).get());
      const inserted = new Set<string>();
      for (const w of manifest.walls) {
        if (inserted.has(w.id)) continue;
        inserted.add(w.id);
        const isMain = w.isMain && !hasMain;
        if (isMain) hasMain = true;
        tx.insert(walls)
          .values({
            id: wallIds.get(w.id)!,
            projectId,
            slug: claimSlug(wallSlugs, w.slug, "wall"),
            name: w.name,
            published: w.published,
            isMain,
            theme: w.theme,
            config: remapObject(w.config),
            logoKey: file(w.logo),
            coverKey: file(w.cover),
            featuredTestimonialId: lookup(ids, w.featuredTestimonialId),
            connectedFormId: lookup(formIds, w.connectedFormId),
            configVersion: w.configVersion,
            createdAt: at(w.createdAt),
            updatedAt: at(w.updatedAt),
          })
          .run();
      }

      inserted.clear();
      for (const w of manifest.widgets) {
        if (inserted.has(w.id)) continue;
        inserted.add(w.id);
        tx.insert(widgets)
          .values({
            id: widgetIds.get(w.id)!,
            projectId,
            name: w.name,
            layout: w.layout,
            selectionMode: w.selectionMode,
            manualIds: testimonialIds(w.manualIds),
            pinnedIds: testimonialIds(w.pinnedIds),
            filters: remapObject(w.filters),
            design: remapObject(w.design),
            labels: remapObject(w.labels),
            options: remapObject(w.options),
            configVersion: w.configVersion,
            connectedFormId: lookup(formIds, w.connectedFormId),
            placement: w.placement,
            deletedAt: date(w.deletedAt),
            createdAt: at(w.createdAt),
            updatedAt: at(w.updatedAt),
          })
          .run();
      }

      inserted.clear();
      for (const s of manifest.seoSnippets) {
        if (inserted.has(s.id)) continue;
        inserted.add(s.id);
        tx.insert(seoSnippets)
          .values({
            id: snippetIds.get(s.id)!,
            projectId,
            name: s.name,
            schemaType: s.schemaType,
            scope: remapObject(s.scope),
            item: remapObject(s.item),
            createdAt: at(s.createdAt),
            updatedAt: at(s.updatedAt),
          })
          .run();
      }

      // L14: review booster pages (links to forms remapped), and their daily clicks.
      const boosterSlugs = new Set(tx.select({ slug: boosters.slug }).from(boosters).where(eq(boosters.projectId, projectId)).all().map((r) => r.slug));
      inserted.clear();
      for (const b of manifest.boosters) {
        if (inserted.has(b.id)) continue;
        inserted.add(b.id);
        const links = boosterLinksSchema.safeParse(remapIds(b.links, idMap));
        const design = boosterDesignSchema.safeParse(b.design);
        tx.insert(boosters)
          .values({
            id: boosterIds.get(b.id)!,
            projectId,
            slug: claimSlug(boosterSlugs, b.slug, "reviews"),
            name: b.name,
            published: b.published,
            title: b.title,
            message: b.message,
            links: JSON.stringify(links.success ? links.data : []),
            design: JSON.stringify(design.success ? design.data : {}),
            logoKey: file(b.logo),
            createdAt: at(b.createdAt),
            updatedAt: at(b.updatedAt),
          })
          .run();
        extra.boosters++;
      }
      for (const c of manifest.boosterClicks) {
        const boosterId = lookup(boosterIds, c.boosterId);
        if (!boosterId) continue;
        tx.insert(boosterClicks).values({ boosterId, linkId: c.linkId, day: c.day, count: c.count }).onConflictDoNothing().run();
      }

      // Old links: a live slug always wins over an old one (D17), and one another project here already answers to stays theirs.
      const project = tx.select().from(projects).where(eq(projects.id, projectId)).get()!;
      for (const r of manifest.redirects) {
        const old = slugSchema.safeParse(r.oldSlug);
        if (!old.success) continue;
        const slug = old.data;
        let target: { scope: string; formId: string | null; wallId: string | null; boosterId?: string } | null = null;
        if (r.kind === "project") {
          if (slug !== project.slug && !tx.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug)).get()) {
            target = { scope: "", formId: null, wallId: null };
          }
        } else if (r.kind === "form") {
          const formId = lookup(formIds, r.formId);
          if (formId && !formsIn.slugs.has(slug)) target = { scope: projectId, formId, wallId: null };
        } else if (r.kind === "booster") {
          const boosterId = lookup(boosterIds, r.boosterId);
          if (boosterId && !boosterSlugs.has(slug)) target = { scope: projectId, formId: null, wallId: null, boosterId };
        } else {
          const wallId = lookup(wallIds, r.wallId);
          if (wallId && !wallSlugs.has(slug)) target = { scope: projectId, formId: null, wallId };
        }
        if (!target) continue;
        tx.insert(slugRedirects)
          .values({ id: crypto.randomUUID(), kind: r.kind, projectId, oldSlug: slug, createdAt: at(r.createdAt), ...target })
          .onConflictDoNothing()
          .run();
      }

      // ---- M16–M18 (L21, L23, L25)

      // FORM-17: owner videos on forms' welcome and thank-you pages; converted again unless the archive has the converted copy.
      for (const v of manifest.formVideos) {
        const formId = lookup(formIds, v.formId);
        const [vVideo, vOriginal, vPoster] = [stored(v.media.video), stored(v.media.videoOriginal), stored(v.media.poster)];
        const vPlayable = vVideo ?? vOriginal;
        if (!formId || !vPlayable) continue;
        const ready = Boolean(vVideo && vPoster && vVideo.mime === "video/mp4" && vOriginal);
        const row = tx
          .insert(formVideos)
          .values({
            id: crypto.randomUUID(),
            formId,
            slot: v.slot,
            videoKey: vPlayable.key,
            videoMime: vPlayable.mime,
            videoOriginalKey: (vOriginal ?? vVideo)!.key,
            posterKey: vPoster?.key ?? null,
            videoDurationMs: v.media.durationMs,
            videoWidth: v.media.width,
            videoHeight: v.media.height,
            mediaStatus: ready ? "ready" : "none",
            transcript: v.transcript,
            captionsVtt: v.captionsVtt,
            transcriptStatus: v.transcript || v.captionsVtt ? "ready" : "none",
            createdAt: at(v.createdAt),
            updatedAt: at(v.updatedAt),
          })
          .onConflictDoNothing()
          .returning({ id: formVideos.id })
          .get();
        if (!row) continue; // a second video for the same page
        extra.formVideos++;
        if (!ready) convertFormVideos.push(row.id);
      }

      // VID-08: highlight reels, their clips pointing at the new testimonials (a clip whose testimonial didn't come is left out), and the newest rendered file.
      const reelIds = new Map<string, string>();
      for (const r of manifest.highlightReels) {
        if (reelIds.has(r.id)) continue;
        const id = crypto.randomUUID();
        reelIds.set(r.id, id);
        const clips = (Array.isArray(r.config.clips) ? r.config.clips : []).flatMap((c: unknown) => {
          const clip = reelClipSchema.safeParse(c);
          const testimonialId = clip.success ? lookup(ids, clip.data.testimonialId) : null;
          return clip.success && testimonialId ? [{ ...clip.data, testimonialId }] : [];
        });
        const config = reelConfigSchema.safeParse({ ...r.config, clips });
        tx.insert(highlightReels)
          .values({ id, projectId, name: r.name, config: JSON.stringify(config.success ? config.data : reelConfigSchema.parse({ clips: clips.slice(0, 20) })), createdAt: at(r.createdAt), updatedAt: at(r.updatedAt) })
          .run();
        extra.highlightReels++;
        const video = r.render ? stored(r.render.video) : null;
        if (r.render && video) {
          tx.insert(videoRenders)
            .values({
              id: crypto.randomUUID(),
              projectId,
              reelId: id,
              kind: "reel",
              status: "ready",
              options: JSON.stringify(r.render.options),
              key: video.key,
              files: JSON.stringify([video.key]),
              durationMs: r.render.durationMs,
              width: r.render.width,
              height: r.render.height,
              sizeBytes: r.render.sizeBytes,
              createdAt: at(r.render.createdAt),
              updatedAt: now,
            })
            .run();
          extra.renders++;
        }
      }

      // VID-05, VID-07: multiclips and social clips come as what was asked for, to be made again. The multiclip a
      // testimonial shows as its video is that video's file, so it stays in use, with the first answer's own file to switch back to.
      const inUse = new Set<string>();
      for (const r of manifest.renders) {
        const testimonialId = lookup(ids, r.testimonialId);
        if (!testimonialId) continue;
        const row = tx.select({ videoKey: testimonials.videoKey, videoOriginalKey: testimonials.videoOriginalKey }).from(testimonials).where(eq(testimonials.id, testimonialId)).get();
        const current = row?.videoOriginalKey ?? row?.videoKey ?? null;
        const replaced = file(r.replaced);
        const used = r.kind === "multiclip" && r.usedAsVideo && Boolean(current && replaced) && !inUse.has(testimonialId);
        if (used) inUse.add(testimonialId);
        tx.insert(videoRenders)
          .values({
            id: crypto.randomUUID(),
            projectId,
            testimonialId,
            kind: r.kind,
            status: used ? "ready" : "failed",
            error: used ? null : NOT_IN_EXPORT,
            options: JSON.stringify(r.options),
            key: used ? current : null,
            files: JSON.stringify(used ? [current] : []),
            usedAsVideo: used,
            replacedKey: used ? replaced : null,
            createdAt: at(r.createdAt),
            updatedAt: now,
          })
          .run();
        extra.renders++;
      }

      // SHARE-04: case studies keep their id (so /cs/ links still work after a move) when it's free here.
      for (const c of manifest.caseStudies) {
        const testimonialId = lookup(ids, c.testimonialId);
        if (!testimonialId) continue;
        const free = UUID.test(c.id) && !tx.select({ id: caseStudies.id }).from(caseStudies).where(eq(caseStudies.id, c.id)).get();
        const content = caseStudyContentSchema.safeParse(c.content ?? {});
        tx.insert(caseStudies)
          .values({
            id: free ? c.id : crypto.randomUUID(),
            projectId,
            testimonialId,
            status: c.status,
            title: c.title,
            content: JSON.stringify(content.success ? content.data : caseStudyContentSchema.parse({})),
            aiDraftedAt: date(c.aiDraftedAt),
            createdAt: at(c.createdAt),
            updatedAt: at(c.updatedAt),
          })
          .run();
        extra.caseStudies++;
      }

      // VOC-01: saved reports as they were shown, the ids they cite pointing at the new rows.
      for (const r of manifest.insightReports.slice(-MAX_REPORTS)) {
        const result = remapObject(r.result);
        if (Buffer.byteLength(result) > MAX_REPORT_BYTES) continue;
        tx.insert(insightReports)
          .values({ id: crypto.randomUUID(), projectId, kind: r.kind, name: r.name, params: remapObject(r.params), result, createdBy: r.createdBy, createdAt: at(r.createdAt) })
          .run();
        extra.insightReports++;
      }

      // NPS-01: every answer, private as before.
      for (const r of manifest.surveyResponses) {
        tx.insert(surveyResponses)
          .values({
            id: crypto.randomUUID(),
            projectId,
            formId: lookup(formIds, r.formId),
            testimonialId: lookup(ids, r.testimonialId),
            questionKey: r.questionKey,
            score: r.score,
            comment: r.comment,
            authorName: r.authorName,
            authorEmail: r.authorEmail,
            createdAt: at(r.createdAt),
          })
          .run();
        extra.surveyResponses++;
      }

      // INT-08: social post drafts as they were last saved.
      for (const d of manifest.socialDrafts) {
        const testimonialId = lookup(ids, d.testimonialId);
        if (!testimonialId) continue;
        extra.socialDrafts += tx
          .insert(socialDrafts)
          .values({ testimonialId, projectId, text: d.text, editedBy: d.editedBy, aiRewrittenAt: date(d.aiRewrittenAt), createdAt: at(d.createdAt), updatedAt: at(d.updatedAt) })
          .onConflictDoNothing()
          .run().changes;
      }

      // INT-07: purchases (never an email) and the connection without its secrets, which the owner pastes again.
      for (const x of manifest.purchases) {
        extra.purchases += tx
          .insert(purchases)
          .values({
            id: crypto.randomUUID(),
            projectId,
            externalId: x.externalId,
            eventType: x.eventType,
            firstName: x.firstName,
            place: x.place,
            product: x.product,
            amount: x.amount,
            currency: x.currency,
            emailHash: sameKey ? x.emailHash : null,
            purchasedAt: new Date(x.purchasedAt),
            createdAt: at(x.createdAt),
          })
          .onConflictDoNothing()
          .run().changes;
      }
      const c = manifest.stripeConnection;
      if (c) {
        extra.stripeConnection += tx
          .insert(stripeConnections)
          .values({
            id: crypto.randomUUID(),
            projectId,
            signingSecret: "",
            restrictedKey: "",
            enabled: c.enabled,
            retentionDays: c.retentionDays,
            verifyPurchases: c.verifyPurchases,
            defaultProduct: c.defaultProduct,
            lastResult: STRIPE_IMPORTED,
            createdAt: at(c.createdAt),
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run().changes;
      }

      const logoKey = file(manifest.project.logo);
      if (logoKey) tx.update(projects).set({ logoKey }).where(eq(projects.id, projectId)).run();
    });
    for (const id of convertFormVideos) await queueFormVideo(id);

    for (const t of manifest.testimonials) {
      logConsentEvent({
        testimonialId: ids.get(t.id)!,
        type: "imported",
        actor: "import",
        detail: `Imported from a Plaudit export made ${manifest.project.name ? `of "${manifest.project.name}" ` : ""}on ${now.toISOString().slice(0, 10)}`,
      });
    }
    // Convert anything that arrived without a processed MP4 and poster.
    for (const row of db.select().from(testimonials).where(eq(testimonials.projectId, projectId)).orderBy(asc(testimonials.createdAt)).all()) {
      if (row.videoKey && row.mediaStatus === "none") await queueVideoProcessing(row.id);
    }
    return {
      testimonials: manifest.testimonials.length,
      requests: manifest.requests.length,
      forms: manifest.forms.length,
      customers: customerIds.size,
      feedback: manifest.feedback.length,
      widgets: widgetIds.size,
      walls: wallIds.size,
      seoSnippets: snippetIds.size,
      ...extra,
      media: saved.length,
    };
  } catch (err) {
    await Promise.all(saved.map((k) => deleteObject(k)));
    if (err instanceof ZipError || err instanceof ImportError) throw new PermanentJobError(err.message);
    throw err;
  }
}
