import { describe, expect, it } from "vitest";
import { CaptionsError, normaliseCaptions, parseVtt, vttToText } from "@/lib/captions";
import { splitCommand } from "@/lib/transcribe";

const VTT = `WEBVTT

NOTE made by hand

00:00:00.000 --> 00:00:02.500
<v Ada>Hello there,</v>

00:00:02.500 --> 00:01:04.000
we saved <b>hours</b> every week .
`;

describe("captions", () => {
  it("parses cues and turns them into plain text", () => {
    expect(parseVtt(VTT)).toEqual([
      { start: 0, end: 2.5, text: "<v Ada>Hello there,</v>" },
      { start: 2.5, end: 64, text: "we saved <b>hours</b> every week ." },
    ]);
    expect(vttToText(VTT)).toBe("Hello there, we saved hours every week.");
  });

  it("converts SRT to WebVTT", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nFirst line\n\n2\n00:00:02,000 --> 00:00:03,250\nSecond\n";
    expect(normaliseCaptions(srt)).toBe(
      "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFirst line\n\n00:00:02.000 --> 00:00:03.250\nSecond\n",
    );
  });

  it("drops notes and styles, keeping only cues", () => {
    expect(normaliseCaptions(VTT)).not.toContain("NOTE");
    expect(normaliseCaptions(VTT).startsWith("WEBVTT\n\n00:00:00.000 --> 00:00:02.500\n")).toBe(true);
  });

  it("rejects things that aren't captions", () => {
    expect(() => normaliseCaptions("just some words")).toThrow(CaptionsError);
    expect(() => normaliseCaptions("WEBVTT\n\nno cues here")).toThrow(/No caption cues/);
    expect(() => normaliseCaptions("WEBVTT\n\n00:00:05.000 --> 00:00:01.000\nbackwards")).toThrow(/ends before/);
    expect(() => normaliseCaptions(`WEBVTT\n\n${"x".repeat(200_001)}`)).toThrow(/too long/);
  });

  it("splits a transcription command without a shell", () => {
    expect(splitCommand(`whisper-cli -m "/models/my model.bin" -f {input} -ovtt -of '{output}'`)).toEqual([
      "whisper-cli", "-m", "/models/my model.bin", "-f", "{input}", "-ovtt", "-of", "{output}",
    ]);
    // Shell syntax is passed through as plain arguments, never interpreted.
    expect(splitCommand("echo {input}; rm -rf /")).toEqual(["echo", "{input};", "rm", "-rf", "/"]);
  });
});
