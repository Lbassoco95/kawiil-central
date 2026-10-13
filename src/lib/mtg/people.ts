/**
 * Memoria de personas de las juntas: sugerencias desde el resumen, guardado por
 * empresa y vínculo con cada junta (con nota de lo que se trabajó).
 */

import { mtgDb, type MtgPersonRow } from "@/lib/mtg/db";

const PARTICIPANT_HEADING = /^##\s*(participantes|participants|参会人员)/i;

/** Nombres que el resumen identificó (sección «Participantes» de la minuta en Markdown). */
export function parseParticipantNames(md: string | null | undefined): string[] {
  if (!md) return [];
  const lines = md.split("\n");
  const start = lines.findIndex((l) => PARTICIPANT_HEADING.test(l.trim()));
  if (start < 0) return [];
  const names: string[] = [];
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (line.startsWith("## ") || line.startsWith("**")) break;
    if (!line.startsWith("-")) continue;
    const body = line.replace(/^-+\s*/, "").trim();
    if (!body || body.startsWith("_") || body === "—") continue;
    if (/estimad|estimated|估计/i.test(body) || /^\d/.test(body)) continue;
    for (const part of body.split(/,|;|、|\sy\s|\sand\s/)) {
      const n = part.replace(/\([^)]*\)/g, "").replace(/[_*]/g, "").trim();
      if (n.length >= 2 && n.length <= 60 && !/\d/.test(n)) names.push(n);
    }
  }
  return [...new Set(names)];
}

export function personMatches(p: Pick<MtgPersonRow, "name" | "aliases">, name: string): boolean {
  const n = name.trim().toLowerCase();
  return p.name.trim().toLowerCase() === n || (p.aliases ?? []).some((a) => a.trim().toLowerCase() === n);
}

export type SavePersonInput = {
  organizationId: string;
  actorUserId: string;
  meetingId: string;
  personId?: string | null;
  name: string;
  clientId: string | null;
  side: "client" | "kawiil" | "other";
  role: string;
  email: string;
  notes: string;
  meetingNote: string;
};

/** Crea o actualiza la persona en la memoria y la vincula a la junta. */
export async function savePersonToMemory(input: SavePersonInput): Promise<string> {
  const fields = {
    name: input.name.trim(),
    client_id: input.clientId,
    side: input.side,
    role: input.role.trim() || null,
    email: input.email.trim() || null,
    notes: input.notes.trim() || null,
    updated_at: new Date().toISOString(),
  };
  let personId = input.personId ?? null;

  if (personId) {
    const { error } = await mtgDb.from("mtg_people").update(fields).eq("id", personId);
    if (error) throw new Error(error.message);
  } else {
    const { data, error } = await mtgDb
      .from("mtg_people")
      .insert({ ...fields, organization_id: input.organizationId, created_by: input.actorUserId })
      .select("id")
      .single();
    if (error) {
      // Ya existía (mismo nombre y empresa): se reutiliza y se actualiza.
      if (error.code !== "23505") throw new Error(error.message);
      let q = mtgDb
        .from("mtg_people")
        .select("id")
        .eq("organization_id", input.organizationId)
        .ilike("name", fields.name);
      q = input.clientId ? q.eq("client_id", input.clientId) : q.is("client_id", null);
      const { data: ex } = await q.limit(1);
      personId = ex?.[0]?.id ?? null;
      if (!personId) throw new Error(error.message);
      const { error: uErr } = await mtgDb.from("mtg_people").update(fields).eq("id", personId);
      if (uErr) throw new Error(uErr.message);
    } else {
      personId = data!.id;
    }
  }

  const { error: lErr } = await mtgDb.from("mtg_meeting_people").upsert(
    {
      meeting_id: input.meetingId,
      person_id: personId!,
      organization_id: input.organizationId,
      note: input.meetingNote.trim() || null,
      added_by: input.actorUserId,
    },
    { onConflict: "meeting_id,person_id" },
  );
  if (lErr) throw new Error(lErr.message);
  return personId!;
}

export async function unlinkPersonFromMeeting(meetingId: string, personId: string): Promise<void> {
  const { error } = await mtgDb
    .from("mtg_meeting_people")
    .delete()
    .eq("meeting_id", meetingId)
    .eq("person_id", personId);
  if (error) throw new Error(error.message);
}
