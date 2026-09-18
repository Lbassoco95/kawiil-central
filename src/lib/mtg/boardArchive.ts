/**
 * Vista compacta, archivo y reabrir temas (B2 ajuste histórico).
 */

import type { MtgMeetingStatus, MtgMovement } from "@/lib/mtg/constants";
import type { MtgTopicRow, MtgTopicUpdateRow } from "@/lib/mtg/db";

export type BoardTopicLike = Pick<MtgTopicRow, "id" | "status" | "entity_key" | "title"> & {
  update: Pick<MtgTopicUpdateRow, "movement"> | null;
};

/** Temas visibles en la vista compacta del tablero (excluye resolved de esta junta del cuerpo abierto). */
export function compactVisibleTopics<T extends BoardTopicLike>(topics: T[]): T[] {
  return topics.filter((t) => {
    if (!t.update) return false;
    return t.update.movement !== "resolved";
  });
}

/** Resolved solo de esta junta (sección "Se resolvió desde la sesión pasada"). */
export function resolvedThisMeeting<T extends BoardTopicLike>(topics: T[]): T[] {
  return topics.filter((t) => t.update?.movement === "resolved");
}

/**
 * Temas de juntas anteriores con status resolved/dropped no deben entrar
 * al armado de la siguiente (prepareBoard ya filtra open; esto es la regla).
 */
export function topicsEligibleForNextAgenda<T extends Pick<MtgTopicRow, "status">>(
  topics: T[],
): T[] {
  return topics.filter((t) => t.status === "open");
}

export type ArchiveTopic = Pick<
  MtgTopicRow,
  "id" | "title" | "entity_key" | "status" | "resolved_in_meeting_id" | "legacy_key" | "client_id"
> & {
  closed_in_meeting_id: string | null;
  closed_at_label?: string | null;
};

export function filterArchiveTopics(
  topics: ArchiveTopic[],
  opts: { entityKey?: string | null; query?: string },
): ArchiveTopic[] {
  let list = topics.filter((t) => t.status === "resolved" || t.status === "dropped");
  if (opts.entityKey && opts.entityKey !== "all") {
    list = list.filter((t) => t.entity_key === opts.entityKey);
  }
  const q = opts.query?.trim().toLowerCase();
  if (q) {
    list = list.filter((t) => t.title.toLowerCase().includes(q));
  }
  return list;
}

/** Editable: planned / in_progress. Resto = lectura (salvo notas posteriores). */
export function isMeetingLiveEditable(status: MtgMeetingStatus | string): boolean {
  return status === "planned" || status === "in_progress";
}

export function canEditSessionNotesLater(status: MtgMeetingStatus | string): boolean {
  // Notas "posteriores" permitidas en juntas ya cerradas/terminadas.
  return !isMeetingLiveEditable(status);
}

export function concatSessionNotes(
  existing: string | null | undefined,
  incoming: string | null | undefined,
): string | null {
  const a = (existing ?? "").trim();
  const b = (incoming ?? "").trim();
  if (!b) return a || null;
  if (!a) return b;
  if (a.includes(b)) return a;
  return `${a}\n${b}`;
}

export function applySessionTopicPatch(opts: {
  current: { movement: MtgMovement; session_notes: string | null; reviewed: boolean };
  incoming: {
    movement?: MtgMovement | string | null;
    session_notes?: string | null;
    reviewed?: boolean;
  };
}): { movement: MtgMovement; session_notes: string | null; reviewed: boolean; origin: "edited_live" } {
  return {
    movement: (opts.incoming.movement as MtgMovement | undefined) ?? opts.current.movement,
    session_notes: concatSessionNotes(opts.current.session_notes, opts.incoming.session_notes),
    reviewed: opts.incoming.reviewed ?? opts.current.reviewed,
    origin: "edited_live",
  };
}

/** Segunda pasada del mismo payload no debe alargar notas si el texto ya está. */
export function sessionNotesIdempotent(
  afterFirst: string | null,
  incoming: string,
): string | null {
  return concatSessionNotes(afterFirst, incoming);
}
