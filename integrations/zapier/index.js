/**
 * Plaudit for Zapier (INT-03), a Zapier Platform CLI app. Triggers poll the
 * REST API (Zapier dedupes by id); actions call it. Everything goes through
 * the public /api/v1 with the user's API key: no dashboard endpoints.
 */
const authentication = require("./authentication");
const projects = require("./triggers/projects");
const campaigns = require("./triggers/campaigns");
const testimonial = require("./triggers/testimonial");
const feedback = require("./triggers/feedback");
const createTestimonial = require("./creates/testimonial");
const invite = require("./creates/invite");
const moderate = require("./creates/moderate");

/** Every request carries the key as a bearer token. */
const addKey = (request, z, bundle) => {
  request.headers = { ...request.headers, Authorization: `Bearer ${bundle.authData.apiKey}`, Accept: "application/json" };
  return request;
};

const byKey = (list) => Object.fromEntries(list.map((t) => [t.key, t]));

module.exports = {
  version: require("./package.json").version,
  platformVersion: require("zapier-platform-core").version,
  authentication,
  beforeRequest: [addKey],
  triggers: byKey([projects, campaigns, testimonial.created, testimonial.approved, feedback]),
  creates: byKey([createTestimonial, invite, moderate.approve, moderate.tag]),
};
