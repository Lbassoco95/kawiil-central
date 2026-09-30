import { describe, it, expect } from "vitest";
import {
  detectTranscriptKind,
  parseVttToPlainText,
  normalizeDocxTranscriptText,
  canManualUploadTranscript,
} from "@/lib/mtg/transcriptParse";
import { buildDraftWithoutModel } from "@/lib/mtg/draftWithoutModel";

describe("transcriptParse", () => {
  it("detecta extensión", () => {
    expect(detectTranscriptKind("a.VTT")).toBe("vtt");
    expect(detectTranscriptKind("a.txt")).toBe("txt");
    expect(detectTranscriptKind("Teams.docx")).toBe("docx");
    expect(detectTranscriptKind("x.pdf")).toBeNull();
  });

  it("parsea VTT a texto con timestamps", () => {
    const vtt = `WEBVTT

1
00:12:04.000 --> 00:12:10.000
Acordamos enviar el borrador.

2
00:18:40.500 --> 00:18:48.000
El cliente confirma.
`;
    const text = parseVttToPlainText(vtt);
    expect(text).toContain("[00:12:04] Acordamos enviar el borrador.");
    expect(text).toContain("[00:18:40] El cliente confirma.");
    expect(text).not.toContain("WEBVTT");
  });

  it("normaliza DOCX/Teams con timestamps sueltos", () => {
    const raw = `00:01:02
Hola equipo
0:12:04 — Revisamos el entregable
sin marca al final`;
    const text = normalizeDocxTranscriptText(raw);
    expect(text).toContain("[00:01:02] Hola equipo");
    expect(text).toContain("[00:12:04] Revisamos el entregable");
    expect(text).toContain("sin marca al final");
  });

  it("canManualUploadTranscript", () => {
    expect(canManualUploadTranscript("planned")).toBe(true);
    expect(canManualUploadTranscript("closed")).toBe(false);
  });
});

describe("draftWithoutModel", () => {
  it("arma borrador solo con capturado en vivo", () => {
    const md = buildDraftWithoutModel({
      title: "Seguimiento",
      scheduledAt: "2026-09-17T16:00:00Z",
      liveAgreements: [{ text: "Hacer X", status: "confirmed" }],
      decided: [{ text: "Seguir", resolution: "sí" }],
      topicLines: ["Tema A [advanced]"],
      expectedNext: ["Revisar evidencias"],
    });
    expect(md).toContain("# Minuta — Seguimiento");
    expect(md).toContain("Hacer X");
    expect(md).toContain("Temas revisados");
    expect(md).toContain("Revisar evidencias");
    expect(md).toContain("sin modelo");
    expect(md).not.toContain("Acuerdos propuestos (pendientes");
  });
});
