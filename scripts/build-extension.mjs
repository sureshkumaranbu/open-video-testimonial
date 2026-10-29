/**
 * EXT-01: packs the browser extension (extension/) for the two stores.
 *
 *   npm run build:extension   →  dist/extension-chrome.zip, dist/extension-firefox.zip
 *
 * The files are plain JS with no build step, so extension/ itself loads
 * unpacked in Chrome (chrome://extensions › Load unpacked). Firefox gets the
 * same files with its own manifest: a background script instead of a service
 * worker, and an add-on id (set FIREFOX_ADDON_ID to your own before publishing).
 * The zip writer is our own (deflate from node:zlib), so nothing is added.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "extension");
const OUT = path.join(ROOT, "dist");

/** Every file under extension/, sorted, as [zip path, bytes]. */
export function extensionFiles(dir = SRC) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push([path.relative(dir, p).split(path.sep).join("/"), fs.readFileSync(p)]);
    }
  };
  walk(dir);
  return out;
}

/** Firefox's manifest: the same extension, with a background script and its add-on id. */
export function firefoxManifest(chrome, id = process.env.FIREFOX_ADDON_ID || "plaudit-extension@plaudit.invalid") {
  const { minimum_chrome_version, background, ...rest } = chrome;
  void minimum_chrome_version;
  return {
    ...rest,
    background: { scripts: [background.service_worker], type: "module" },
    // optional_host_permissions and storage.session need Firefox 128.
    browser_specific_settings: { gecko: { id, strict_min_version: "128.0" } },
  };
}

/** A zip of `entries` (deflated), with a fixed date so the same files make the same zip. */
export function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  const DOS_TIME = 0;
  const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0x0800, 6);
    head.writeUInt16LE(8, 8);
    head.writeUInt16LE(DOS_TIME, 10);
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    local.push(head, nameBuf, packed);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

export function build(out = OUT) {
  const files = extensionFiles();
  const manifest = JSON.parse(files.find(([n]) => n === "manifest.json")[1].toString("utf8"));
  const others = files.filter(([n]) => n !== "manifest.json");
  const json = (m) => Buffer.from(`${JSON.stringify(m, null, 2)}\n`);
  fs.mkdirSync(out, { recursive: true });
  const chrome = path.join(out, "extension-chrome.zip");
  const firefox = path.join(out, "extension-firefox.zip");
  fs.writeFileSync(chrome, zip([["manifest.json", json(manifest)], ...others]));
  fs.writeFileSync(firefox, zip([["manifest.json", json(firefoxManifest(manifest))], ...others]));
  return { chrome, firefox, files: files.length, version: manifest.version };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const r = build();
  console.log(`Plaudit extension ${r.version}: ${r.files} files\n  ${path.relative(ROOT, r.chrome)}\n  ${path.relative(ROOT, r.firefox)}`);
}
