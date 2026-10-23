/**
 * File type detection from magic bytes. No Node APIs, so the collection page
 * can check a chosen file before uploading it; the server checks again and
 * never trusts the client.
 */

/** The real container type from the first 16 bytes, or null if unknown. */
export function sniffMime(head: Uint8Array): string | null {
  const b = head;
  const ascii = (start: number, len: number) =>
    String.fromCharCode(...b.subarray(start, start + len));
  if (b[0] === 0x89 && ascii(1, 3) === "PNG") return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
  if (ascii(0, 4) === "GIF8") return "image/gif";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
  if (ascii(4, 4) === "ftyp") {
    return ascii(8, 2) === "qt" ? "video/quicktime" : "video/mp4";
  }
  if (ascii(0, 4) === "OggS") return "video/ogg";
  return null;
}

/** Containers we accept for videos. */
export function isVideoMime(mime: string | null) {
  return mime === "video/webm" || mime === "video/mp4" || mime === "video/quicktime" || mime === "video/ogg";
}

export const UNSUPPORTED_VIDEO = "This file isn't a video we can use. Choose a WebM, MP4, MOV or Ogg video.";

/** The same words wherever a file is refused for its size: before upload, on start, or mid-upload. */
export function tooLarge(maxBytes: number) {
  return `The file is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`;
}
