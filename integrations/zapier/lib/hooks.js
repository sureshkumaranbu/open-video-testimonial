const { api } = require("./api");

/**
 * The REST hook parts of a Zapier trigger: subscribe to one Plaudit webhook
 * event for the chosen project, unsubscribe, and turn a delivery into the
 * item the Zap sees. Zapier keeps the subscription's id in subscribeData.
 */
function hook(event, pick) {
  return {
    performSubscribe: async (z, bundle) =>
      (await api(z, bundle, "/webhooks", { method: "POST", json: { url: bundle.targetUrl, events: [event], project: bundle.inputData.project } })).data,
    performUnsubscribe: async (z, bundle) => api(z, bundle, `/webhooks/${encodeURIComponent(bundle.subscribeData.id)}`, { method: "DELETE" }),
    perform: (z, bundle) => {
      const payload = bundle.cleanedRequest || {};
      if (payload.event !== event) return [];
      const item = pick(payload.data || {});
      return item ? [item] : [];
    },
  };
}

module.exports = { hook };
