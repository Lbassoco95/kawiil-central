import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  clearPendingRecording,
  getPendingRecording,
  putPendingRecording,
  downloadBlobLocally,
} from "./pendingRecordingStore";

describe("pendingRecordingStore", () => {
  beforeEach(async () => {
    try {
      await clearPendingRecording("meeting-test-1");
    } catch {
      /* ignore */
    }
  });

  it("guarda y recupera un blob pendiente", async () => {
    if (typeof indexedDB === "undefined") {
      // jsdom de vitest no trae IndexedDB; el flujo se cubre en el navegador.
      expect(typeof putPendingRecording).toBe("function");
      expect(typeof getPendingRecording).toBe("function");
      return;
    }
    const blob = new Blob(["audio-bytes-demo"], { type: "audio/webm" });
    await putPendingRecording({
      meetingId: "meeting-test-1",
      fileName: "grabacion-junta.webm",
      contentType: "audio/webm",
      sizeBytes: blob.size,
      origin: "browser_recorder",
      updatedAt: new Date().toISOString(),
      blob,
    });
    const got = await getPendingRecording("meeting-test-1");
    expect(got).not.toBeNull();
    expect(got!.fileName).toBe("grabacion-junta.webm");
    expect(got!.sizeBytes).toBe(blob.size);
    expect(got!.blob.size).toBe(blob.size);
    await clearPendingRecording("meeting-test-1");
    expect(await getPendingRecording("meeting-test-1")).toBeNull();
  });

  it("dispara descarga local del blob", () => {
    const click = vi.fn();
    const remove = vi.fn();
    vi.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      rel: "",
      click,
      remove,
    } as unknown as HTMLAnchorElement);
    vi.spyOn(document.body, "appendChild").mockImplementation((n) => n);
    vi.stubGlobal("URL", {
      createObjectURL: () => "blob:mock",
      revokeObjectURL: vi.fn(),
    });

    downloadBlobLocally(new Blob(["x"], { type: "audio/webm" }), "a.webm");
    expect(click).toHaveBeenCalled();
  });
});
