const { api } = require("../lib/api");

/** Hidden: fills the Project dropdowns. */
module.exports = {
  key: "projects",
  noun: "Project",
  display: { label: "Project", description: "Lists your projects (used in dropdowns).", hidden: true },
  operation: {
    perform: async (z, bundle) => (await api(z, bundle, "/projects")).data.map((p) => ({ id: p.slug, name: p.name, slug: p.slug })),
    sample: { id: "acme", name: "Acme", slug: "acme" },
  },
};
