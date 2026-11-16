import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { hoyEnMexico, vigente, type AvisoEntrada, type AvisoVigente } from "../../supabase/functions/_shared/avisos";

// Avisos internos para el equipo. Los vigentes los lee cualquier usuario con sesión (la tabla solo deja ver los publicados); publicar, cancelar y
// redactar pasan por `comunicacion-interna` (solo Dirección). Solo panel: ningún aviso sale por correo, Slack ni WhatsApp.
export interface AvisoAdmin extends AvisoVigente { estado: "publicado" | "cancelado"; redactado_por: "agente" | "direccion"; aprobado_at: string; cancelado_at: string | null; created_at: string }

async function invocar<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("comunicacion-interna", { body });
  if (error) {
    let msg = "No se pudo completar la acción. Inténtalo de nuevo.";
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* mensaje general */ }
    throw new Error(msg);
  }
  return data as T;
}

// Si la tabla aún no existe o falla la lectura, simplemente no hay aviso: nunca debe romper la pantalla de entrada.
export const useAvisosVigentes = () =>
  useQuery({
    queryKey: ["avisos-equipo", "vigentes"],
    queryFn: async (): Promise<AvisoVigente[]> => {
      const hoy = hoyEnMexico();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("aviso_equipo").select("id, tipo, titulo, mensaje, desde, hasta").eq("estado", "publicado").gte("hasta", hoy).order("desde", { ascending: true }).limit(10);
      if (error) return [];
      return ((data ?? []) as AvisoVigente[]).filter((a) => vigente(a, hoy));
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });

export const useAvisosAdmin = () =>
  useQuery({ queryKey: ["avisos-equipo", "admin"], queryFn: () => invocar<{ avisos: AvisoAdmin[] }>({ action: "listar" }).then((r) => r.avisos), staleTime: 15_000 });

export const useRedactarAviso = () =>
  useMutation({ mutationFn: (instruccion: string) => invocar<{ borrador: AvisoEntrada }>({ action: "redactar", instruccion }).then((r) => r.borrador) });

export function usePublicarAviso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { aviso: AvisoEntrada; redactadoPor: "agente" | "direccion" }) => invocar<{ aviso: AvisoAdmin }>({ action: "publicar", aviso: v.aviso, redactado_por: v.redactadoPor }).then((r) => r.aviso),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["avisos-equipo"] }); void qc.invalidateQueries({ queryKey: ["agentes-registro"] }); },
  });
}

export function useCancelarAviso() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => invocar<{ ok: boolean }>({ action: "cancelar", id }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["avisos-equipo"] }); },
  });
}
