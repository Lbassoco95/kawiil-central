import { describe, expect, it } from "vitest";
import {
  canUploadRecording,
  isAllowedRecordingFile,
} from "@/lib/mtg/uploadRecording";

describe("uploadRecording", () => {
  it("permite grabar en estados vivos y de minuta", () => {
    expect(canUploadRecording("planned")).toBe(true);
    expect(canUploadRecording("in_progress")).toBe(true);
    expect(canUploadRecording("ended")).toBe(true);
    expect(canUploadRecording("minutes_draft")).toBe(true);
    expect(canUploadRecording("closed")).toBe(false);
    expect(canUploadRecording("cancelled")).toBe(false);
  });

  it("acepta audio/video comunes", () => {
    expect(isAllowedRecordingFile(new File([""], "a.webm", { type: "audio/webm" }))).toBe(true);
    expect(isAllowedRecordingFile(new File([""], "a.mp3", { type: "audio/mpeg" }))).toBe(true);
    expect(isAllowedRecordingFile(new File([""], "a.mp4", { type: "video/mp4" }))).toBe(true);
    expect(isAllowedRecordingFile(new File([""], "a.pdf", { type: "application/pdf" }))).toBe(false);
  });
});
