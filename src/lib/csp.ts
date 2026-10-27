/**
 * Content Security Policies. Shared by next.config.ts (static headers for
 * public pages) and src/proxy.ts (a per-request nonce for the dashboard).
 */

const dev = process.env.NODE_ENV === "development";
// React needs eval in development for its debugging aids, and the dev
// server's hot reload uses a websocket. Neither is allowed in production.
const devScript = dev ? " 'unsafe-eval'" : "";
const devConnect = dev ? " ws: wss:" : "";

function join(directives: Record<string, string>) {
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v}`)
    .join("; ");
}

const common = {
  "default-src": "'self'",
  // Style attributes are inline by nature; nothing else loads from outside.
  "style-src": "'self' 'unsafe-inline'",
  "img-src": "'self' data: blob:",
  // blob: is the recorder's own preview of what was just filmed.
  "media-src": "'self' blob:",
  "font-src": "'self' data:",
  "connect-src": `'self'${devConnect}`,
  "worker-src": "'self' blob:",
  "manifest-src": "'self'",
  "object-src": "'none'",
  "form-action": "'self'",
};

/**
 * Public pages are prerendered, so they can't carry a per-request nonce:
 * Next.js's inline bootstrap scripts need 'unsafe-inline'. Everything still
 * has to come from this server.
 */
export function publicCsp({ frameable = false, extra }: { frameable?: boolean; extra?: { script: string[]; connect: string[]; img: string[] } } = {}) {
  // WALL-07: a wall's chosen analytics provider, and nothing else (src/lib/wall-config.ts analyticsCspHosts).
  const add = (list: string[] | undefined) => (list?.length ? ` ${list.join(" ")}` : "");
  return join({
    ...common,
    "img-src": `${common["img-src"]}${add(extra?.img)}`,
    "connect-src": `${common["connect-src"]}${add(extra?.connect)}`,
    "script-src": `'self' 'unsafe-inline'${devScript}${add(extra?.script)}`,
    "base-uri": "'self'",
    // Only /embed/* is meant to be shown inside other sites.
    "frame-ancestors": frameable ? "*" : "'none'",
  });
}

/**
 * The dashboard: scripts run only with this response's nonce (Next.js adds
 * it to its own scripts, and 'strict-dynamic' lets those load the rest), so
 * markup injected into a page can't execute.
 */
export function adminCsp(nonce: string) {
  return join({
    ...common,
    "script-src": `'self' 'nonce-${nonce}' 'strict-dynamic'${devScript}`,
    "base-uri": "'none'",
    "frame-ancestors": "'none'",
  });
}
