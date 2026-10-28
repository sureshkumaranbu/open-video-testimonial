const { api } = require("../lib/api");

const id = { key: "testimonialId", label: "Testimonial ID", required: true, helpText: "From a trigger, e.g. New Testimonial › ID." };

module.exports = {
  approve: {
    key: "approve_testimonial",
    noun: "Testimonial",
    display: { label: "Approve Testimonial", description: "Approves a testimonial so it can appear on your site." },
    operation: {
      inputFields: [id],
      perform: async (z, bundle) =>
        (await api(z, bundle, `/testimonials/${encodeURIComponent(bundle.inputData.testimonialId)}`, { method: "PATCH", json: { status: "approved" } })).data,
      sample: { id: "5b0d…", status: "approved" },
    },
  },
  tag: {
    key: "tag_testimonial",
    noun: "Testimonial",
    display: { label: "Tag Testimonial", description: "Adds tags to a testimonial, keeping the ones it has." },
    operation: {
      inputFields: [id, { key: "tags", label: "Tags to add", required: true, list: true }],
      perform: async (z, bundle) => {
        const path = `/testimonials/${encodeURIComponent(bundle.inputData.testimonialId)}`;
        const current = (await api(z, bundle, path)).data;
        const tags = [...new Set([...(current.tags || []), ...bundle.inputData.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean)])];
        return (await api(z, bundle, path, { method: "PATCH", json: { tags } })).data;
      },
      sample: { id: "5b0d…", tags: ["homepage", "pricing"] },
    },
  },
};
