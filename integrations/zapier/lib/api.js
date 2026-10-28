/**
 * Calls the Plaudit REST API (/api/v1) with the connection's server address
 * and API key. Only the public, versioned API is used: nothing here touches
 * the dashboard's own endpoints.
 */

/** The server address as the user typed it, without a trailing slash. */
const base = (bundle) => String(bundle.authData.server || "").trim().replace(/\/+$/, "");

/** A request to /api/v1<path>; the key is added by beforeRequest in index.js. */
async function api(z, bundle, path, options = {}) {
  const res = await z.request({ url: `${base(bundle)}/api/v1${path}`, ...options, skipThrowForStatus: true });
  if (res.status >= 400) {
    const message = (res.data && res.data.error) || `Plaudit answered ${res.status}`;
    if (res.status === 401) throw new z.errors.RefreshAuthError(message);
    throw new z.errors.Error(message, "PlauditError", res.status);
  }
  return res.data;
}

module.exports = { api, base };
