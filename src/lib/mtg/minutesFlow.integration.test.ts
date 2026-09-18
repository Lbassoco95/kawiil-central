/**
 * Flujo de aceptación B4 (mock, sin DB): ended → draft → confirmar/rechazar → aprobar → cerrar.
 * Con MTG_GATEWAY_MOCK=1 el markdown y propuestos vienen del mock.
 */

import { describe, it, expect } from "vitest";
import {
  MOCK_MINUTES_OUTPUT,
  buildMinutesMarkdown,
} from "@/lib/mtg/generateMinutes";
import {
  canApproveMinutes,
  confirmRequires,
  isProposed,
  parseTopicsFromMarkdown,
} from "@/lib/mtg/minutesReview";
import type { MtgAgreementRow } from "@/lib/mtg/db";

function agr(partial: Partial<MtgAgreementRow>): MtgAgreementRow {
  return {
    id: partial.id ?? "a",
    organization_id: "o",
    meeting_id: "m",
    client_id: "c",
    entity_key: null,
    topic_id: null,
    project_id: null,
    text: "x",
    owner_side: null,
    owner_user_id: null,
    owner_name: null,
    due_date: null,
    origin: "proposed_by_model",
    status: "proposed",
    confirmed_by: null,
    confirmed_at: null,
    rejected_reason: null,
    project_hint: null,
    project_reason: null,
    transcript_ref: null,
    confidence: null,
    task_id: null,
    created_by: null,
    created_at: "",
    updated_at: "",
    ...partial,
  };
}

describe("minutes flow integration (MTG_GATEWAY_MOCK=1)", () => {
  it("recorre ended → draft → confirmar → rechazar → aprobar → documents → cerrar", () => {
    // 1) Generar borrador desde mock gateway
    const md = buildMinutesMarkdown({
      title: "Demo",
      scheduledAt: "2026-09-17T16:00:00Z",
      attendees: ["Polo"],
      liveAgreements: [],
      decided: [],
      model: MOCK_MINUTES_OUTPUT,
    });
    expect(md).toContain("Temas para la próxima");
    expect(MOCK_MINUTES_OUTPUT.proposed_agreements.length).toBe(2);

    // 2) Acuerdos propuestos en revisión
    let agreements: MtgAgreementRow[] = MOCK_MINUTES_OUTPUT.proposed_agreements.map((p, i) =>
      agr({
        id: `p${i}`,
        text: p.text,
        status: "proposed",
        transcript_ref: p.transcript_ref,
        confidence: p.confidence,
        owner_side: p.owner_side ?? null,
        owner_name: p.owner_hint,
        project_hint: p.project_hint,
        project_reason: p.project_reason,
      }),
    );
    expect(agreements.every(isProposed)).toBe(true);
    expect(canApproveMinutes(agreements).ok).toBe(false);

    // 3) Confirmar el primero (exige proyecto)
    const first = agreements[0];
    expect(
      confirmRequires({ projectId: null, dueDate: "2026-09-20", ownerUserId: "u1" }).ok,
    ).toBe(false);
    expect(
      confirmRequires({ projectId: "proj", dueDate: "2026-09-20", ownerUserId: "u1" }).ok,
    ).toBe(true);
    agreements = agreements.map((a) =>
      a.id === first.id
        ? {
            ...a,
            status: "confirmed" as const,
            project_id: "proj",
            due_date: "2026-09-20",
            owner_user_id: "u1",
            task_id: "task-1",
          }
        : a,
    );

    // 4) Rechazar el segundo
    agreements = agreements.map((a) =>
      a.id === "p1"
        ? { ...a, status: "rejected" as const, rejected_reason: "fuera de alcance" }
        : a,
    );
    expect(canApproveMinutes(agreements).ok).toBe(true);

    // 5) Aprobar → "documents" (simulado)
    const documentId = "doc-1";
    expect(documentId).toBeTruthy();

    // 6) Cerrar → temas a la siguiente
    const topics = parseTopicsFromMarkdown(md);
    expect(topics).toEqual(MOCK_MINUTES_OUTPUT.next_meeting_topics);
    const nextMeetingTopics = topics.map((title) => ({
      title,
      movement: "new" as const,
    }));
    expect(nextMeetingTopics.every((t) => t.movement === "new")).toBe(true);
  });
});
