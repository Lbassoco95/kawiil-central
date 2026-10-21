/**
 * Compromisos del resumen (sección «Compromisos y fechas») → acuerdos propuestos,
 * que luego se confirman con proyecto/fecha/responsable para crear la tarea.
 */

import { mtgDb, type MtgAgreementRow } from "@/lib/mtg/db";

const HEADING = /^##\s*(compromisos|commitments|承诺)/i;

export type ParsedCommitment = {
  text: string;
  owner: string | null;
  /** YYYY-MM-DD solo si la fecha del resumen es una fecha ISO. */
  dueDate: string | null;
  /** Fecha tal como la dijo el resumen (puede ser relativa: «el viernes»). */
  dueHint: string | null;
  ref: string | null;
};

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

const fold = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Plazo dicho en la junta («el viernes», «mañana», «en 3 días», «15 de noviembre»…)
 * → YYYY-MM-DD, tomando como referencia la fecha de la junta. null si no se entiende.
 * Los días de la semana apuntan a la próxima ocurrencia posterior a la junta.
 */
export function resolveRelativeDate(hint: string | null | undefined, refYmd: string): string | null {
  const h = fold(hint ?? "");
  const m0 = refYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!h || !m0) return null;
  const ref = new Date(Number(m0[1]), Number(m0[2]) - 1, Number(m0[3]));
  const plus = (days: number) => {
    const d = new Date(ref);
    d.setDate(d.getDate() + days);
    return ymd(d);
  };

  if (/^(hoy|el mismo dia)\b/.test(h)) return plus(0);
  if (/^pasado manana\b/.test(h)) return plus(2);
  if (/^manana\b/.test(h)) return plus(1);
  const inDays = h.match(/^en (\d{1,2}) dias?\b/);
  if (inDays) return plus(Number(inDays[1]));
  if (/^en (una|1) semana\b/.test(h) || /^(la )?proxima semana\b|^la semana que viene\b/.test(h)) return plus(7);
  if (/^(a )?(fin|finales) de mes\b|^(el )?ultimo dia del mes\b/.test(h)) {
    return ymd(new Date(ref.getFullYear(), ref.getMonth() + 1, 0));
  }

  const dayMonth = h.match(/^(?:el )?(\d{1,2}) de (\w+)(?: de (\d{4}))?/);
  if (dayMonth) {
    const mi = MONTHS.indexOf(dayMonth[2]);
    if (mi >= 0) {
      let year = dayMonth[3] ? Number(dayMonth[3]) : ref.getFullYear();
      let d = new Date(year, mi, Number(dayMonth[1]));
      if (!dayMonth[3] && d < ref) d = new Date(++year, mi, Number(dayMonth[1]));
      return d.getMonth() === mi ? ymd(d) : null;
    }
  }

  const wd = h.match(/^(?:para |antes d(?:el|e) |este |el |proximo |el proximo )*(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/);
  if (wd) {
    const target = WEEKDAYS.indexOf(wd[1]);
    let delta = (target - ref.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    return plus(delta);
  }
  return null;
}

export function parseCommitments(md: string | null | undefined, refYmd?: string | null): ParsedCommitment[] {
  if (!md) return [];
  const lines = md.split("\n");
  const start = lines.findIndex((l) => HEADING.test(l.trim()));
  if (start < 0) return [];
  const out: ParsedCommitment[] = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (line.startsWith("## ")) break;
    if (!line.startsWith("-")) continue;
    let body = line.replace(/^-+\s*/, "").trim();
    if (!body || /^\((ninguno|none)\)|^（无）/i.test(body)) continue;

    let owner: string | null = null;
    let dueHint: string | null = null;
    let ref: string | null = null;
    // Metadatos al final: _(Responsable: X · Fecha: Y · ref. 00:12:00)_
    const meta = body.match(/\s*_\(([^)]*)\)_\s*$/);
    if (meta) {
      body = body.slice(0, meta.index).trim();
      for (const part of meta[1].split("·")) {
        const p = part.trim();
        const m = p.match(/^(responsable|owner|负责人)\s*:\s*(.+)$/i);
        const d = p.match(/^(fecha|date|日期)\s*:\s*(.+)$/i);
        const r = p.match(/^(ref\.?|参考)\s*(.+)$/i);
        if (m) owner = m[2].trim();
        else if (d) dueHint = d[2].trim();
        else if (r) ref = r[2].trim();
      }
    }
    if (!body) continue;
    const iso = dueHint?.match(/^\d{4}-\d{2}-\d{2}$/) ? dueHint : null;
    // Plazo relativo («el viernes») → fecha real contra la fecha de la junta; se conserva lo dicho.
    const resolved = !iso && refYmd ? resolveRelativeDate(dueHint, refYmd) : null;
    out.push({ text: body, owner, dueDate: iso ?? resolved, dueHint: iso ? null : dueHint, ref });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export type NewAgreementInput = {
  organizationId: string;
  actorUserId: string;
  meetingId: string;
  clientId: string | null;
  entityKey?: string | null;
  items: Pick<ParsedCommitment, "text" | "owner" | "dueDate" | "dueHint" | "ref">[];
  origin: "proposed_by_model" | "added_in_review";
  existing: Pick<MtgAgreementRow, "text">[];
};

/** Inserta acuerdos propuestos (sin duplicar los que ya existen). Devuelve cuántos creó. */
export async function addProposedAgreements(input: NewAgreementInput): Promise<number> {
  const seen = new Set(input.existing.map((a) => norm(a.text)));
  const rows = input.items
    .filter((i) => i.text.trim() && !seen.has(norm(i.text)) && seen.add(norm(i.text)))
    .map((i) => ({
      organization_id: input.organizationId,
      meeting_id: input.meetingId,
      client_id: input.clientId,
      entity_key: input.entityKey ?? null,
      text: i.text.trim(),
      owner_name: i.owner,
      due_date: i.dueDate,
      origin: input.origin,
      status: "proposed" as const,
      transcript_ref: i.ref,
      project_reason: i.dueHint ? `Plazo dicho en la junta: ${i.dueHint}` : null,
      created_by: input.actorUserId,
    }));
  if (rows.length === 0) return 0;
  const { error } = await mtgDb.from("mtg_agreements").insert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}

/** Persona del equipo que corresponde al nombre dicho en la junta (coincidencia por nombre completo o por nombre de pila). */
export function matchProfileByName<T extends { full_name: string | null }>(
  profiles: T[],
  name: string | null | undefined,
): T | undefined {
  // Sin acentos ni mayúsculas: «Hernández» = «hernandez», «Lupita» = «lupita».
  const n = fold(name ?? "");
  if (n.length < 3) return undefined;
  const exact = profiles.find((p) => fold(p.full_name ?? "") === n);
  if (exact) return exact;
  const loose = profiles.filter((p) => {
    const f = fold(p.full_name ?? "");
    return f.length >= 3 && (f.includes(n) || n.includes(f) || f.split(/\s+/)[0] === n.split(/\s+/)[0]);
  });
  return loose.length === 1 ? loose[0] : undefined;
}
