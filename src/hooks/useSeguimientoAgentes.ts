import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { ActividadPublica, EntregablePublico, EventoPublico, GrupoEstado, MensajeHilo, ResumenTarea, RevisionPendiente } from "../../supabase/functions/_shared/seguimiento";

// Seguimiento de tareas de agentes y descarga de entregables. Solo lectura: todo pasa por `agente-seguimiento` (solo Dirección),
// que firma enlaces temporales; el navegador nunca ve rutas del bucket ni lo lee directamente.
export interface DetalleTarea extends ResumenTarea {
  instrucciones: string; respuesta: string; error: string; entregables_lista: EntregablePublico[];
}
export interface RespuestaDetalle { tarea: DetalleTarea; eventos: EventoPublico[]; actividad: ActividadPublica[] }

async function invocar<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("agente-seguimiento", { body });
  if (error) {
    let msg = "No se pudo leer el seguimiento. Inténtalo de nuevo.";
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* mensaje general */ }
    throw new Error(msg);
  }
  return data as T;
}

export const ESTADOS_EN_CURSO = ["pending", "queued", "in_progress", "waiting_approval"];
export const enCurso = (estado: string | undefined): boolean => !!estado && ESTADOS_EN_CURSO.includes(estado);

// Mientras haya algo en curso se actualiza cada pocos segundos; si no, con calma.
export const useTareasSeguimiento = (grupo: GrupoEstado | "todas", agentId?: string) =>
  useQuery({
    queryKey: ["agentes-seguimiento", "lista", grupo, agentId ?? null],
    queryFn: () => invocar<{ tareas: ResumenTarea[] }>({ action: "listar", ...(grupo !== "todas" ? { grupo } : {}), ...(agentId ? { agent_id: agentId } : {}) }).then((r) => r.tareas),
    refetchInterval: (q) => (q.state.data?.some((t) => enCurso(t.estado)) ? 6_000 : 20_000),
    staleTime: 3_000,
  });

export const useDetalleSeguimiento = (taskId: string | null) =>
  useQuery({
    queryKey: ["agentes-seguimiento", "detalle", taskId],
    enabled: !!taskId,
    queryFn: () => invocar<RespuestaDetalle>({ action: "detalle", task_id: taskId }),
    refetchInterval: (q) => (enCurso(q.state.data?.tarea.estado) ? 4_000 : false),
    staleTime: 2_000,
  });

export const useDescargarEntregable = () =>
  useMutation({
    mutationFn: (v: { taskId: string; indice: number }) =>
      invocar<{ url: string; nombre: string; expira_en: number }>({ action: "descargar", task_id: v.taskId, indice: v.indice }),
    onSuccess: (r) => { window.open(r.url, "_blank", "noopener,noreferrer"); },
  });

// ── Hilos (una solicitud con su conversación) y revisiones programadas ──
export interface RespuestaHilo {
  hilo: { id: string; titulo: string; agent_id: string; agente: string };
  mensajes: MensajeHilo[]; revisiones: RevisionPendiente[]; en_curso: boolean;
  escritura_dominios?: string[];   // sitios donde Dirección habilitó escribir para este agente (se autoriza por tarea)
}

// Mientras el agente trabaja se actualiza cada pocos segundos; si no, solo cuando hay un cambio.
export const useHilo = (taskId: string | null) =>
  useQuery({
    queryKey: ["agentes-seguimiento", "hilo", taskId],
    enabled: !!taskId,
    queryFn: () => invocar<RespuestaHilo>({ action: "hilo", task_id: taskId }),
    refetchInterval: (q) => (q.state.data?.en_curso ? 4_000 : false),
    staleTime: 2_000,
  });

export interface RevisionNueva { task_id: string; cuando: string; repetir?: string | null; veces?: number | null; instruccion?: string }
export function useProgramarRevision() {
  const qc = useQueryClient();
  return useMutation({
    // Los errores de validación traen una lista: se unen en un solo mensaje claro.
    mutationFn: async (v: RevisionNueva) => {
      const { data, error } = await supabase.functions.invoke("agente-seguimiento", { body: { action: "programar_revision", ...v } });
      if (error) {
        let msg = "No se pudo programar la revisión. Inténtalo de nuevo.";
        try { const j = await (error as { context?: Response }).context?.json(); msg = j?.errores?.length ? j.errores.join(" ") : (j?.error ?? msg); } catch { /* mensaje general */ }
        throw new Error(msg);
      }
      return data as { revision: { id: string; cuando: string; repetir: string | null; veces: number | null } };
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentes-seguimiento", "hilo"] }); },
  });
}

export function useCancelarRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => invocar<{ ok: boolean }>({ action: "cancelar_revision", task_id: taskId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentes-seguimiento", "hilo"] }); },
  });
}

// ── Encargos: aprobar (o reanudar) el plan y cancelarlo ──
export function useAprobarPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => invocar<{ ok: boolean; fase: string }>({ action: "aprobar_plan", task_id: taskId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentes-seguimiento"] }); },
  });
}

export function useCancelarEncargo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => invocar<{ ok: boolean }>({ action: "cancelar_encargo", task_id: taskId }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentes-seguimiento"] }); },
  });
}
