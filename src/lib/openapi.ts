import { WEBHOOK_EVENTS } from "@/db/schema";

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
              description: "rejected excludes withdrawn testimonials; ask for withdrawn to get those",
              schema: { type: "string", enum: ["pending", "approved", "rejected", "withdrawn"] },
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
            createdAt: { type: "string", format: "date-time" },
            counts: {
              type: "object",
              properties: { pending: { type: "integer" }, approved: { type: "integer" }, rejected: { type: "integer" } },
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
              enum: ["pending", "approved", "rejected", "withdrawn"],
              description: "withdrawn: the author withdrew consent; it can't be published again",
            },
            rating: nullable("integer", { minimum: 1, maximum: 5 }),
            text: nullable("string"),
            transcript: nullable("string", { description: "Transcript of the video, if any" }),
            author: {
              type: "object",
              properties: {
                name: { type: "string" },
                email: nullable("string"),
                title: nullable("string"),
                company: nullable("string"),
                avatarUrl: nullable("string"),
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
            source: { type: "string", description: "form, api or import:<format>" },
            requested: { type: "boolean", description: "Came in through a personal request link" },
            consent: {
              type: "object",
              properties: {
                at: { type: "string", format: "date-time" },
                scopes: { type: "array", items: { type: "string", enum: ["website", "social"] } },
                editedAfterConsent: { type: "boolean" },
                withdrawnAt: nullable("string", { format: "date-time" }),
              },
            },
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
            text: { type: "string", maxLength: 5000 },
            status: { type: "string", enum: ["pending", "approved"], default: "pending" },
            tags: { type: "array", items: { type: "string", maxLength: 32 }, maxItems: 20 },
            consent: { const: true, description: "Confirms the author agreed to publication; recorded in the consent ledger" },
            consentScopes: { type: "array", items: { type: "string", enum: ["website", "social"] } },
          },
        },
        TestimonialPatch: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["pending", "approved", "rejected"] },
            authorName: { type: "string" },
            authorTitle: nullable("string"),
            authorCompany: nullable("string"),
            text: nullable("string"),
            rating: nullable("integer", { minimum: 1, maximum: 5 }),
            transcript: nullable("string"),
            captionsVtt: nullable("string", { description: "WebVTT or SRT" }),
            tags: { type: "array", items: { type: "string" } },
          },
        },
        WebhookPayload: {
          type: "object",
          properties: {
            id: { type: "string", description: "Delivery id (also in the Plaudit-Delivery header)" },
            event: { type: "string", enum: [...WEBHOOK_EVENTS, "ping"] },
            createdAt: { type: "string", format: "date-time" },
            project: ref("Project"),
            data: { type: "object", properties: { testimonial: ref("Testimonial"), message: { type: "string" } } },
          },
        },
      },
    },
  };
}
