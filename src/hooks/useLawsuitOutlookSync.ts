import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatMicrosoftIntegrationError } from "@/lib/microsoftIntegrationErrors";
import { lawsuitOutlookEvent, type LawsuitOutlookKind } from "@/lib/lawsuits";
import type { Database } from "@/integrations/supabase/types";

type LawsuitRow = Database["public"]["Tables"]["project_lawsuits"]["Row"];

const NOT_FOUND_RE = /not\s?found|ITEM_NOT_FOUND|\[404\]/i;

async function graph(action: string, params: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("microsoft-api", { body: { action, params } });
  if (error) throw new Error(formatMicrosoftIntegrationError(error));
  if (data?.code === "NOT_CONNECTED") {
    throw new Error("Conecta tu cuenta de Microsoft 365 en Calendario para sincronizar con Outlook.");
  }
  if (data?.code === "ITEM_NOT_FOUND") throw new Error("ITEM_NOT_FOUND");
  if (data?.error) throw new Error(formatMicrosoftIntegrationError(new Error(String(data.error))));
  return data;
}

export interface LawsuitOutlookResult {
  created: number;
  updated: number;
  deleted: number;
  /** El juicio ya está en el Outlook de otra persona: no se toca. */
  skipped: boolean;
}

/** Id de cada evento y a qué columna se guarda. */
const FIELDS: Record<LawsuitOutlookKind, "outlook_hearing_event_id" | "outlook_deadline_event_id"> = {
  hearing: "outlook_hearing_event_id",
  deadline: "outlook_deadline_event_id",
};

/**
 * Deja el Outlook de `userId` alineado con las fechas del juicio: crea el evento si falta,
 * lo actualiza si ya existe y lo borra si la fecha se quitó o el juicio se cerró.
 * No toca juicios sincronizados desde el Outlook de otra persona.
 */
export async function syncLawsuitToOutlook(lawsuit: LawsuitRow, userId: string): Promise<LawsuitOutlookResult> {
  const result: LawsuitOutlookResult = { created: 0, updated: 0, deleted: 0, skipped: false };
  const hasEvents = !!(lawsuit.outlook_hearing_event_id || lawsuit.outlook_deadline_event_id);
  if (hasEvents && lawsuit.outlook_synced_by && lawsuit.outlook_synced_by !== userId) {
    return { ...result, skipped: true };
  }

  const next: Record<string, string | null> = {};
  for (const kind of Object.keys(FIELDS) as LawsuitOutlookKind[]) {
    const field = FIELDS[kind];
    const existing = lawsuit[field];
    const event = lawsuitOutlookEvent(lawsuit, kind, window.location.origin);
    let id: string | null = existing;

    if (!event) {
      if (existing) {
        try {
          await graph("delete-event", { eventId: existing });
        } catch (e) {
          if (!NOT_FOUND_RE.test(String((e as Error).message))) throw e;
        }
        result.deleted++;
        id = null;
      }
    } else if (existing) {
      try {
        await graph("update-event", { eventId: existing, payload: event });
        result.updated++;
      } catch (e) {
        if (!NOT_FOUND_RE.test(String((e as Error).message))) throw e;
        // El evento se borró a mano en Outlook: lo recreamos.
        const created = await graph("create-event", { event });
        id = created?.id ?? null;
        result.created++;
      }
    } else {
      const created = await graph("create-event", { event });
      id = created?.id ?? null;
      result.created++;
    }
    next[field] = id;
  }

  const anyEvent = Object.values(next).some(Boolean);
  const { error } = await supabase
    .from("project_lawsuits")
    .update({ ...next, outlook_synced_by: anyEvent ? userId : null })
    .eq("id", lawsuit.id);
  if (error) throw error;
  return result;
}

/** ¿Este juicio está sincronizado desde el Outlook de `userId`? */
export function isLawsuitSyncedBy(lawsuit: LawsuitRow, userId?: string): boolean {
  return (
    !!userId &&
    lawsuit.outlook_synced_by === userId &&
    !!(lawsuit.outlook_hearing_event_id || lawsuit.outlook_deadline_event_id)
  );
}

export function useLawsuitOutlookSync() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ lawsuit }: { lawsuit: LawsuitRow; silent?: boolean }) =>
      syncLawsuitToOutlook(lawsuit, user!.id),
    onSuccess: (r, { lawsuit, silent }) => {
      queryClient.invalidateQueries({ queryKey: ["project-lawsuits", lawsuit.project_id] });
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      if (silent) return;
      if (r.skipped) {
        toast.warning("Este juicio ya está en el Outlook de otra persona", {
          description: "Solo quien lo sincronizó puede actualizar esos eventos.",
        });
      } else if (r.created + r.updated + r.deleted === 0) {
        toast.info("No hay fechas que sincronizar", {
          description: "Agrega una audiencia o un plazo al juicio.",
        });
      } else {
        toast.success("Outlook actualizado", {
          description: `${r.created} creado(s), ${r.updated} actualizado(s), ${r.deleted} eliminado(s).`,
        });
      }
    },
    onError: (e: Error, { silent }) => {
      toast.error(silent ? "El juicio se guardó, pero no se pudo actualizar Outlook: " + e.message : e.message, {
        duration: 9000,
      });
    },
  });
}
