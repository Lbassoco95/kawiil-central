import { describe, expect, it } from "vitest";
import {
  MTG_MAX_RECORDING_BYTES,
  MTG_MAX_RECORDING_HOURS,
  MTG_WHISPER_CHUNK_BYTES,
  splitBytesForWhisper,
} from "./recordingLimits";

describe("recordingLimits", () => {
  it("cubre ~3 horas de audio con margen de Storage", () => {
    expect(MTG_MAX_RECORDING_HOURS).toBe(3);
    // 3 h * 128 kbps ≈ 172 MB < 200 MB
    const threeHoursAt128k = Math.ceil((3 * 3600 * 128_000) / 8);
    expect(threeHoursAt128k).toBeLessThan(MTG_MAX_RECORDING_BYTES);
  });

  it("no parte archivos pequeños", () => {
    const bytes = new Uint8Array(1024).fill(1);
    expect(splitBytesForWhisper(bytes)).toHaveLength(1);
  });

  it("parte archivos grandes bajo el techo Whisper", () => {
    const size = MTG_WHISPER_CHUNK_BYTES * 3 + 1000;
    const bytes = new Uint8Array(size);
    bytes[0] = 0x1a; // marca de cabecera ficticia
    bytes[100] = 0x99;
    const parts = splitBytesForWhisper(bytes);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    for (const p of parts) {
      expect(p.byteLength).toBeLessThanOrEqual(MTG_WHISPER_CHUNK_BYTES);
    }
    // trozos siguientes reutilizan cabecera
    expect(parts[1][0]).toBe(0x1a);
  });
});
