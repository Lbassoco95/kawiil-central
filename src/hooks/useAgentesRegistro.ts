import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AgenteRegistro, TareaAgente } from "@/lib/agentes/registro";

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

