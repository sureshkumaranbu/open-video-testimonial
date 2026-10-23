// Next's standalone output doesn't include static assets or public/; copy them
// in so `node .next/standalone/server.js` (and the Docker image) serve them.
import fs from "node:fs";

const out = ".next/standalone";
if (fs.existsSync(out)) {
  fs.cpSync("public", `${out}/public`, { recursive: true });
  fs.cpSync(".next/static", `${out}/.next/static`, { recursive: true });
  fs.cpSync("drizzle", `${out}/drizzle`, { recursive: true });
  // Loaded with `node --import ./peer-ip.mjs server.js` (see the Dockerfile).
  fs.copyFileSync("scripts/peer-ip.mjs", `${out}/peer-ip.mjs`);
}
