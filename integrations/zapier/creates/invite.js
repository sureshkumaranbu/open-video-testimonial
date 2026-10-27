const { api } = require("../lib/api");

/** Adds a person to an active campaign, which emails them its invitation (optionally some days later). */
module.exports = {
  key: "send_invite",
  noun: "Invite",
  display: { label: "Send Invite", description: "Asks someone for a testimonial through one of your campaigns." },
  operation: {
    inputFields: [
      { key: "project", label: "Project", required: true, dynamic: "projects.id.name", altersDynamicFields: true },
      { key: "campaignId", label: "Campaign", required: true, dynamic: "campaigns.id.name", helpText: "It must be active (started) in Plaudit." },
      { key: "email", label: "Email", required: true },
      { key: "name", label: "Name" },
      { key: "company", label: "Company" },
      { key: "delayDays", label: "Days to wait before sending", type: "number", helpText: "0 or empty sends now; up to 365." },
    ],
    perform: async (z, bundle) => {
      const d = bundle.inputData;
      const body = {
        campaignId: d.campaignId,
        email: d.email,
        ...(d.name ? { name: d.name } : {}),
        ...(d.company ? { company: d.company } : {}),
        ...(d.delayDays ? { delayDays: Number(d.delayDays) } : {}),
      };
      const res = await api(z, bundle, "/invites", { method: "POST", json: body });
      // Someone already invited, unsubscribed or who already responded gets no second email.
      return { ...(res.data || {}), skipped: res.skipped || null };
    },
    sample: { id: "c0ff…", email: "ada@example.com", stage: "queued", skipped: null },
  },
};
