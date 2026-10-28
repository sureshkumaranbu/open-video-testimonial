const { api } = require("../lib/api");
const { hook } = require("../lib/hooks");

const project = { key: "project", label: "Project", required: true, dynamic: "projects.id.name" };

const sample = {
  id: "5b0d0000-0000-4000-8000-000000000000",
  projectId: "9e1f0000-0000-4000-8000-000000000000",
  status: "approved",
  rating: 5,
  headline: "Six videos in a weekend",
  text: "We set it up on Friday and had six videos by Monday.",
  author: { name: "Ada Lovelace", email: "ada@example.com", title: "CTO", company: "Engines Ltd" },
  tags: ["homepage"],
  source: "form",
  createdAt: "2026-10-22T09:30:00.000Z",
};

/** Samples and the fallback: the newest testimonials, newest first. */
function list(status) {
  return async (z, bundle) => {
    const q = new URLSearchParams({ limit: "50", ...(status ? { status } : {}) });
    const res = await api(z, bundle, `/projects/${encodeURIComponent(bundle.inputData.project)}/testimonials?${q}`);
    return res.data;
  };
}

/**
 * Instant triggers: a REST hook on Plaudit's webhooks (POST /webhooks when
 * the Zap is turned on, DELETE when it's turned off). The testimonial in
 * each signed delivery is what the Zap gets.
 */
module.exports = {
  created: {
    key: "testimonial_created",
    noun: "Testimonial",
    display: { label: "New Testimonial", description: "Triggers when a testimonial arrives (through a form, the API, an import or by hand)." },
    operation: { type: "hook", inputFields: [project], ...hook("testimonial.created", (d) => d.testimonial), performList: list(null), sample },
  },
  approved: {
    key: "testimonial_approved",
    noun: "Testimonial",
    display: { label: "Testimonial Approved", description: "Triggers when a testimonial is approved, in the dashboard, through the API or by auto-approve." },
    operation: { type: "hook", inputFields: [project], ...hook("testimonial.approved", (d) => d.testimonial), performList: list("approved"), sample: { ...sample, approvedBy: "owner" } },
  },
};
