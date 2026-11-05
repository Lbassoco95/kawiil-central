import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AgenteRegistro, ErrorTarea, TareaAgente } from "@/lib/agentes/registro";

// ── Registro de agentes de kawiil-central (solo lectura) ────────────────────────────────────────────────────────────
// Tablas agent_registry / agent_tasks: las escribe la VM kawiil-agents; aquí solo se leen con la sesión del usuario (RLS de lectura
// para autenticados). De agent_tasks se piden solo columnas sin texto de expediente (sin título, instrucciones, resultado ni error).
export const useAgentesRegistro = () =>
  useQuery({
    queryKey: ["agentes-registro", "agentes"],
    queryFn: async (): Promise<AgenteRegistro[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("agent_registry")
        .select("id, name, display_name, description, role, status, kind, last_heartbeat, last_task_at, tasks_completed, tasks_failed, config").order("name");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

export const useTareasAgentes = () =>
  useQuery({
    queryKey: ["agentes-registro", "tareas"],
    queryFn: async (): Promise<TareaAgente[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("agent_tasks")
        .select("id, agent_id, task_type, status, created_at, started_at, completed_at").order("created_at", { ascending: false }).limit(300);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });


// Solo para los agentes legales con error: se trae el mensaje de error únicamente para clasificarlo (la pantalla muestra la categoría, no el texto).
export const useErroresAgentes = (agenteIds: string[]) =>
  useQuery({
    queryKey: ["agentes-registro", "errores", agenteIds],
    enabled: agenteIds.length > 0,
    queryFn: async (): Promise<ErrorTarea[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("agent_tasks")
        .select("agent_id, created_at, error_message").in("agent_id", agenteIds).in("status", ["error", "failed"]).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });
