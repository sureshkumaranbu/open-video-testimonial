import fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
import zlib from "node:zlib";

/**
 * A small ZIP writer and reader (no dependencies). The writer streams, so an
 * export of many gigabytes never sits in memory; it switches to ZIP64 when
 * sizes or offsets need it. Media is stored as-is (already compressed) and
 * text is deflated. The reader accepts what common tools produce (stored or
 * deflated, ZIP64), and checks sizes and CRCs while extracting.
 */

const MAX32 = 0xffffffff;

export type ZipSource = { name: string; data: Uint8Array | string } | { name: string; file: string };

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

async function fileCrc(path: string) {
  let crc = 0;
  for await (const chunk of fs.createReadStream(path)) crc = zlib.crc32(chunk as Buffer, crc);
  return crc >>> 0;
}

/** Yields the bytes of a ZIP archive containing `entries`, in order. */
export async function* zipStream(
  entries: Iterable<ZipSource> | AsyncIterable<ZipSource>,
  /** Tests lower this to exercise ZIP64 without writing 4 GB. */
  opts: { zip64Above?: number } = {},
): AsyncGenerator<Uint8Array> {
  const limit = opts.zip64Above ?? MAX32;
  const central: Buffer[] = [];
  let offset = 0;
  let count = 0;
  const { time, date } = dosDateTime(new Date());

  for await (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/^\/+/, ""), "utf8");
    let crc: number;
    let size: number;
    let compressedSize: number;
    let method: number;
    let body: Buffer | null = null;
    if ("data" in entry) {
      const raw = typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : Buffer.from(entry.data);
      crc = zlib.crc32(raw) >>> 0;
      size = raw.length;
      body = zlib.deflateRawSync(raw);
      method = 8;
      if (body.length >= raw.length) {
        body = raw;
        method = 0;
      }
      compressedSize = body.length;
    } else {
      size = (await fs.promises.stat(entry.file)).size;
      crc = await fileCrc(entry.file);
      compressedSize = size;
      method = 0;
    }
    const zip64 = size >= limit || compressedSize >= limit || offset >= limit;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(zip64 ? 45 : 20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(zip64 ? MAX32 : compressedSize, 18);
    local.writeUInt32LE(zip64 ? MAX32 : size, 22);
    local.writeUInt16LE(name.length, 26);
    const localExtra = zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
    if (zip64) {
      localExtra.writeUInt16LE(0x0001, 0);
      localExtra.writeUInt16LE(16, 2);
      localExtra.writeBigUInt64LE(BigInt(size), 4);
      localExtra.writeBigUInt64LE(BigInt(compressedSize), 12);
    }
    local.writeUInt16LE(localExtra.length, 28);

    yield local;
    yield name;
    if (localExtra.length) yield localExtra;
    if (body) yield body;
    else for await (const chunk of fs.createReadStream((entry as { file: string }).file)) yield chunk as Buffer;

    // Central directory record (written at the end).
    const fields: bigint[] = [];
    if (zip64) fields.push(BigInt(size), BigInt(compressedSize));
    if (offset >= limit) fields.push(BigInt(offset));
    const extra = Buffer.alloc(fields.length ? 4 + fields.length * 8 : 0);
    if (fields.length) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(fields.length * 8, 2);
      fields.forEach((f, i) => extra.writeBigUInt64LE(f, 4 + i * 8));
    }
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x031e, 4); // made by: Unix, spec 3.0
    record.writeUInt16LE(zip64 ? 45 : 20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(method, 10);
    record.writeUInt16LE(time, 12);
    record.writeUInt16LE(date, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(zip64 ? MAX32 : compressedSize, 20);
    record.writeUInt32LE(zip64 ? MAX32 : size, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt16LE(extra.length, 30);
    record.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
    record.writeUInt32LE(offset >= limit ? MAX32 : offset, 42);
    central.push(record, name, extra);

    offset += local.length + name.length + localExtra.length + compressedSize;
    count++;
  }

  const cdStart = offset;
  let cdSize = 0;
  for (const part of central) {
    cdSize += part.length;
    yield part;
  }
  const needZip64 = count >= 0xffff || cdStart >= limit || cdSize >= limit;
  if (needZip64) {
    const eocd64 = Buffer.alloc(56);
    eocd64.writeUInt32LE(0x06064b50, 0);
    eocd64.writeBigUInt64LE(44n, 4);
    eocd64.writeUInt16LE(45, 12);
    eocd64.writeUInt16LE(45, 14);
    eocd64.writeBigUInt64LE(BigInt(count), 24);
    eocd64.writeBigUInt64LE(BigInt(count), 32);
    eocd64.writeBigUInt64LE(BigInt(cdSize), 40);
    eocd64.writeBigUInt64LE(BigInt(cdStart), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(cdStart + cdSize), 8);
    locator.writeUInt32LE(1, 16);
    yield eocd64;
    yield locator;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(needZip64 ? 0xffff : count, 8);
  eocd.writeUInt16LE(needZip64 ? 0xffff : count, 10);
  eocd.writeUInt32LE(needZip64 ? MAX32 : cdSize, 12);
  eocd.writeUInt32LE(needZip64 ? MAX32 : cdStart, 16);
  yield eocd;
}

// ------------------------------------------------------------------ reading

export class ZipError extends Error {}

export interface ZipEntry {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  encrypted: boolean;
}

const MAX_ENTRIES = 200_000;

async function readAt(fd: fs.promises.FileHandle, position: number, length: number) {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fd.read(buf, 0, length, position);
  return buf.subarray(0, bytesRead);
}

/** Reads the central directory of a ZIP file on disk. */
export async function openZip(path: string) {
  const fd = await fs.promises.open(path, "r");
  try {
    const { size: fileSize } = await fd.stat();
    const tailLen = Math.min(fileSize, 22 + 0xffff);
    const tail = await readAt(fd, fileSize - tailLen, tailLen);
    let at = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50) {
        at = i;
        break;
      }
    }
    if (at < 0) throw new ZipError("Not a ZIP file");
    let count = tail.readUInt16LE(at + 10);
    let cdSize = tail.readUInt32LE(at + 12);
    let cdStart = tail.readUInt32LE(at + 16);
    const eocdPos = fileSize - tailLen + at;
    if (count === 0xffff || cdSize === MAX32 || cdStart === MAX32) {
      const locator = await readAt(fd, eocdPos - 20, 20);
      if (locator.readUInt32LE(0) !== 0x07064b50) throw new ZipError("Broken ZIP64 archive");
      const rec = await readAt(fd, Number(locator.readBigUInt64LE(8)), 56);
      if (rec.readUInt32LE(0) !== 0x06064b50) throw new ZipError("Broken ZIP64 archive");
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdStart = Number(rec.readBigUInt64LE(48));
    }
    if (count > MAX_ENTRIES) throw new ZipError("The archive has too many files");
    if (cdStart + cdSize > fileSize) throw new ZipError("The archive is truncated");
    const cd = await readAt(fd, cdStart, cdSize);
    const entries = new Map<string, ZipEntry>();
    let p = 0;
    for (let i = 0; i < count; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new ZipError("Broken central directory");
      const flags = cd.readUInt16LE(p + 8);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const entry: ZipEntry = {
        method: cd.readUInt16LE(p + 10),
        crc: cd.readUInt32LE(p + 16),
        compressedSize: cd.readUInt32LE(p + 20),
        size: cd.readUInt32LE(p + 24),
        localOffset: cd.readUInt32LE(p + 42),
        name: cd.toString(flags & 0x0800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen),
        encrypted: Boolean(flags & 1),
      };
      // ZIP64 extra field: only the values that were 0xFFFFFFFF, in this order.
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = cd.readUInt16LE(e);
        const len = cd.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let q = e + 4;
          if (entry.size === MAX32) (entry.size = Number(cd.readBigUInt64LE(q)), (q += 8));
          if (entry.compressedSize === MAX32) (entry.compressedSize = Number(cd.readBigUInt64LE(q)), (q += 8));
          if (entry.localOffset === MAX32) entry.localOffset = Number(cd.readBigUInt64LE(q));
        }
        e += 4 + len;
      }
      entries.set(entry.name, entry);
      p = end + commentLen;
    }
    return { path, entries };
  } finally {
    await fd.close();
  }
}

export type OpenZip = Awaited<ReturnType<typeof openZip>>;

/** Streams one entry to `dest`, refusing anything bigger than `maxBytes`. */
export async function extractEntry(zip: OpenZip, entry: ZipEntry, dest: string, maxBytes: number) {
  if (entry.encrypted) throw new ZipError(`${entry.name} is encrypted`);
  if (entry.method !== 0 && entry.method !== 8) throw new ZipError(`${entry.name} uses an unsupported compression method`);
  if (entry.size > maxBytes) throw new ZipError(`${entry.name} is too large`);
  const fd = await fs.promises.open(zip.path, "r");
  let dataStart: number;
  try {
    const header = await readAt(fd, entry.localOffset, 30);
    if (header.readUInt32LE(0) !== 0x04034b50) throw new ZipError(`Broken entry ${entry.name}`);
    dataStart = entry.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  } finally {
    await fd.close();
  }
  let written = 0;
  let crc = 0;
  // Counts real output, so a lying header can't sneak a zip bomb past the limit.
  const guard = new Transform({
    transform(chunk: Buffer, _enc, done) {
      written += chunk.length;
      if (written > maxBytes) return done(new ZipError(`${entry.name} is too large`));
      crc = zlib.crc32(chunk, crc);
      done(null, chunk);
    },
  });
  const source =
    entry.compressedSize === 0
      ? Readable.from([])
      : fs.createReadStream(zip.path, { start: dataStart, end: dataStart + entry.compressedSize - 1 });
  if (entry.method === 8) await pipeline(source, zlib.createInflateRaw(), guard, fs.createWriteStream(dest));
  else await pipeline(source, guard, fs.createWriteStream(dest));
  if (written !== entry.size || (crc >>> 0) !== entry.crc) throw new ZipError(`${entry.name} is corrupt`);
}

/** Reads a (small) text entry. */
export async function readEntryText(zip: OpenZip, entry: ZipEntry, maxBytes: number, tmp: string) {
  await extractEntry(zip, entry, tmp, maxBytes);
  try {
    return await fs.promises.readFile(tmp, "utf8");
  } finally {
    await fs.promises.rm(tmp, { force: true });
  }
}
