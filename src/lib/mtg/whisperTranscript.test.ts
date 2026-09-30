import { describe, expect, it } from "vitest";
import {
  formatVttTimestamp,
  isSpanishLanguageCode,
  segmentsToVtt,
} from "./whisperTranscript";

describe("whisperTranscript", () => {
  it("formatea timestamps VTT", () => {
    expect(formatVttTimestamp(0)).toBe("00:00:00.000");
    expect(formatVttTimestamp(65.5)).toBe("00:01:05.500");
  });

  it("arma VTT con cues", () => {
    const vtt = segmentsToVtt([
      { start: 0, end: 2.5, text: " Hola " },
      { start: 2.5, end: 5, text: "Hello" },
    ]);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:02.500");
    expect(vtt).toContain("Hola");
    expect(vtt).toContain("Hello");
  });

  it("detecta códigos de español", () => {
    expect(isSpanishLanguageCode("es")).toBe(true);
    expect(isSpanishLanguageCode("ES")).toBe(true);
    expect(isSpanishLanguageCode("en")).toBe(false);
    expect(isSpanishLanguageCode("zh")).toBe(false);
  });
});
