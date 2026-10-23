// Starts the standalone production server. Next's standalone server changes
// directory to .next/standalone, so load .env and resolve DATA_DIR against
// the directory `npm start` was run from first; otherwise config would be
// missed and data would land inside the build output (wiped on rebuild).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import "./peer-ip.mjs"; // must run before the server creates its HTTP listener

if (fs.existsSync(".env")) process.loadEnvFile(".env"); // never overrides real env vars
process.env.DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
await import(pathToFileURL(path.resolve(".next/standalone/server.js")).href);
