import { describe, it, expect } from "vitest";
import {
  canApproveMinutes,
  confirmRequires,
  isIncompleteConfirmed,
  parseTopicsFromMarkdown,
  remindKindsForMeeting,
} from "@/lib/mtg/minutesReview";
import type { MtgAgreementRow } from "@/lib/mtg/db";

function agr(partial: Partial<MtgAgreementRow>): MtgAgreementRow {
  return {
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
    ...partial,
  };
}

describe("minutesReview", () => {
  it("no aprueba con proposed", () => {
    expect(canApproveMinutes([agr({ status: "proposed" })]).ok).toBe(false);
  });
  it("no aprueba incompletos", () => {
    expect(
      canApproveMinutes([
        agr({ status: "confirmed", project_id: null, due_date: "2026-09-20", owner_user_id: "u" }),
      ]).ok,
    ).toBe(false);
  });
  it("aprueba cuando todo cerrado", () => {
    expect(
      canApproveMinutes([
        agr({
          status: "confirmed",
          project_id: "p",
          due_date: "2026-09-20",
          owner_user_id: "u",
        }),
      ]).ok,
    ).toBe(true);
  });
  it("confirmRequires", () => {
    expect(confirmRequires({ projectId: "p", dueDate: "d", ownerUserId: "u" }).ok).toBe(true);
    expect(confirmRequires({ projectId: null, dueDate: "d", ownerName: "x" }).ok).toBe(false);
  });
  it("isIncompleteConfirmed", () => {
    expect(isIncompleteConfirmed(agr({ status: "confirmed", project_id: "p" }))).toBe(true);
  });
  it("parseTopicsFromMarkdown", () => {
    const md = "# X\n\n## Temas para la próxima\n- Uno\n- Dos\n\n## Otro\n- No";
    expect(parseTopicsFromMarkdown(md)).toEqual(["Uno", "Dos"]);
  });
  it("remindKindsForMeeting", () => {
    const scheduled = new Date("2026-09-20T16:00:00Z");
    const now = new Date("2026-09-18T16:00:00Z");
    const kinds = remindKindsForMeeting(scheduled, now);
    expect(kinds.map((k) => k.remind_kind).sort()).toEqual(["t1d", "t1h"]);
  });
});
