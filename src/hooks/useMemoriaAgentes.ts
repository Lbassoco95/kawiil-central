import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MemoriaPublica } from "../../supabase/functions/_shared/memoria";

// Memoria de los agentes: solo metadatos (tipo, importancia, uso, vencimiento) y poder apagar o encender. Todo pasa por `agente-memoria` (solo Dirección):
// la tabla no es legible desde el navegador y el texto de las memorias nunca sale de la base.
async function invocar<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("agente-memoria", { body });
  if (error) {
    let msg = "No se pudo leer la memoria. Inténtalo de nuevo.";
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* mensaje general */ }
    throw new Error(msg);
  }
  return data as T;
}

export const useMemoriasAgentes = () =>
  useQuery({
    queryKey: ["agentes-memoria"],
    queryFn: () => invocar<{ memorias: MemoriaPublica[] }>({ action: "listar" }).then((r) => r.memorias),
    staleTime: 30_000,
  });

export function useCambiarMemoria() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; activa: boolean }) => invocar<{ memoria: MemoriaPublica }>({ action: "cambiar", id: v.id, activa: v.activa }).then((r) => r.memoria),
    onSuccess: (m) => { qc.setQueryData<MemoriaPublica[]>(["agentes-memoria"], (viejas) => (viejas ?? []).map((x) => (x.id === m.id ? m : x))); },
  });
}
