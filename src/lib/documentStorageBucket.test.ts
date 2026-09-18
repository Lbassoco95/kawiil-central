import { describe, it, expect } from "vitest";
import { documentStorageBucket } from "@/lib/documentStorageBucket";

describe("documentStorageBucket", () => {
  it("usa documents por defecto", () => {
    expect(documentStorageBucket({ source: "supabase", metadata: {} })).toBe("documents");
  });

  it("lee metadata.bucket", () => {
    expect(
      documentStorageBucket({ source: "supabase", metadata: { bucket: "mtg" } })
    ).toBe("mtg");
  });

  it("dropbox no usa bucket supabase", () => {
    expect(documentStorageBucket({ source: "dropbox", metadata: { bucket: "mtg" } })).toBe(
      "documents"
    );
  });
});
