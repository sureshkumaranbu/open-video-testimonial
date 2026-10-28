const { api } = require("../lib/api");

/** Adds a text testimonial. The person's consent is required, as in Plaudit's own API. */
module.exports = {
  key: "create_testimonial",
  noun: "Testimonial",
  display: { label: "Create Testimonial", description: "Adds a text testimonial (pending, unless you approve it)." },
  operation: {
    inputFields: [
      { key: "project", label: "Project", required: true, dynamic: "projects.id.name" },
      { key: "name", label: "Name", required: true },
      { key: "text", label: "Testimonial", required: true, type: "text" },
      { key: "email", label: "Email" },
      { key: "title", label: "Job title" },
      { key: "company", label: "Company" },
      { key: "rating", label: "Rating (1–5)", type: "integer" },
      { key: "tags", label: "Tags", list: true },
      { key: "approve", label: "Approve it now", type: "boolean", default: "false" },
      {
        key: "consent",
        label: "The person agreed to publication",
        type: "boolean",
        required: true,
        helpText: "Plaudit records this in its consent ledger. Only say yes when they did.",
      },
    ],
    perform: async (z, bundle) => {
      const d = bundle.inputData;
      if (String(d.consent) !== "true") throw new z.errors.Error("Plaudit needs the person's consent to publication", "ConsentRequired", 400);
      const body = {
        name: d.name,
        text: d.text,
        consent: true,
        status: String(d.approve) === "true" ? "approved" : "pending",
        ...(d.email ? { email: d.email } : {}),
        ...(d.title ? { title: d.title } : {}),
        ...(d.company ? { company: d.company } : {}),
        ...(d.rating ? { rating: Number(d.rating) } : {}),
        ...(d.tags && d.tags.length ? { tags: d.tags } : {}),
      };
      return (await api(z, bundle, `/projects/${encodeURIComponent(d.project)}/testimonials`, { method: "POST", json: body })).data;
    },
    sample: { id: "5b0d…", status: "pending", text: "Shipped it in a day.", author: { name: "Grace Hopper" } },
  },
};
