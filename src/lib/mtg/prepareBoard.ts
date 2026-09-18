/**
 * Armado idempotente del tablero de una junta (Bloque 2).
 * Pure helpers + orquestación; la I/O vive en prepareMeetingBoard().
 */

import type { MtgMovement, MtgMeetingStatus } from "@/lib/mtg/constants";
import { MOVEMENT_OPEN_ORDER } from "@/lib/mtg/constants";
import type {
  MtgTopicRow,
  MtgTopicUpdateRow,
  MtgAgreementRow,
  MtgDecisionRow,
  MtgExpectedNextRow,
  MtgEntity,
} from "@/lib/mtg/db";

const STICKY_MOVEMENTS: MtgMovement[] = ["waiting_authority", "blocked_third_party"];

export function inheritMovement(previous: MtgMovement | null | undefined): MtgMovement {
  if (previous && STICKY_MOVEMENTS.includes(previous)) return previous;
  return "unchanged";
}

export function sortOpenUpdatesByMovement<T extends { movement: MtgMovement }>(rows: T[]): T[] {
  const rank = new Map(MOVEMENT_OPEN_ORDER.map((m, i) => [m, i]));
  return [...rows].sort((a, b) => (rank.get(a.movement) ?? 99) - (rank.get(b.movement) ?? 99));
}

export type BoardTopicBucket =
  | "resolved"
  | "new"
  | "open"
  | "other";

export function bucketForMovement(movement: MtgMovement): BoardTopicBucket {
  if (movement === "resolved") return "resolved";
  if (movement === "new") return "new";
  if (MOVEMENT_OPEN_ORDER.includes(movement)) return "open";
  return "other";
}

export function countByMovement(
  updates: { movement: MtgMovement }[],
): Record<MtgMovement, number> {
  const out = {
    resolved: 0,
    advanced: 0,
    unchanged: 0,
    new: 0,
    decision_needed: 0,
    blocked_third_party: 0,
    waiting_authority: 0,
  } as Record<MtgMovement, number>;
  for (const u of updates) out[u.movement] = (out[u.movement] ?? 0) + 1;
  return out;
}

export function filterByEntityKey<T extends { entity_key?: string | null }>(
  rows: T[],
  entityKey: string | null,
): T[] {
  if (!entityKey || entityKey === "all") return rows;
  return rows.filter((r) => r.entity_key === entityKey);
}

export function canPrepareBoard(status: MtgMeetingStatus, existingUpdateCount: number): boolean {
  return status === "planned" && existingUpdateCount === 0;
}

export function shouldCreateTask(opts: {
  status: "proposed" | "confirmed" | "rejected";
  projectId: string | null | undefined;
}): boolean {
  return opts.status === "confirmed" && !!opts.projectId;
}

export type PreparedUpdateSeed = {
  topic_id: string;
  movement: MtgMovement;
  next_step: string | null;
  origin: "prepared";
};

/** Construye los inserts de topic_updates para temas open (sin tocar la DB). */
export function buildPreparedUpdates(opts: {
  openTopics: Pick<MtgTopicRow, "id">[];
  previousByTopicId: Map<string, Pick<MtgTopicUpdateRow, "movement" | "next_step">>;
}): PreparedUpdateSeed[] {
  return opts.openTopics.map((t) => {
    const prev = opts.previousByTopicId.get(t.id);
    return {
      topic_id: t.id,
      movement: inheritMovement(prev?.movement as MtgMovement | undefined),
      next_step: prev?.next_step ?? null,
      origin: "prepared" as const,
    };
  });
}

export function entitiesForFilter(
  seriesEntities: MtgEntity[] | null | undefined,
  clientId: string | null,
): MtgEntity[] {
  if (seriesEntities && seriesEntities.length > 0) return seriesEntities;
  if (clientId) return [{ key: "client", label: "Cliente", client_id: clientId }];
  return [];
}

export type CarryOverOpenAgreement = Pick<
  MtgAgreementRow,
  "id" | "text" | "client_id" | "entity_key" | "task_id" | "status" | "due_date" | "project_id"
> & { task_status?: string | null };

export function isOpenCarryAgreement(a: CarryOverOpenAgreement): boolean {
  if (a.status !== "confirmed") return false;
  if (!a.task_id) return true;
  const closed = a.task_status === "completada" || a.task_status === "cancelada";
  return !closed;
}

export function deferredDecisionsToShow(
  previous: Pick<MtgDecisionRow, "id" | "status" | "text" | "entity_key" | "topic_id">[],
): typeof previous {
  return previous.filter((d) => d.status === "deferred");
}

export function expectedNextFromPrevious(
  previous: Pick<MtgExpectedNextRow, "id" | "text" | "entity_key" | "topic_id" | "done">[],
): typeof previous {
  return previous;
}
