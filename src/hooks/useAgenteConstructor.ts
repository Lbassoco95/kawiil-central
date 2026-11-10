import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MensajeChat, Programacion, PropuestaAgente } from "../../supabase/functions/_shared/agenteConstructor";
import type { EstadoHabilidad, Habilidad, HabilidadBorrador } from "../../supabase/functions/_shared/habilidades";
import type { FuenteDocs } from "../../supabase/functions/_shared/fuentesDocs";

// Chat especializado para crear agentes. «chat» solo conversa y propone; «crear» inserta UN agente en el registro
// y únicamente se llama cuando la persona confirma la propuesta en pantalla.
export interface RespuestaConstructor { texto: string; propuesta: PropuestaAgente | null; avisos: string[]; secreto?: boolean }
export interface AgenteCreado { id: string; name: string; display_name: string; role: string; status: string }

async function invocar<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("agente-constructor", { body });
  if (error) {
    // supabase-js esconde el cuerpo del error en context; se intenta leer el mensaje de la función.
    let msg = "No se pudo completar la acción. Inténtalo de nuevo.";
    try { const j = await (error as { context?: Response }).context?.json(); if (j?.error) msg = j.error; } catch { /* se queda el mensaje general */ }
    throw new Error(msg);
  }
  return data as T;
}

export const useChatConstructor = () =>
  useMutation({ mutationFn: (mensajes: MensajeChat[]) => invocar<RespuestaConstructor>({ action: "chat", mensajes }) });

export function useCrearAgente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (propuesta: PropuestaAgente) => invocar<{ agente: AgenteCreado }>({ action: "crear", propuesta }).then((r) => r.agente),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentes-registro"] }); void qc.invalidateQueries({ queryKey: ["agent-list"] }); },
  });
}

// Darle una instrucción a un agente: usa el despacho que ya existe (dispatch-to-agent → VM). Crea una tarea; no cambia al agente.
export const useInstruirAgente = () =>
  useMutation({
    mutationFn: async (v: { agent_id: string; title: string; instructions: string; accesos_aprobados?: string[]; hilo_id?: string }) => {
      const { data, error } = await supabase.functions.invoke("dispatch-to-agent", {
        body: { agent_id: v.agent_id, title: v.title, instructions: v.instructions, description: v.instructions, task_type: "manual", priority: "normal",
          // Accesos de 1Password que la persona autoriza SOLO para esta tarea (la VM exige esta lista para iniciar sesión).
          // `hilo_id` = la solicitud original: la VM le da al agente lo ya hablado en ella (seguimiento dentro de un hilo).
          ...(v.accesos_aprobados?.length || v.hilo_id ? { input_context: { ...(v.accesos_aprobados?.length ? { accesos_aprobados: v.accesos_aprobados } : {}), ...(v.hilo_id ? { hilo_id: v.hilo_id } : {}) } } : {}) },
      });
      if (error) throw new Error("No se pudo enviar la instrucción. Revisa que el servicio de agentes esté encendido.");
      return data as { task_id?: string };
    },
  });

// Programar un agente (tareas recurrentes). Solo guarda la configuración; el planificador de la VM la ejecuta.
export function useProgramarAgente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { agent_id: string; programacion: Partial<Programacion> }) =>
      invocar<{ programacion: Programacion }>({ action: "programar", agent_id: v.agent_id, programacion: v.programacion }).then((r) => r.programacion),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentes-registro"] }); },
  });
}

// ── Enseñar habilidades a un agente ─────────────────────────────────────────────────────────────────
// El asistente solo propone; guardar y aprobar son acciones de una persona. Una habilidad no da permisos.
export interface RespuestaEnsenar { texto: string; habilidad: HabilidadBorrador | null; avisos: string[]; secreto?: boolean }

export const useEnsenarAgente = () =>
  useMutation({
    mutationFn: (v: { agent_id: string; mensajes: MensajeChat[]; task_id?: string }) =>
      invocar<RespuestaEnsenar>({ action: "ensenar", agent_id: v.agent_id, mensajes: v.mensajes, ...(v.task_id ? { task_id: v.task_id } : {}) }),
  });

export function useGuardarHabilidad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { agent_id: string; habilidad: HabilidadBorrador; estado: "borrador" | "aprobada"; task_id?: string }) =>
      invocar<{ habilidades: Habilidad[] }>({ action: "guardar_habilidad", ...v }).then((r) => r.habilidades),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentes-registro"] }); },
  });
}

export function useEstadoHabilidad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { agent_id: string; id: string; estado: EstadoHabilidad }) =>
      invocar<{ habilidades: Habilidad[] }>({ action: "estado_habilidad", ...v }).then((r) => r.habilidades),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentes-registro"] }); },
  });
}

// Fuentes de documentos (Google Drive / Microsoft) de un agente. Reemplaza la lista completa; solo identificadores.
export function useFuentesDocs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { agent_id: string; fuentes: FuenteDocs[] }) =>
      invocar<{ fuentes: FuenteDocs[] }>({ action: "fuentes_documentos", agent_id: v.agent_id, fuentes: v.fuentes }).then((r) => r.fuentes),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentes-registro"] }); },
  });
}

// Interruptor de «correo y calendario» de un agente (las cuentas vinculadas en Kawiil Central, solo lectura).
export function useCuentasAgente() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { agent_id: string; activa: boolean }) => invocar<{ activa: boolean }>({ action: "cuentas_agente", ...v }).then((r) => r.activa),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agentes-registro"] }); },
  });
}
