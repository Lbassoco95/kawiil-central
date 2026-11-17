import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { FiltroLpb, MovimientoLpb, PersonaLpb } from "../../supabase/functions/_shared/lpb";

// Lista maestra de Personas Bloqueadas y su cola de visto bueno. Todo pasa por `agente-lpb` (solo Dirección); el navegador nunca lee las tablas.
export interface ResumenLpb { total: number; vigentes: number; eliminadas: number; por_revisar: number; por_corregir: number; dudosos: number; incompletos: number; revisadas: number }
export interface PaginaLpb { personas: PersonaLpb[]; total: number; pagina: number; limite: number }
export interface DetallePersonaLpb { persona: PersonaLpb; movimientos: MovimientoLpb[] }

async function invocar<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("agente-lpb", { body });
  if (error) {
    let msg = "No se pudo leer la lista. Inténtalo de nuevo.";
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* mensaje general */ }
    throw new Error(msg);
  }
  return data as T;
}

export const useResumenLpb = () => useQuery({ queryKey: ["lpb", "resumen"], queryFn: () => invocar<ResumenLpb>({ action: "resumen" }), staleTime: 10_000 });

export const useListaLpb = (filtro: FiltroLpb, q: string, pagina: number) =>
  useQuery({ queryKey: ["lpb", "lista", filtro, q, pagina], queryFn: () => invocar<PaginaLpb>({ action: "listar", filtro, q, pagina, limite: 50 }), staleTime: 5_000, placeholderData: (prev) => prev });

export const useDetallePersonaLpb = (id: string | null) =>
  useQuery({ queryKey: ["lpb", "persona", id], enabled: !!id, queryFn: () => invocar<DetallePersonaLpb>({ action: "persona", id }), staleTime: 5_000 });

export function useRevisarLpb() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ids: string[]; decision: "aprobar" | "devolver"; nota?: string }) => invocar<{ actualizadas: number }>({ action: "revisar", ...v }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["lpb"] }); },
  });
}

export const useExportarLpb = () =>
  useMutation({ mutationFn: (v: { filtro: FiltroLpb; q: string }) => invocar<{ csv: string; filas: number; truncado: boolean }>({ action: "exportar", ...v }) });
