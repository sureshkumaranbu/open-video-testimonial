import { ANALYTICS_OBJECTS, CASE_STUDY_STATUSES, DATE_PRECISIONS, FORM_STATUSES, INSIGHT_REPORT_KINDS, WEBHOOK_EVENTS } from "@/db/schema";
import { CONSENT_SCOPES } from "./consent";
import { featureOn } from "./features";
import { TEMPLATE_IDS } from "./forms/templates";
import { DEFAULT_EVENTS } from "./webhooks";
import { WALL_THEMES } from "./wall-config";
import { LAYOUTS, PLACEMENTS } from "./widget-config";

/**
 * OpenAPI 3.1 description of the REST API, served at /api/v1/openapi.json.
 * The M14 paths (forms, widgets, walls, campaigns, tags, customers, feedback,
 * analytics) are listed only while the `api2` flag is on, as they answer;
 * M17's case studies, NPS and saved reports also need `insights`, and M18's
 * social drafts `commerce` (L23, L25).
 */
export function openApiSpec(serverUrl: string) {
  const api2 = featureOn("api2");
  const insights = api2 && featureOn("insights");
  const commerce = api2 && featureOn("commerce");
  const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
  const error = { description: "Error", content: { "application/json": { schema: ref("Error") } } };
  const idParam = { name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } };
  const slugParam = { name: "slug", in: "path", required: true, schema: { type: "string" } };
  const one = (schema: string) => ({
    description: "OK",
    content: { "application/json": { schema: { type: "object", properties: { data: ref(schema) } } } },
  });
  const nullable = (type: string, extra: object = {}) => ({ type: [type, "null"], ...extra });

  return {
    openapi: "3.1.0",
    info: {
      title: "Plaudit API",
      version: "1.0.0",
      description:
        "Read and manage testimonials. Authenticate with `Authorization: Bearer plk_…` (create keys under Settings). " +
        "Keys are read-only or read-write. Limit: 600 requests per minute per key. " +
        "Campaign invites: POST /invites. A campaign's incoming webhook URL is separate and needs no key." +
        (api2
          ? " Forms, widgets, walls, campaigns, tags, customers, feedback and analytics use the dashboard's own checks: a key can't do anything the dashboard can't."
          : ""),
      license: { name: "MIT" },
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    security: [{ bearer: [] }],
    paths: {
      "/projects": {
        get: {
          summary: "List projects",
          operationId: "listProjects",
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: { type: "object", properties: { data: { type: "array", items: ref("Project") } } } } },
            },
            "401": error,
          },
        },
      },
      "/projects/{slug}/testimonials": {
        parameters: [slugParam],
        get: {
          summary: "List a project's testimonials, newest first",
          operationId: "listTestimonials",
          parameters: [
            {
              name: "status",
              in: "query",
              description:
                "rejected excludes withdrawn testimonials; ask for withdrawn to get those. Testimonials in the trash are left out unless you ask for trashed",
              schema: { type: "string", enum: ["pending", "approved", "rejected", "withdrawn", "hidden", "trashed"] },
            },
            { name: "tag", in: "query", schema: { type: "string" } },
            {
              name: "limit",
              in: "query",
              description: "Outside 1–100 is a 400 error",
              schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            },
            { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
          ],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { type: "array", items: ref("Testimonial") },
                      pagination: {
                        type: "object",
                        properties: {
                          total: { type: "integer" },
                          limit: { type: "integer" },
                          offset: { type: "integer" },
                          nextOffset: nullable("integer"),
                        },
                      },
                    },
                  },
                },
              },
            },
            "401": error,
            "404": error,
          },
        },
        post: {
          summary: "Add a text testimonial (write scope)",
          operationId: "createTestimonial",
          requestBody: { required: true, content: { "application/json": { schema: ref("NewTestimonial") } } },
          responses: { "201": one("Testimonial"), "400": error, "401": error, "403": error, "404": error },
        },
      },
      "/testimonials/{id}": {
        parameters: [idParam],
        get: { summary: "Get a testimonial", operationId: "getTestimonial", responses: { "200": one("Testimonial"), "401": error, "404": error } },
        patch: {
          summary: "Moderate, retag or edit (write scope)",
          operationId: "updateTestimonial",
          requestBody: { required: true, content: { "application/json": { schema: ref("TestimonialPatch") } } },
          responses: { "200": one("Testimonial"), "400": error, "401": error, "403": error, "404": error, "409": error },
        },
        delete: {
          summary: "Delete a testimonial and its media (write scope)",
          operationId: "deleteTestimonial",
          responses: { "200": { description: "Deleted" }, "401": error, "403": error, "404": error },
        },
      },
      "/invites": {
        post: {
          summary: "Invite someone through a campaign (write scope)",
          description:
            "Adds one person to an active campaign and queues its invitation, optionally delayDays later. " +
            "Someone already in the campaign, unsubscribed from the project, or who already responded gets no second email: " +
            "the answer is 200 with skipped saying why (data is the existing invite, or null). A draft or paused campaign answers 409.",
          operationId: "createInvite",
          requestBody: { required: true, content: { "application/json": { schema: ref("NewInvite") } } },
          responses: {
            "201": one("Invite"),
            "200": {
              description: "Skipped: no new email was sent",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      data: { oneOf: [ref("Invite"), { type: "null" }] },
                      skipped: { type: "string", enum: ["duplicate", "unsubscribed", "responded"] },
                    },
                  },
                },
              },
            },
            "400": error,
            "401": error,
            "403": error,
            "404": error,
            "409": error,
          },
        },
      },
      ...(api2 ? api2Paths() : {}),
      ...(insights ? insightsPaths() : {}),
      ...(commerce ? commercePaths() : {}),
    },
    webhooks: Object.fromEntries(
      [...WEBHOOK_EVENTS, "ping"].map((event) => [
        event,
        {
          post: {
            summary: `${event} (signed with Plaudit-Signature)`,
            description:
              event === "ping"
                ? "Sent when you test the webhook from Settings"
                : (DEFAULT_EVENTS as readonly string[]).includes(event)
                  ? "Sent to webhooks that select it, and to webhooks with no events selected"
                  : "Sent only to webhooks that select it",
            requestBody: { content: { "application/json": { schema: ref("WebhookPayload") } } },
            responses: { "2XX": { description: "Received" } },
          },
        },
      ]),
    ),
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "An API key: plk_…" } },
      schemas: {
        Error: { type: "object", properties: { error: { type: "string" } }, required: ["error"] },
        Project: {
          type: "object",
          properties: {
            id: { type: "string" },
            slug: { type: "string" },
            name: { type: "string" },
            collectUrl: { type: "string", format: "uri" },
            wallUrl: { type: "string", format: "uri" },
            autoApprove: {
              type: "object",
              description: "The project's auto-approve rule, set in the dashboard. Off unless the owner turned it on.",
              properties: {
                enabled: { type: "boolean" },
                minRating: { type: "integer", enum: [4, 5] },
                includeVideo: { type: "boolean" },
              },
            },
            createdAt: { type: "string", format: "date-time" },
            counts: {
              type: "object",
              properties: {
                pending: { type: "integer" },
                approved: { type: "integer" },
                rejected: { type: "integer" },
                hidden: { type: "integer" },
                trashed: { type: "integer" },
              },
            },
          },
        },
        Testimonial: {
          type: "object",
          properties: {
            id: { type: "string" },
            projectId: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "approved", "rejected", "withdrawn", "hidden", "trashed"],
              description:
                "withdrawn: the author withdrew consent; it can't be published again. hidden: kept for internal use, never public. trashed: in the trash, restorable until it's purged",
            },
            formId: nullable("string", { description: "The form it was sent through; null for API, manual and imported testimonials" }),
            rating: nullable("integer", { minimum: 1, maximum: 5 }),
            headline: nullable("string", { description: "A short title for the testimonial" }),
            text: nullable("string"),
            transcript: nullable("string", { description: "Transcript of the video, if any" }),
            primaryQuestion: nullable("string", { description: "The question the text or video answers, as it was asked" }),
            answers: {
              type: "array",
              description: "Answers to the form's further questions, in order (their videos are private to the owner)",
              items: {
                type: "object",
                properties: { key: { type: "string" }, title: { type: "string" }, text: nullable("string") },
              },
            },
            images: {
              type: "array",
              items: { type: "object", properties: { url: { type: "string" }, alt: nullable("string") } },
            },
            author: {
              type: "object",
              properties: {
                name: { type: "string" },
                email: nullable("string"),
                phone: nullable("string"),
                title: nullable("string"),
                company: nullable("string"),
                website: nullable("string"),
                socials: {
                  type: "object",
                  description: "Profile links or handles: x, linkedin, instagram, tiktok",
                  additionalProperties: { type: "string" },
                },
                avatarUrl: nullable("string"),
                companyLogoUrl: nullable("string"),
              },
            },
            video: {
              type: ["object", "null"],
              properties: {
                url: { type: "string" },
                mime: { type: "string" },
                originalUrl: nullable("string"),
                posterUrl: nullable("string"),
                captionsUrl: nullable("string"),
                durationMs: nullable("integer"),
                width: nullable("integer"),
                height: nullable("integer"),
                processing: { type: "string", enum: ["none", "queued", "processing", "ready", "failed", "skipped"] },
              },
            },
            tags: { type: "array", items: { type: "string" } },
            source: { type: "string", description: "How it arrived: form, api, manual, import:<format> or importer:<source>" },
            platform: nullable("string", { description: "Where the review was first posted (google, trustpilot…), for imports" }),
            sourceUrl: nullable("string"),
            sourceDate: nullable("string", { format: "date-time", description: "When it was first posted there" }),
            datePrecision: { type: "string", enum: [...DATE_PRECISIONS], description: "How exact sourceDate is: month means only the month is known" },
            language: nullable("string"),
            customFields: { type: "object", description: "Answers to the form's custom fields, by key (private)" },
            hiddenFields: { type: "object", description: "Hidden fields from the form link, such as utm_source (private)" },
            featured: { type: "boolean" },
            pinOrder: nullable("integer"),
            requested: { type: "boolean", description: "Came in through a personal request link" },
            approvedBy: {
              type: ["string", "null"],
              enum: ["owner", "api", "auto", null],
              description: "While approved: owner (the dashboard), api, or auto (the form's auto-approve rule). Null otherwise, and for testimonials approved before this was recorded",
            },
            approvedAt: nullable("string", { format: "date-time" }),
            consent: {
              type: "object",
              properties: {
                at: { type: "string", format: "date-time" },
                scopes: { type: "array", items: { type: "string", enum: [...CONSENT_SCOPES] } },
                public: { type: "boolean", description: "false when the author asked to keep it private; it can't be approved" },
                editedAfterConsent: { type: "boolean" },
                withdrawnAt: nullable("string", { format: "date-time" }),
              },
            },
            trashedAt: nullable("string", { format: "date-time" }),
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        NewTestimonial: {
          type: "object",
          required: ["name", "text", "consent"],
          properties: {
            name: { type: "string", maxLength: 120 },
            email: { type: "string", format: "email" },
            title: { type: "string", maxLength: 120 },
            company: { type: "string", maxLength: 120 },
            rating: { type: "integer", minimum: 1, maximum: 5 },
            headline: { type: "string", maxLength: 200 },
            text: { type: "string", maxLength: 5000 },
            status: { type: "string", enum: ["pending", "approved"], default: "pending" },
            tags: { type: "array", items: { type: "string", maxLength: 32 }, maxItems: 20 },
            website: { type: "string", format: "uri", description: "The author's (or their company's) site" },
            platform: { type: "string", maxLength: 40, description: "Where the review was first posted, e.g. g2" },
            sourceUrl: { type: "string", format: "uri" },
            sourceDate: { type: "string", description: "A date (2026-10-12) or date-time" },
            datePrecision: { type: "string", enum: [...DATE_PRECISIONS], default: "day" },
            language: { type: "string", maxLength: 35 },
            customFields: { type: "object", description: "Values by field key: text, numbers, true/false or null" },
            socials: { type: "object", description: "x, linkedin, instagram, tiktok: a profile link or handle each", additionalProperties: { type: "string" } },
            avatarUrl: { type: "string", format: "uri", description: "An https:// photo of the author, fetched in the background (public addresses only)" },
            consent: { const: true, description: "Confirms the author agreed to publication; recorded in the consent ledger" },
            consentScopes: { type: "array", items: { type: "string", enum: [...CONSENT_SCOPES] } },
          },
        },
        TestimonialPatch: {
          type: "object",
          properties: {
            status: {
              type: "string",
              enum: ["pending", "approved", "rejected", "hidden"],
              description: "hidden keeps it for internal use. A testimonial whose author asked to keep it private can't be approved (409)",
            },
            authorName: { type: "string" },
            authorTitle: nullable("string"),
            authorCompany: nullable("string"),
            headline: nullable("string"),
            text: nullable("string"),
            rating: nullable("integer", { minimum: 1, maximum: 5 }),
            transcript: nullable("string"),
            captionsVtt: nullable("string", { description: "WebVTT or SRT" }),
            tags: { type: "array", items: { type: "string" } },
            authorWebsite: nullable("string", { format: "uri" }),
            authorPhone: nullable("string"),
            authorSocials: { type: "object", description: "x, linkedin, instagram, tiktok", additionalProperties: { type: "string" } },
            sourceUrl: nullable("string", { format: "uri" }),
            sourceDate: nullable("string", { description: "A date (2026-10-12) or date-time" }),
            datePrecision: { type: "string", enum: [...DATE_PRECISIONS] },
            platform: nullable("string"),
            language: nullable("string"),
            customFields: { type: "object" },
            isFeatured: { type: "boolean" },
            pinOrder: nullable("integer", { minimum: 0 }),
          },
        },
        NewInvite: {
          type: "object",
          required: ["campaignId", "email"],
          properties: {
            campaignId: { type: "string", description: "Shown on the campaign's Auto-collect tab" },
            email: { type: "string", format: "email" },
            name: { type: "string", maxLength: 120 },
            company: { type: "string", maxLength: 120 },
            title: { type: "string", maxLength: 120 },
            variables: {
              type: "object",
              description: "Template variables for {{key}} in the campaign's wording (keys: letters, digits and _, up to 20)",
              additionalProperties: { type: ["string", "number", "boolean", "null"] },
            },
            delayDays: { type: "number", minimum: 0, maximum: 365, description: "Send this many days later; 0 or absent sends now" },
          },
        },
        Invite: {
          type: "object",
          properties: {
            id: { type: "string" },
            campaignId: nullable("string"),
            email: { type: "string" },
            name: nullable("string"),
            company: nullable("string"),
            title: nullable("string"),
            variables: { type: "object", additionalProperties: { type: "string" } },
            stage: {
              type: "string",
              enum: ["not_sent", "queued", "sent", "failed", "bounced", "opened", "clicked", "started", "submitted", "declined", "unsubscribed"],
              description: "The furthest step: opened only for campaigns that track opens",
            },
            status: { type: "string", enum: ["waiting", "responded", "unsubscribed", "declined"] },
            emailStatus: { type: "string", enum: ["not_sent", "queued", "sent", "failed", "bounced"] },
            scheduledFor: nullable("string", { format: "date-time", description: "When a delayed invitation goes out" }),
            sentAt: nullable("string", { format: "date-time" }),
            remindersSent: { type: "integer" },
            openedAt: nullable("string", { format: "date-time" }),
            clickedAt: nullable("string", { format: "date-time" }),
            startedAt: nullable("string", { format: "date-time" }),
            respondedAt: nullable("string", { format: "date-time" }),
            declinedAt: nullable("string", { format: "date-time" }),
            unsubscribedAt: nullable("string", { format: "date-time" }),
            testimonialId: nullable("string"),
            link: { type: "string", format: "uri", description: "The personal form link" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        ...(api2 ? api2Schemas() : {}),
        ...(insights ? insightsSchemas() : {}),
        ...(commerce ? commerceSchemas() : {}),
        WebhookPayload: {
          type: "object",
          properties: {
            id: { type: "string", description: "Delivery id (also in the Plaudit-Delivery header)" },
            event: { type: "string", enum: [...WEBHOOK_EVENTS, "ping"] },
            createdAt: { type: "string", format: "date-time" },
            project: ref("Project"),
            data: {
              type: "object",
              properties: {
                testimonial: ref("Testimonial"),
                invite: { ...ref("Invite"), description: "On invite.* events" },
                kind: { type: "string", enum: ["invite", "reminder"], description: "Only on invite.sent" },
                approvedBy: { type: "string", enum: ["owner", "api", "auto"], description: "Only on testimonial.approved" },
                socialDraft: { type: "object", description: "On testimonial.approved (with the commerce flag) and testimonial.social_draft_updated: text, url, post, shareUrls, clip" },
                response: {
                  type: "object",
                  description: "Only on survey.response: one NPS answer (never an email)",
                  properties: {
                    id: { type: "string" },
                    formId: { type: "string" },
                    questionKey: { type: "string" },
                    score: { type: "integer", minimum: 0, maximum: 10 },
                    category: { type: "string", enum: ["promoter", "passive", "detractor"] },
                    comment: { type: ["string", "null"] },
                    createdAt: { type: "string", format: "date-time" },
                  },
                },
                form: { type: "object", description: "On form.submitted and survey.response: id, slug, name" },
                message: { type: "string" },
              },
            },
          },
        },
      },
    },
  };
}

// ------------------------------------------------------------------ M14 (api2)

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const error = { description: "Error", content: { "application/json": { schema: ref("Error") } } };
const json = (schema: object) => ({ "application/json": { schema } });
const one = (schema: string, description = "OK") => ({ description, content: json({ type: "object", properties: { data: ref(schema) } }) });
const many = (schema: string, paged = false) => ({
  description: "OK",
  content: json({
    type: "object",
    properties: { data: { type: "array", items: ref(schema) }, ...(paged ? { pagination: ref("Pagination") } : {}) },
  }),
});
const deleted = { description: "Deleted", content: json({ type: "object", properties: { ok: { const: true } } }) };
const body = (schema: string) => ({ required: true, content: json(ref(schema)) });
const slugParam = { name: "slug", in: "path", required: true, description: "The project's slug", schema: { type: "string" } };
const idParam = { name: "id", in: "path", required: true, schema: { type: "string" } };
const pageQuery = [
  { name: "limit", in: "query", description: "Outside 1–100 is a 400 error", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
  { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
];
const rangeQuery = [
  { name: "from", in: "query", description: "First day (UTC), YYYY-MM-DD. Default: 29 days before `to`", schema: { type: "string", format: "date" } },
  { name: "to", in: "query", description: "Last day (UTC), YYYY-MM-DD; never later than today. Default: today. At most 731 days", schema: { type: "string", format: "date" } },
];
const reads = { "401": error, "404": error };
const writes = { "400": error, "401": error, "403": error, "404": error, "409": error, "413": error };

/** A project's collection (list and create) and the object's own path (get, update, delete). */
function crud(o: { plural: string; Name: string; list: string; create: string; get: string; update: string; remove: string; newSchema: string; patchSchema: string }) {
  return {
    [`/projects/{slug}/${o.plural}`]: {
      parameters: [slugParam],
      get: { summary: o.list, operationId: `list${o.Name}s`, responses: { "200": many(o.Name), ...reads } },
      post: { summary: `${o.create} (write scope)`, operationId: `create${o.Name}`, requestBody: body(o.newSchema), responses: { "201": one(o.Name, "Created"), ...writes } },
    },
    [`/${o.plural}/{id}`]: {
      parameters: [idParam],
      get: { summary: o.get, operationId: `get${o.Name}`, responses: { "200": one(o.Name), ...reads } },
      patch: { summary: `${o.update} (write scope)`, operationId: `update${o.Name}`, requestBody: body(o.patchSchema), responses: { "200": one(o.Name), ...writes } },
      delete: { summary: `${o.remove} (write scope)`, operationId: `delete${o.Name}`, responses: { "200": deleted, ...reads, "403": error, "409": error } },
    },
  };
}

function api2Paths() {
  return {
    ...crud({
      plural: "forms",
      Name: "Form",
      list: "List a project's forms, default first, with stats and share links",
      create: "Add a step-by-step form, blank or from a template",
      get: "Get a form",
      update: "Change a form: name, language, live or paused, link, default, or whole config parts",
      remove: "Delete a form (its testimonials stay; the default form can't be deleted)",
      newSchema: "NewForm",
      patchSchema: "FormPatch",
    }),
    ...crud({
      plural: "widgets",
      Name: "Widget",
      list: "List a project's saved widgets, with their embed snippets",
      create: "Add a saved widget",
      get: "Get a widget",
      update: "Change a widget's name, placement, connected form or whole config",
      remove: "Delete a widget (pages that embed it show nothing)",
      newSchema: "NewWidget",
      patchSchema: "WidgetPatch",
    }),
    ...crud({
      plural: "walls",
      Name: "Wall",
      list: "List a project's walls",
      create: "Add a wall, as a draft",
      get: "Get a wall",
      update: "Change a wall: name, theme, published, main, link, featured testimonial, connected form or whole config",
      remove: "Delete a wall",
      newSchema: "NewWall",
      patchSchema: "WallPatch",
    }),
    ...crud({
      plural: "campaigns",
      Name: "Campaign",
      list: "List a project's campaigns, newest first, with their funnels",
      create: "Add a campaign, as a draft with the default wording",
      get: "Get a campaign and its funnel",
      update: "Change a campaign's settings, or start (status: active) or pause it",
      remove: "Delete a campaign and its recipients (testimonials stay)",
      newSchema: "NewCampaign",
      patchSchema: "CampaignPatch",
    }),
    "/campaigns/{id}/recipients": {
      parameters: [idParam],
      get: { summary: "List a campaign's recipients, newest first", operationId: "listRecipients", parameters: pageQuery, responses: { "200": many("Invite", true), ...reads } },
      post: {
        summary: "Add people to a campaign (write scope)",
        description: "On an active campaign their invitations are queued at once. Rows that were skipped come back with the reason.",
        operationId: "addRecipients",
        requestBody: body("NewRecipients"),
        responses: {
          "201": {
            description: "Added",
            content: json({
              type: "object",
              properties: {
                data: { type: "array", items: ref("Invite") },
                skipped: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      line: { type: ["integer", "null"] },
                      email: { type: "string" },
                      text: { type: "string" },
                      reason: { type: "string", enum: ["invalid", "duplicate", "unsubscribed", "responded"] },
                      detail: { type: "string" },
                    },
                  },
                },
                rows: { type: "integer" },
              },
            }),
          },
          ...writes,
        },
      },
    },
    "/projects/{slug}/tags": {
      parameters: [slugParam],
      get: { summary: "List a project's tags with how many testimonials have each", operationId: "listTags", responses: { "200": many("Tag"), ...reads } },
      patch: { summary: "Rename or merge tags on every testimonial at once (write scope)", operationId: "changeTags", requestBody: body("TagChange"), responses: { "200": many("Tag"), ...writes } },
      delete: {
        summary: "Remove a tag from every testimonial and the project (write scope)",
        operationId: "deleteTag",
        parameters: [{ name: "name", in: "query", required: true, schema: { type: "string" } }],
        responses: { "200": many("Tag"), ...writes },
      },
    },
    "/projects/{slug}/customers": {
      parameters: [slugParam],
      get: {
        summary: "List a project's customers, by name",
        operationId: "listCustomers",
        parameters: [{ name: "email", in: "query", description: "Only the customer with this address", schema: { type: "string", format: "email" } }, ...pageQuery],
        responses: { "200": many("Customer", true), "400": error, ...reads },
      },
    },
    "/customers/{id}": { parameters: [idParam], get: { summary: "Get a customer", operationId: "getCustomer", responses: { "200": one("Customer"), ...reads } } },
    "/projects/{slug}/feedback": {
      parameters: [slugParam],
      get: { summary: "List a project's private feedback, newest first", operationId: "listFeedback", parameters: pageQuery, responses: { "200": many("Feedback", true), "400": error, ...reads } },
    },
    "/projects/{slug}/analytics": {
      parameters: [slugParam],
      get: {
        summary: "A project's analytics over a period, with the period before",
        description: "The analytics dashboard's numbers for this project. 404 when analytics is switched off on the server.",
        operationId: "projectAnalytics",
        parameters: rangeQuery,
        responses: { "200": one("ProjectAnalytics"), "400": error, ...reads },
      },
    },
    "/analytics/{type}/{id}": {
      parameters: [{ name: "type", in: "path", required: true, schema: { type: "string", enum: [...ANALYTICS_OBJECTS] } }, idParam],
      get: {
        summary: "One widget's, form's, wall's, snippet's or testimonial page's analytics over a period",
        operationId: "objectAnalytics",
        parameters: rangeQuery,
        responses: { "200": one("ObjectAnalytics"), "400": error, ...reads },
      },
    },
    "/webhooks": {
      get: { summary: "List the webhook subscriptions this key made", operationId: "listSubscriptions", responses: { "200": many("Subscription"), "401": error } },
      post: {
        summary: "Subscribe a URL to events (write scope), as REST hooks need",
        description:
          "The hook is signed like any other (Plaudit-Signature), shows in Settings › Webhooks and can be deleted there. The secret is in this answer only. Public addresses only. Up to 50 per key.",
        operationId: "subscribe",
        requestBody: body("NewSubscription"),
        responses: { "201": one("Subscription", "Created"), ...writes },
      },
    },
    "/webhooks/{id}": {
      parameters: [idParam],
      delete: { summary: "Unsubscribe (write scope; only the key that subscribed)", operationId: "unsubscribe", responses: { "200": deleted, ...reads, "403": error } },
    },
  };
}

function api2Schemas() {
  const obj = (description: string) => ({ type: "object", description });
  const str = { type: "string" };
  const time = { type: "string", format: "date-time" };
  const nullable = (type: string) => ({ type: [type, "null"] });
  return {
    Pagination: {
      type: "object",
      properties: { total: { type: "integer" }, limit: { type: "integer" }, offset: { type: "integer" }, nextOffset: nullable("integer") },
    },
    Form: {
      type: "object",
      properties: {
        id: str,
        projectId: str,
        slug: str,
        name: str,
        status: { type: "string", enum: [...FORM_STATUSES] },
        layout: { type: "string", enum: ["classic", "steps"], description: "classic is the original single page; steps is the step-by-step form" },
        isDefault: { type: "boolean" },
        language: str,
        template: nullable("string"),
        logoUrl: nullable("string"),
        config: obj("pages, design, labels and settings, exactly as the form builder edits them"),
        reward: obj("The thank-you reward, if any"),
        links: {
          type: "object",
          properties: { hosted: { type: "string", format: "uri" }, inline: str, popup: str, iframe: str },
          description: "The form's address and its three embed snippets",
        },
        stats: obj("In lists: submissions, invites, responded and responseRate"),
        createdAt: time,
        updatedAt: time,
      },
    },
    NewForm: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string", maxLength: 120 }, slug: { type: "string", maxLength: 48 }, template: { type: "string", enum: [...TEMPLATE_IDS] } },
    },
    FormPatch: {
      type: "object",
      description: "Each config part sent replaces that part whole and is checked as the builder's save is",
      properties: {
        name: { type: "string", maxLength: 120 },
        language: str,
        status: { type: "string", enum: [...FORM_STATUSES] },
        slug: { type: "string", maxLength: 48, description: "A new link; the old one keeps working" },
        isDefault: { const: true, description: "Make it the project's default form" },
        pages: { type: "array", maxItems: 30, items: { type: "object" } },
        design: { type: "object" },
        labels: { type: "object", properties: { overrides: { type: "object", additionalProperties: { type: "string" } } } },
        settings: { type: "object" },
        reward: { type: "object" },
      },
    },
    Widget: {
      type: "object",
      properties: {
        id: { type: "string", description: "w_ and 12 letters or digits" },
        projectId: str,
        name: str,
        layout: { type: "string", enum: [...LAYOUTS] },
        placement: { type: ["string", "null"], enum: [...PLACEMENTS, null] },
        connectedFormId: nullable("string"),
        config: obj("Layout, selection, filters, design, labels and custom CSS, exactly as the widget studio edits them"),
        embed: {
          type: "object",
          properties: {
            script: str,
            iframe: str,
            hosted: { type: "string", format: "uri" },
            react: str,
            html: { type: "string", format: "uri", description: "The server-side HTML include (SEO)" },
            htmlWithJsonLd: { type: "string", format: "uri" },
          },
        },
        createdAt: time,
        updatedAt: time,
      },
    },
    NewWidget: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", maxLength: 120 },
        layout: { type: "string", enum: [...LAYOUTS], default: "grid" },
        placement: { type: ["string", "null"], enum: [...PLACEMENTS, "", null] },
        connectedFormId: nullable("string"),
        config: { type: "object" },
      },
    },
    WidgetPatch: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 120 },
        placement: { type: ["string", "null"], enum: [...PLACEMENTS, "", null] },
        connectedFormId: nullable("string"),
        config: { type: "object", description: "Replaces the whole config" },
      },
    },
    Wall: {
      type: "object",
      properties: {
        id: str,
        projectId: str,
        name: str,
        slug: str,
        published: { type: "boolean" },
        isMain: { type: "boolean", description: "Shown at the project's own wall address while published" },
        theme: { type: "string", enum: [...WALL_THEMES] },
        config: obj("Hero, tabs, filters, call to action, SEO and head options, exactly as the wall editor edits them"),
        logoUrl: nullable("string"),
        coverUrl: nullable("string"),
        faviconUrl: nullable("string"),
        featuredTestimonialId: nullable("string"),
        connectedFormId: nullable("string"),
        url: { type: "string", format: "uri", description: "Its own address" },
        publicUrl: { type: "string", format: "uri", description: "Where visitors see it" },
        createdAt: time,
        updatedAt: time,
      },
    },
    NewWall: {
      type: "object",
      required: ["name"],
      properties: { name: { type: "string", maxLength: 120 }, slug: { type: "string", maxLength: 48 }, theme: { type: "string", enum: [...WALL_THEMES] } },
    },
    WallPatch: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 120 },
        theme: { type: "string", enum: [...WALL_THEMES] },
        published: { type: "boolean" },
        main: { type: "boolean" },
        slug: { type: "string", description: "A new link; the old one keeps working" },
        config: { type: "object", description: "Replaces the whole config" },
        featuredTestimonialId: nullable("string"),
        connectedFormId: nullable("string"),
      },
    },
    Campaign: {
      type: "object",
      properties: {
        id: str,
        projectId: str,
        formId: nullable("string"),
        name: str,
        status: { type: "string", enum: ["draft", "active", "paused"] },
        senderName: str,
        replyTo: str,
        subject: str,
        body: str,
        buttonText: str,
        rtl: { type: "boolean" },
        reminders: { type: "array", items: { type: "integer" }, description: "Days after the invitation" },
        trackOpens: { type: "boolean" },
        rewardCodes: { type: "boolean" },
        webhook: { type: "object", properties: { on: { type: "boolean", description: "Whether its incoming webhook URL is on (the URL itself is shown only in the dashboard)" } } },
        funnel: obj("recipients, queued, sent, bounced, failed, opened (null without open tracking), clicked, started, submitted, declined, unsubscribed"),
        createdAt: time,
        updatedAt: time,
      },
    },
    NewCampaign: { type: "object", required: ["name"], properties: { name: { type: "string", maxLength: 120 }, formId: nullable("string") } },
    CampaignPatch: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 120 },
        formId: nullable("string"),
        senderName: { type: "string", maxLength: 80 },
        replyTo: { type: "string", description: "An email address, or empty" },
        subject: { type: "string", maxLength: 200 },
        body: { type: "string", maxLength: 10000, description: "With {{name}}, {{first_name}}, {{company}}, {{link}} and custom variables" },
        buttonText: { type: "string", maxLength: 60 },
        rtl: { type: "boolean" },
        reminders: { type: "array", items: { type: "integer", minimum: 1, maximum: 60 }, maxItems: 3 },
        trackOpens: { type: "boolean" },
        rewardCodes: { type: "boolean" },
        status: { type: "string", enum: ["active", "paused"], description: "active starts it (409 if email isn't set up on the server); paused stops sends and reminders" },
      },
    },
    NewRecipients: {
      oneOf: [
        { type: "object", required: ["source", "text"], properties: { source: { const: "paste" }, text: { type: "string", description: "Lines of name, email, company, or a CSV with a header row" } } },
        { type: "object", required: ["source", "ids"], properties: { source: { const: "customers" }, ids: { type: "array", items: { type: "string" }, maxItems: 5000 } } },
        {
          type: "object",
          required: ["source", "person"],
          properties: {
            source: { const: "manual" },
            person: { type: "object", required: ["email"], properties: { email: str, name: str, company: str, title: str } },
          },
        },
      ],
    },
    Tag: { type: "object", properties: { name: str, count: { type: "integer" } } },
    TagChange: {
      oneOf: [
        { type: "object", required: ["action", "from", "to"], properties: { action: { const: "rename" }, from: str, to: str } },
        { type: "object", required: ["action", "from", "into"], properties: { action: { const: "merge" }, from: { type: "array", items: str }, into: str } },
      ],
    },
    Customer: {
      type: "object",
      properties: {
        id: str,
        projectId: str,
        email: nullable("string"),
        name: str,
        title: nullable("string"),
        company: nullable("string"),
        website: nullable("string"),
        avatarUrl: nullable("string"),
        socials: { type: "object", additionalProperties: { type: "string" } },
        custom: { type: "object" },
        createdAt: time,
        updatedAt: time,
      },
    },
    Feedback: {
      type: "object",
      description: "Private feedback: never published",
      properties: {
        id: str,
        projectId: str,
        formId: nullable("string"),
        customerId: nullable("string"),
        testimonialId: nullable("string"),
        source: { type: "string", enum: ["private-question", "low-rating", "survey"] },
        rating: nullable("integer"),
        text: str,
        author: { type: "object", properties: { name: nullable("string"), email: nullable("string") } },
        createdAt: time,
      },
    },
    Subscription: {
      type: "object",
      properties: {
        id: str,
        url: { type: "string", format: "uri" },
        events: { type: "array", items: { type: "string", enum: [...WEBHOOK_EVENTS] } },
        project: nullable("string"),
        active: { type: "boolean" },
        createdAt: time,
        secret: { type: "string", description: "Only when it's made: the signing secret for Plaudit-Signature" },
      },
    },
    NewSubscription: {
      type: "object",
      required: ["url", "events"],
      properties: {
        url: { type: "string", format: "uri" },
        events: { type: "array", minItems: 1, items: { type: "string", enum: [...WEBHOOK_EVENTS] } },
        project: { type: "string", description: "A project's slug; required for a key limited to some projects" },
      },
    },
    ProjectAnalytics: obj("range, previousRange, days, tiles (testimonials, backlog, rating, views, booster clicks, invites; each with the previous period), series (views by day) and tables of widgets, forms and walls"),
    ObjectAnalytics: obj("type, id, range, previousRange, days, current and previous totals, daily series, topPages (widgets), funnel (forms), sites (snippets) and install (widgets)"),
  };
}

// ------------------------------------------------------------------ M17 and M18 (L23, L25)

function insightsPaths() {
  return {
    "/projects/{slug}/case-studies": {
      parameters: [slugParam],
      get: { summary: "List a project's case studies, last changed first (flag insights)", operationId: "listCaseStudies", responses: { "200": many("CaseStudy"), ...reads } },
      post: {
        summary: "Start a draft case study from a testimonial, filled from the template (write scope)",
        description: "No AI is involved. 409 for a testimonial in the trash.",
        operationId: "createCaseStudy",
        requestBody: body("NewCaseStudy"),
        responses: { "201": one("CaseStudy", "Created"), ...writes },
      },
    },
    "/case-studies/{id}": {
      parameters: [idParam],
      get: { summary: "Get a case study", operationId: "getCaseStudy", responses: { "200": one("CaseStudy"), ...reads } },
      patch: {
        summary: "Change a case study's title, content fields or status (write scope)",
        description: "Content fields left out keep their values. Published makes /cs/{id} and its PDF public while the testimonial is approved with public consent.",
        operationId: "updateCaseStudy",
        requestBody: body("CaseStudyPatch"),
        responses: { "200": one("CaseStudy"), ...writes },
      },
    },
    "/projects/{slug}/nps": {
      parameters: [slugParam],
      get: {
        summary: "A project's NPS: the score, the three groups, the spread, a trend and the latest comments (read only)",
        operationId: "npsSummary",
        parameters: [
          { name: "from", in: "query", description: "First day (UTC), YYYY-MM-DD", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", description: "Last day (UTC), YYYY-MM-DD", schema: { type: "string", format: "date" } },
          { name: "formId", in: "query", description: "Only this form's answers", schema: { type: "string" } },
        ],
        responses: { "200": one("NpsSummary"), "400": error, ...reads },
      },
    },
    "/projects/{slug}/survey-responses": {
      parameters: [slugParam],
      get: {
        summary: "List a project's NPS answers, newest first (read only)",
        operationId: "listSurveyResponses",
        parameters: [{ name: "formId", in: "query", description: "Only this form's answers", schema: { type: "string" } }, ...pageQuery],
        responses: { "200": many("SurveyResponse", true), "400": error, ...reads },
      },
    },
    "/projects/{slug}/insight-reports": {
      parameters: [slugParam],
      get: { summary: "List a project's saved Insights reports, newest first, without their results (read only)", operationId: "listInsightReports", responses: { "200": many("InsightReport"), ...reads } },
    },
    "/insight-reports/{id}": {
      parameters: [idParam],
      get: { summary: "Get a saved report with its result, as it was when saved (read only)", operationId: "getInsightReport", responses: { "200": one("InsightReport"), ...reads } },
    },
  };
}

function commercePaths() {
  return {
    "/testimonials/{id}/social-draft": {
      parameters: [idParam],
      get: {
        summary: "An approved testimonial's social post draft, made from the template if it has none yet (flag commerce)",
        description: "409 while the testimonial isn't approved.",
        operationId: "getSocialDraft",
        responses: { "200": one("SocialDraft"), ...reads, "409": error },
      },
      patch: {
        summary: "Save new text for the draft (write scope); sends testimonial.social_draft_updated",
        operationId: "updateSocialDraft",
        requestBody: body("SocialDraftPatch"),
        responses: { "200": one("SocialDraft"), ...writes },
      },
    },
  };
}

function insightsSchemas() {
  const str = { type: "string" };
  const time = { type: "string", format: "date-time" };
  const nullable = (type: string) => ({ type: [type, "null"] });
  const content = {
    type: "object",
    properties: {
      summary: { type: "string", maxLength: 500 },
      challenge: { type: "string", maxLength: 3000 },
      solution: { type: "string", maxLength: 3000 },
      result: { type: "string", maxLength: 3000 },
      pullQuote: { type: "string", maxLength: 600, description: "The customer's own words" },
      metrics: { type: "array", maxItems: 4, items: { type: "object", required: ["value", "label"], properties: { value: { type: "string", maxLength: 24 }, label: { type: "string", maxLength: 80 } } } },
    },
  };
  return {
    CaseStudy: {
      type: "object",
      properties: {
        id: str,
        projectId: str,
        testimonialId: str,
        status: { type: "string", enum: [...CASE_STUDY_STATUSES] },
        title: str,
        content,
        aiDraftedAt: nullable("string"),
        person: { type: ["object", "null"], properties: { name: str, title: nullable("string"), company: nullable("string") } },
        publicUrl: { type: ["string", "null"], format: "uri", description: "Live only while published and the testimonial may be public" },
        canBePublic: { type: "boolean" },
        createdAt: time,
        updatedAt: time,
      },
    },
    NewCaseStudy: { type: "object", required: ["testimonialId"], properties: { testimonialId: str } },
    CaseStudyPatch: {
      type: "object",
      additionalProperties: false,
      properties: { title: { type: "string", minLength: 1, maxLength: 160 }, status: { type: "string", enum: [...CASE_STUDY_STATUSES] }, content },
    },
    NpsSummary: {
      type: "object",
      description: "Promoters score 9–10, passives 7–8, detractors 0–6; the score is promoters' share minus detractors', −100 to 100",
      properties: {
        responses: { type: "integer" },
        score: nullable("integer"),
        promoters: { type: "integer" },
        passives: { type: "integer" },
        detractors: { type: "integer" },
        distribution: { type: "array", items: { type: "object", properties: { value: { type: "integer" }, count: { type: "integer" } } } },
        trend: { type: "object", properties: { by: { type: "string", enum: ["day", "week"] }, points: { type: "array", items: { type: "object" } } } },
        comments: { type: "array", description: "The latest 100, with a name but never an email", items: { type: "object" } },
      },
    },
    SurveyResponse: {
      type: "object",
      description: "One answer to an NPS question. Private: never published",
      properties: {
        id: str,
        projectId: str,
        formId: nullable("string"),
        testimonialId: { type: ["string", "null"], description: "Set when a promoter went on to write one" },
        questionKey: str,
        score: { type: "integer", minimum: 0, maximum: 10 },
        category: { type: "string", enum: ["promoter", "passive", "detractor"] },
        comment: nullable("string"),
        author: { type: "object", properties: { name: nullable("string"), email: nullable("string") } },
        createdAt: time,
      },
    },
    InsightReport: {
      type: "object",
      properties: {
        id: str,
        kind: { type: "string", enum: [...INSIGHT_REPORT_KINDS] },
        name: str,
        params: { type: "object", description: "What was asked: dates, tags, source, question" },
        result: { type: "object", description: "Only on GET /insight-reports/{id}: the report as it was shown" },
        createdBy: nullable("string"),
        createdAt: time,
      },
    },
  };
}

function commerceSchemas() {
  return {
    SocialDraft: {
      type: "object",
      properties: {
        testimonialId: { type: "string" },
        text: { type: "string" },
        url: { type: "string", format: "uri", description: "The testimonial's own page, added when it's shared" },
        post: { type: "string", description: "The text and the link, as one post" },
        shareUrls: { type: "object", properties: { x: { type: "string", format: "uri" }, linkedin: { type: "string", format: "uri" } } },
        clip: { type: ["object", "null"], description: "The newest ready social clip, if any" },
        edited: { type: "boolean" },
        aiRewrittenAt: { type: ["string", "null"] },
        updatedAt: { type: "string", format: "date-time" },
      },
    },
    SocialDraftPatch: { type: "object", required: ["text"], additionalProperties: false, properties: { text: { type: "string", minLength: 1, maxLength: 256 } } },
  };
}
