import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { MensajeChat, PropuestaAgente } from "../../supabase/functions/_shared/agenteConstructor";

// Chat especializado para crear agentes. «chat» solo conversa y propone; «crear» inserta UN agente en el registro
// y únicamente se llama cuando la persona confirma la propuesta en pantalla.
export interface RespuestaConstructor { texto: string; propuesta: PropuestaAgente | null; avisos: string[] }
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
    mutationFn: async (v: { agent_id: string; title: string; instructions: string }) => {
      const { data, error } = await supabase.functions.invoke("dispatch-to-agent", {
        body: { agent_id: v.agent_id, title: v.title, instructions: v.instructions, description: v.instructions, task_type: "manual", priority: "normal" },
      });
      if (error) throw new Error("No se pudo enviar la instrucción. Revisa que el servicio de agentes esté encendido.");
      return data;
    },
  });
