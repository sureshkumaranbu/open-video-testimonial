import { DATE_PRECISIONS, WEBHOOK_EVENTS } from "@/db/schema";
import { CONSENT_SCOPES } from "./consent";
import { DEFAULT_EVENTS } from "./webhooks";

/** OpenAPI 3.1 description of the REST API, served at /api/v1/openapi.json. */
export function openApiSpec(serverUrl: string) {
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
        "Keys are read-only or read-write. Limit: 600 requests per minute per key.",
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
                approvedBy: { type: "string", enum: ["owner", "api", "auto"], description: "Only on testimonial.approved" },
                message: { type: "string" },
              },
            },
          },
        },
      },
    },
  };
}
