// Gives the app a client address it can trust.
//
// Next.js doesn't expose the socket to route handlers, and it passes a
// client-supplied X-Forwarded-For through untouched, so on its own the app
// can't tell a real address from a made-up one. Loaded before the server
// starts (`node --import ./peer-ip.mjs server.js`, or by scripts/start.mjs),
// this overwrites the `x-plaudit-peer` header of every incoming request with
// the TCP peer address, and marks the process so src/lib/rate-limit.ts knows
// the header can be believed. Forwarding headers are only used on top of
// this when TRUST_PROXY says a reverse proxy sits in front.
import http from "node:http";

const HEADER = "x-plaudit-peer";
const emit = http.Server.prototype.emit;

http.Server.prototype.emit = function (event, req, ...rest) {
  if (event === "request" && req && typeof req === "object" && req.headers) {
    req.headers[HEADER] = req.socket?.remoteAddress ?? "";
  }
  return emit.call(this, event, req, ...rest);
};

globalThis.__plauditPeerHeader = true;
