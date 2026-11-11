import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { borradorDeFila, MAX_BORRADORES, tituloBorrador, type Borrador } from "@/lib/agentes/borradores";
import type { MensajeChat, PropuestaAgente } from "../../supabase/functions/_shared/agenteConstructor";

// Borradores de la creación de agentes (tabla propia, solo de la persona y solo Dirección por RLS).
// La tabla es nueva y aún no está en los tipos generados: se accede sin tipos y cada fila se valida al leerla.
const tabla = () => (supabase as unknown as { from: (t: string) => any }).from("agent_creation_drafts");
const CLAVE = ["agentes-borradores"];

export const useBorradores = () =>
  useQuery({
    queryKey: CLAVE,
    queryFn: async (): Promise<Borrador[]> => {
      const { data, error } = await tabla().select("id, titulo, messages, propuesta, updated_at").order("updated_at", { ascending: false }).limit(MAX_BORRADORES);
      if (error) throw new Error("No se pudieron leer los borradores.");
      return ((data ?? []) as unknown[]).map(borradorDeFila).filter((b): b is Borrador => !!b);
    },
    staleTime: 10_000,
  });

export function useGuardarBorrador() {
  const qc = useQueryClient();
  return useMutation({
    // `id` es del navegador (uuid): así el primer guardado y los siguientes son el mismo borrador.
    mutationFn: async (v: { id: string; mensajes: MensajeChat[]; propuesta: PropuestaAgente | null }) => {
      const { error } = await tabla().upsert({ id: v.id, titulo: tituloBorrador(v.mensajes), messages: v.mensajes, propuesta: v.propuesta }, { onConflict: "id" });
      if (error) throw new Error("No se pudo guardar el borrador.");
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: CLAVE }); },
  });
}

export function useEliminarBorrador() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await tabla().delete().eq("id", id);
      if (error) throw new Error("No se pudo eliminar el borrador.");
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: CLAVE }); },
  });
}
