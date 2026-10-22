#!/usr/bin/env node
// Test stand-in for whisper.cpp's CLI: `fake-whisper.mjs <input.wav> <output-base>`.
// Checks it was given a 16 kHz mono WAV and writes <output-base>.vtt, like
// `whisper-cli -f <input> -ovtt -of <output-base>` does. No model involved.
import fs from "node:fs";

const [input, outBase] = process.argv.slice(2);
const wav = fs.readFileSync(input);
if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
  console.error("not a WAV file");
  process.exit(1);
}
const channels = wav.readUInt16LE(22);
const rate = wav.readUInt32LE(24);
if (channels !== 1 || rate !== 16000) {
  console.error(`expected 16 kHz mono, got ${rate} Hz x${channels}`);
  process.exit(1);
}
fs.writeFileSync(
  `${outBase}.vtt`,
  "WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nThis is a stand-in transcript.\n\n" +
    "00:00:01.500 --> 00:00:03.000\nIt proves the audio reached the transcriber.\n",
);
