import { describe, it, expect } from "vitest";
import {
  assertCanStart,
  assertCanEnd,
  assertCanCancel,
  unreviewedCount,
} from "@/lib/mtg/meetingLifecycle";
import { canApproveMinutes, confirmRequires, parseTopicsFromMarkdown } from "@/lib/mtg/minutesReview";
import type { MtgAgreementRow } from "@/lib/mtg/db";

describe("meetingLifecycle transitions", () => {
  it("start solo desde planned", () => {
    expect(() => assertCanStart("planned")).not.toThrow();
    expect(() => assertCanStart("in_progress")).toThrow();
  });
  it("end desde in_progress o planned", () => {
    expect(() => assertCanEnd("in_progress")).not.toThrow();
    expect(() => assertCanEnd("planned")).not.toThrow();
    expect(() => assertCanEnd("closed")).toThrow();
  });
  it("cancel desde planned o in_progress", () => {
    expect(() => assertCanCancel("planned")).not.toThrow();
    expect(() => assertCanCancel("closed")).toThrow();
  });
  it("unreviewedCount", () => {
    expect(unreviewedCount([{ reviewed: true }, { reviewed: false }])).toBe(1);
  });
});

describe("B4 transitions (aprobar / confirmar / cerrar→temas)", () => {
  const agr = (p: Partial<MtgAgreementRow>): MtgAgreementRow =>
    ({
      id: "a",
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
      ...p,
    }) as MtgAgreementRow;

  it("no aprobar con proposed", () => {
    expect(canApproveMinutes([agr({ status: "proposed" })]).ok).toBe(false);
  });

  it("confirmar crea tarea sólo con proyecto (y fecha+responsable)", () => {
    expect(confirmRequires({ projectId: null, dueDate: "2026-09-20", ownerUserId: "u" }).ok).toBe(
      false,
    );
    expect(confirmRequires({ projectId: "p", dueDate: "2026-09-20", ownerUserId: "u" }).ok).toBe(
      true,
    );
  });

  it("cerrar propaga temas desde markdown", () => {
    const md = "## Temas para la próxima\n- Tema A\n- Tema B\n";
    expect(parseTopicsFromMarkdown(md)).toEqual(["Tema A", "Tema B"]);
  });
});
