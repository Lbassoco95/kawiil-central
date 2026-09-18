import { describe, it, expect } from "vitest";
import {
  compactVisibleTopics,
  resolvedThisMeeting,
  topicsEligibleForNextAgenda,
  filterArchiveTopics,
  isMeetingLiveEditable,
  applySessionTopicPatch,
  sessionNotesIdempotent,
  concatSessionNotes,
} from "@/lib/mtg/boardArchive";

describe("boardArchive compact view", () => {
  const topics = [
    { id: "1", status: "open" as const, entity_key: "ent_a", title: "A", update: { movement: "advanced" as const } },
    { id: "2", status: "open" as const, entity_key: "ent_a", title: "B", update: { movement: "resolved" as const } },
    { id: "3", status: "open" as const, entity_key: "ent_b", title: "C", update: { movement: "new" as const } },
  ];

  it("vista compacta excluye resolved de la junta actual del cuerpo abierto", () => {
    expect(compactVisibleTopics(topics).map((t) => t.id)).toEqual(["1", "3"]);
  });

  it("sección resolvió sólo los resolved de esta junta", () => {
    expect(resolvedThisMeeting(topics).map((t) => t.id)).toEqual(["2"]);
  });

  it("temas resolved/dropped de juntas anteriores no van a la siguiente agenda", () => {
    expect(
      topicsEligibleForNextAgenda([
        { status: "open" as const },
        { status: "resolved" as const },
        { status: "dropped" as const },
      ]).map((t) => t.status),
    ).toEqual(["open"]);
  });
});

describe("archive filter", () => {
  const archive = [
    {
      id: "a",
      title: "Hallazgos entidad X",
      entity_key: "ent_x",
      status: "resolved" as const,
      resolved_in_meeting_id: "m1",
      legacy_key: "x-hallazgos",
      client_id: "c",
      closed_in_meeting_id: "m1",
    },
    {
      id: "b",
      title: "Otro",
      entity_key: "ent_y",
      status: "dropped" as const,
      resolved_in_meeting_id: null,
      legacy_key: null,
      client_id: "c",
      closed_in_meeting_id: "m0",
    },
  ];

  it("lista cerrados con filtro entidad y texto", () => {
    expect(filterArchiveTopics(archive, {}).map((t) => t.id)).toEqual(["a", "b"]);
    expect(filterArchiveTopics(archive, { entityKey: "ent_x" }).map((t) => t.id)).toEqual(["a"]);
    expect(filterArchiveTopics(archive, { query: "hallazgos" }).map((t) => t.id)).toEqual(["a"]);
  });
});

describe("read-only past meetings", () => {
  it("sólo planned/in_progress editables", () => {
    expect(isMeetingLiveEditable("planned")).toBe(true);
    expect(isMeetingLiveEditable("in_progress")).toBe(true);
    expect(isMeetingLiveEditable("closed")).toBe(false);
    expect(isMeetingLiveEditable("ended")).toBe(false);
  });
});

describe("session import idempotent notes", () => {
  it("concatena notas distintas", () => {
    expect(concatSessionNotes("A", "B")).toBe("A\nB");
  });
  it("segunda pasada no duplica", () => {
    const once = applySessionTopicPatch({
      current: { movement: "unchanged", session_notes: null, reviewed: false },
      incoming: { movement: "advanced", session_notes: "Actualizar", reviewed: true },
    });
    expect(once.movement).toBe("advanced");
    expect(once.session_notes).toBe("Actualizar");
    expect(sessionNotesIdempotent(once.session_notes, "Actualizar")).toBe("Actualizar");
  });
});
