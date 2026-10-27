const { api } = require("./lib/api");

/** Your Plaudit server and an API key (Settings › API keys in Plaudit). */
module.exports = {
  type: "custom",
  fields: [
    {
      key: "server",
      label: "Plaudit address",
      required: true,
      type: "string",
      helpText: "Your Plaudit server, for example https://plaudit.example.com",
    },
    {
      key: "apiKey",
      label: "API key",
      required: true,
      type: "password",
      helpText: "Create one in Plaudit under Settings › API keys. Use a read-and-write key for the actions (adding testimonials, approving, tagging, inviting).",
    },
  ],
  test: (z, bundle) => api(z, bundle, "/projects"),
  connectionLabel: (z, bundle) => bundle.authData.server,
};
