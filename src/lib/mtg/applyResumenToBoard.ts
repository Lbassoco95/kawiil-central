/**
 * Aplica un resumen de sesión (texto/DOCX) al tablero de una junta:
 * empareja líneas con temas por título/legacy y actualiza avance + notas.
 */

import { mtgDb, type MtgTopicRow, type MtgTopicUpdateRow } from "@/lib/mtg/db";
import type { MtgMovement } from "@/lib/mtg/constants";
import { logMtgAudit, MTG_AUDIT_ACTION } from "@/lib/mtg/audit";

const MOVEMENT_HINTS: { re: RegExp; movement: MtgMovement }[] = [
  { re: /\b(cerrad[oa]|enviad[oa]|presentad[oa]|confirmad[oa]|listo)\b/i, movement: "resolved" },
  { re: /\b(en curso|sigue|avanz|parcial)\b/i, movement: "advanced" },
  { re: /\b(esperar|cnbv|autoridad|amparo|tribunal)\b/i, movement: "waiting_authority" },
  { re: /\b(l&ca|tercero|bloquead|sin respuesta|certificados)\b/i, movement: "blocked_third_party" },
  { re: /\b(acordar|decidir|propuesta|visto bueno|definir)\b/i, movement: "decision_needed" },
  { re: /\b(nuevo|nueva|meta|plan de)\b/i, movement: "new" },
];

function guessMovement(text: string): MtgMovement {
  for (const h of MOVEMENT_HINTS) {
    if (h.re.test(text)) return h.movement;
  }
  return "advanced";
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreMatch(topicTitle: string, line: string): number {
  const t = normalize(topicTitle);
  const l = normalize(line);
  if (!t || !l) return 0;
  if (l.includes(t) || t.includes(l)) return 100;
  const tw = new Set(t.split(" ").filter((w) => w.length > 3));
  if (tw.size === 0) return 0;
  let hit = 0;
  for (const w of tw) if (l.includes(w)) hit++;
  return Math.round((hit / tw.size) * 80);
}

export type ResumenApplyResult = {
  matched: number;
  patched: string[];
  unmatchedLines: string[];
};

/**
 * Parte el texto del resumen en bloques útiles (líneas no vacías con sustancia).
 */
export function extractResumenLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 12)
    .filter((l) => !/^(resumen junta|oct |lo que se|en curso|por confirmar|asunto|entidad|resultado|estado|sigue|para acordar|próxima sesión)/i.test(l));
}

export async function applyResumenTextToBoard(opts: {
  organizationId: string;
  actorUserId: string;
  meetingId: string;
  seriesId: string;
  rawText: string;
}): Promise<ResumenApplyResult> {
  const lines = extractResumenLines(opts.rawText);
  const { data: topics, error: tErr } = await mtgDb
    .from("mtg_topics")
    .select("*")
    .eq("series_id", opts.seriesId)
    .eq("status", "open");
  if (tErr) throw tErr;
  const topicList = (topics ?? []) as MtgTopicRow[];

  const { data: updates, error: uErr } = await mtgDb
    .from("mtg_topic_updates")
    .select("*")
    .eq("meeting_id", opts.meetingId);
  if (uErr) throw uErr;
  const updateByTopic = new Map(
    ((updates ?? []) as MtgTopicUpdateRow[]).map((u) => [u.topic_id, u]),
  );

  const patched: string[] = [];
  const usedLines = new Set<number>();

  for (const topic of topicList) {
    let best = { idx: -1, score: 0, line: "" };
    lines.forEach((line, idx) => {
      if (usedLines.has(idx)) return;
      const score = scoreMatch(topic.title, line);
      if (score > best.score) best = { idx, score, line };
    });
    if (best.score < 45 || best.idx < 0) continue;
    usedLines.add(best.idx);
    const movement = guessMovement(best.line);
    const existing = updateByTopic.get(topic.id);
    const notes = `[Resumen] ${best.line}`.slice(0, 2000);
    if (existing) {
      const { error } = await mtgDb
        .from("mtg_topic_updates")
        .update({
          movement,
          progress_since_last: best.line.slice(0, 500),
          session_notes: existing.session_notes?.includes(best.line)
            ? existing.session_notes
            : [existing.session_notes, notes].filter(Boolean).join("\n"),
          reviewed: true,
          origin: "edited_live",
        })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await mtgDb.from("mtg_topic_updates").insert({
        organization_id: opts.organizationId,
        topic_id: topic.id,
        meeting_id: opts.meetingId,
        movement,
        progress_since_last: best.line.slice(0, 500),
        session_notes: notes,
        origin: "edited_live",
        reviewed: true,
      });
      if (error) throw error;
    }
    patched.push(topic.title);
  }

  await logMtgAudit({
    organizationId: opts.organizationId,
    actorUserId: opts.actorUserId,
    entityType: "meeting",
    entityId: opts.meetingId,
    action: MTG_AUDIT_ACTION.SESSION_NOTES_IMPORTED,
    details: {
      matched: patched.length,
      lines: lines.length,
      patched_titles: patched.slice(0, 40),
    },
  });

  return {
    matched: patched.length,
    patched,
    unmatchedLines: lines.filter((_, i) => !usedLines.has(i)).slice(0, 30),
  };
}
