const { api } = require("../lib/api");
const { hook } = require("../lib/hooks");

/** Private feedback (a low rating or a private question): never publish it. Needs the api2 flag on the server. */
module.exports = {
  key: "feedback_received",
  noun: "Feedback",
  display: { label: "New Private Feedback", description: "Triggers when someone leaves private feedback, such as a low rating sent to your feedback page." },
  operation: {
    type: "hook",
    inputFields: [{ key: "project", label: "Project", required: true, dynamic: "projects.id.name" }],
    ...hook("feedback.created", (d) => d.feedback),
    performList: async (z, bundle) => (await api(z, bundle, `/projects/${encodeURIComponent(bundle.inputData.project)}/feedback?limit=50`)).data,
    sample: {
      id: "a1b2…",
      source: "low-rating",
      rating: 2,
      text: "Support took a week to reply.",
      author: { name: "Grace", email: "grace@example.com" },
      createdAt: "2026-10-22T09:30:00.000Z",
    },
  },
};
