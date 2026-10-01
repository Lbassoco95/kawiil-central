import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MtgPresentationTemplate } from "./MtgPresentationTemplate";
import type { BoardTopicRow } from "@/hooks/useMtgBoard";
import type { MtgMovement } from "@/lib/mtg/constants";
import type { MtgExpectedNextRow } from "@/lib/mtg/db";

function topic(opts: {
  id: string;
  title: string;
  movement: MtgMovement;
  entity_key: string;
}): BoardTopicRow {
  return {
    id: opts.id,
    organization_id: "org",
    series_id: "series",
    client_id: "c1",
    entity_key: opts.entity_key,
    default_project_id: null,
    title: opts.title,
    context: null,
    if_asked: null,
    source: null,
    owner_side: null,
    owner_user_id: null,
    owner_name: null,
    due_date: null,
    linked_task_id: null,
    status: "open",
    dropped_reason: null,
    created_in_meeting_id: null,
    resolved_in_meeting_id: null,
    legacy_key: null,
    sort_order: 0,
    created_by: null,
    created_at: "",
    updated_at: "",
    update: {
      id: `u-${opts.id}`,
      organization_id: "org",
      topic_id: opts.id,
      meeting_id: "m1",
      movement: opts.movement,
      progress_since_last: "Avance demo",
      next_step: "Siguiente paso",
      session_notes: null,
      origin: "edited_live",
      reviewed: false,
      reviewed_at: null,
      reviewed_by: null,
      created_at: "",
      updated_at: "",
    },
  };
}

describe("MtgPresentationTemplate", () => {
  it("muestra secciones de la plantilla DOCX", () => {
    render(
      <MtgPresentationTemplate
        title="Seguimiento quincenal"
        dateLabel="1 oct 2026"
        topics={[
          topic({ id: "t1", title: "Hallazgos cerrados", movement: "resolved", entity_key: "ent-a" }),
          topic({ id: "t2", title: "INE en curso", movement: "advanced", entity_key: "ent-b" }),
          topic({ id: "t3", title: "Meta alertas", movement: "new", entity_key: "ent-b" }),
        ]}
        entities={[
          { key: "ent-a", label: "Entidad A", client_id: "c1" },
          { key: "ent-b", label: "Entidad B", client_id: "c2" },
        ]}
        expectedNext={
          [
            {
              id: "e1",
              organization_id: "org",
              meeting_id: "m1",
              client_id: null,
              entity_key: null,
              topic_id: null,
              text: "Confirmar fecha límite",
              done: false,
              sort_order: 0,
              created_at: "",
              updated_at: "",
            },
          ] as MtgExpectedNextRow[]
        }
        decisions={[]}
        liveEditable
        onPatchUpdate={vi.fn()}
        onToggleExpected={vi.fn()}
      />,
    );

    expect(screen.getByText("Plantilla de presentación")).toBeInTheDocument();
    expect(screen.getByText("Lo que se cerró")).toBeInTheDocument();
    expect(screen.getByText("En curso")).toBeInTheDocument();
    expect(screen.getByText("Focos de hoy")).toBeInTheDocument();
    expect(screen.getByText("Para acordar hoy")).toBeInTheDocument();
    expect(screen.getByText("Hallazgos cerrados")).toBeInTheDocument();
    expect(screen.getByText("INE en curso")).toBeInTheDocument();
    expect(screen.getByText("Confirmar fecha límite")).toBeInTheDocument();
  });
});
