import { supabase } from "@/integrations/supabase/client";
import { readSupabaseFunctionErrorBody } from "@/hooks/useMicrosoft";
import { formatMicrosoftIntegrationError } from "@/lib/microsoftIntegrationErrors";
import { toDateStringMX } from "@/lib/dateUtils";
import type { Database } from "@/integrations/supabase/types";
import {
  LAWSUIT_EVENT_KINDS,
  buildLawsuitEvent,
  eventSlotChanged,
  lawsuitEventSlot,
  type EventAttendee,
  type LawsuitEventKind,
} from "@/lib/lawsuitCalendar";

type LawsuitRow = Database["public"]["Tables"]["project_lawsuits"]["Row"];
type LawsuitUpdate = Database["public"]["Tables"]["project_lawsuits"]["Update"];

const LABEL: Record<LawsuitEventKind, string> = { audiencia: "audiencia", plazo: "plazo" };
const COLS = {
  audiencia: { id: "hearing_event_id", owner: "hearing_event_owner" },
  plazo: { id: "deadline_event_id", owner: "deadline_event_owner" },
} as const;

export interface LawsuitCalendarSyncResult {
  done: string[];
  warnings: string[];
}

async function callGraph(action: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("microsoft-api", { body: { action, params } });
  if (error) throw new Error(formatMicrosoftIntegrationError(error, await readSupabaseFunctionErrorBody(error)));
  if (data?.error) throw new Error(formatMicrosoftIntegrationError(new Error(String(data.error))));
  return (data ?? {}) as Record<string, unknown>;
}

const isNotFound = (e: unknown) => /404|not\s*found|erroritemnotfound|no fue encontrado/i.test(String((e as Error)?.message ?? e));

/** Integrantes del proyecto (equipo + responsable), sin incluir a quien guarda. */
async function projectAttendees(projectId: string, userId: string) {
  const [{ data: team }, { data: project }] = await Promise.all([
    supabase.from("project_team").select("user_id").eq("project_id", projectId),
    supabase.from("projects").select("name, responsible_user_id").eq("id", projectId).maybeSingle(),
  ]);
  const ids = [...new Set([...(team ?? []).map((t) => t.user_id), project?.responsible_user_id].filter(Boolean))]
    .filter((id) => id !== userId) as string[];
  let attendees: EventAttendee[] = [];
  if (ids.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, microsoft_email, is_active")
      .in("user_id", ids);
    attendees = (profiles ?? [])
      .filter((p) => p.is_active !== false && (p.microsoft_email || p.email))
      .map((p) => ({ email: (p.microsoft_email || p.email)!, name: p.full_name }));
  }
  return { attendees, projectName: project?.name ?? null };
}

/**
 * Crea / actualiza / elimina en el Outlook de quien guarda los eventos de audiencia y plazo.
 * Nunca lanza: los fallos de Outlook vuelven como avisos (el juicio ya quedó guardado).
 */
export async function syncLawsuitCalendarEvents(
  lawsuit: LawsuitRow,
  previous: LawsuitRow | null | undefined,
  userId: string,
): Promise<LawsuitCalendarSyncResult> {
  const out: LawsuitCalendarSyncResult = { done: [], warnings: [] };
  const today = toDateStringMX();
  let ctx: Awaited<ReturnType<typeof projectAttendees>> | null = null;

  for (const kind of LAWSUIT_EVENT_KINDS) {
    const cols = COLS[kind];
    const eventId = lawsuit[cols.id];
    const owner = lawsuit[cols.owner];
    const mine = !!eventId && owner === userId;
    const slot = lawsuitEventSlot(lawsuit, kind);
    const patch: LawsuitUpdate = {};

    try {
      if (!slot) {
        if (!eventId) continue;
        if (mine) {
          await callGraph("delete-event", { eventId }).catch((e) => {
            if (!isNotFound(e)) throw e;
          });
          out.done.push(`${LABEL[kind]} eliminada de Outlook`);
        } else {
          out.warnings.push(`Se quitó la ${LABEL[kind]}; el evento anterior sigue en el Outlook de quien lo creó.`);
        }
        Object.assign(patch, { [cols.id]: null, [cols.owner]: null });
      } else {
        const changed = eventSlotChanged(previous, lawsuit, kind);
        if (eventId && !changed) continue;
        if (!eventId && slot.date < today) continue;

        ctx ??= await projectAttendees(lawsuit.project_id, userId);
        const event = buildLawsuitEvent(lawsuit, kind, { ...ctx, appUrl: window.location.origin })!;

        let newId: string | null = null;
        if (mine) {
          try {
            const res = await callGraph("update-event", { eventId, payload: event });
            newId = typeof res.id === "string" ? res.id : eventId;
            out.done.push(`${LABEL[kind]} actualizada en Outlook`);
          } catch (e) {
            if (!isNotFound(e)) throw e;
          }
        }
        if (!newId) {
          const res = await callGraph("create-event", { event });
          if (typeof res.id !== "string") throw new Error("Outlook no devolvió el id del evento");
          newId = res.id;
          out.done.push(`${LABEL[kind]} agregada a Outlook`);
          if (eventId && !mine) {
            out.warnings.push(
              `La ${LABEL[kind]} anterior sigue en el Outlook de quien la creó; se generó un evento nuevo en el tuyo.`,
            );
          }
        }
        Object.assign(patch, { [cols.id]: newId, [cols.owner]: userId });
      }
    } catch (e) {
      out.warnings.push(`No se pudo sincronizar la ${LABEL[kind]} con Outlook: ${(e as Error).message}`);
      continue;
    }

    if (patch[cols.id] !== eventId || patch[cols.owner] !== owner) {
      const { error } = await supabase.from("project_lawsuits").update(patch).eq("id", lawsuit.id);
      if (error) out.warnings.push(`No se guardó el vínculo con Outlook: ${error.message}`);
    }
  }
  return out;
}

/** Al borrar un juicio: quita de mi Outlook los eventos que yo creé. */
export async function deleteLawsuitCalendarEvents(lawsuit: LawsuitRow, userId: string): Promise<void> {
  for (const kind of LAWSUIT_EVENT_KINDS) {
    const cols = COLS[kind];
    const eventId = lawsuit[cols.id];
    if (eventId && lawsuit[cols.owner] === userId) {
      await callGraph("delete-event", { eventId }).catch(() => undefined);
    }
  }
}
