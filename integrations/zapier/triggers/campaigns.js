const { api } = require("../lib/api");

/** Hidden: fills the Campaign dropdown (needs the api2 flag on the server). */
module.exports = {
  key: "campaigns",
  noun: "Campaign",
  display: { label: "Campaign", description: "Lists a project's campaigns (used in dropdowns).", hidden: true },
  operation: {
    inputFields: [{ key: "project", label: "Project", required: true, dynamic: "projects.id.name" }],
    perform: async (z, bundle) =>
      (await api(z, bundle, `/projects/${encodeURIComponent(bundle.inputData.project)}/campaigns`)).data.map((c) => ({ id: c.id, name: `${c.name} (${c.status})` })),
    sample: { id: "6f1c…", name: "Spring (active)" },
  },
};
