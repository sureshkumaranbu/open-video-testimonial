const { api } = require("../lib/api");

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

/** Polls the newest testimonials; Zapier keeps track of the ids it has seen. */
function poll(status) {
  return async (z, bundle) => {
    const q = new URLSearchParams({ limit: "50", ...(status ? { status } : {}) });
    const res = await api(z, bundle, `/projects/${encodeURIComponent(bundle.inputData.project)}/testimonials?${q}`);
    // Newest first, each with an id, as Zapier expects.
    return res.data;
  };
}

module.exports = {
  created: {
    key: "testimonial_created",
    noun: "Testimonial",
    display: { label: "New Testimonial", description: "Triggers when a testimonial arrives (through a form, the API, an import or by hand)." },
    operation: { inputFields: [project], perform: poll(null), sample },
  },
  approved: {
    key: "testimonial_approved",
    noun: "Testimonial",
    display: {
      label: "Testimonial Approved",
      description: "Triggers when a testimonial is approved. Checks the 50 newest approved testimonials, so approving a much older one may not trigger it.",
    },
    operation: { inputFields: [project], perform: poll("approved"), sample: { ...sample, approvedBy: "owner" } },
  },
};
