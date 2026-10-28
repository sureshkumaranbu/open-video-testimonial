#!/usr/bin/env node
// Test stand-in for tesseract's CLI: `fake-tesseract.mjs <image>` (like `tesseract <image> stdout`).
// Checks it was given a PNG, JPEG or WebP file and prints the text of a review
// screenshot, with the stars, the button and the date a real one would have. No model involved.
import fs from "node:fs";

const [input] = process.argv.slice(2);
const head = fs.readFileSync(input).subarray(0, 12);
const png = head[0] === 0x89 && head.toString("ascii", 1, 4) === "PNG";
const jpeg = head[0] === 0xff && head[1] === 0xd8;
const webp = head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP";
if (!png && !jpeg && !webp) {
  console.error("not an image");
  process.exit(1);
}
process.stdout.write(
  [
    "Jamie Rivera",
    "★★★★★",
    "Posted on May 3, 2026",
    "Collecting reviews used to take us a week of emails.",
    "Now our customers reply in minutes and we share the best ones the same day.",
    "Helpful",
    "Reply",
    "",
  ].join("\n"),
);
