import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * useAgentList
 * ------------
 * Consume la edge function `list-agents` (Bloque B1.6.2) y expone la lista
 * de agentes disponibles para delegar una tarea. Es la fuente de datos del
 * modal <DelegateToAgentDialog>.
 *
 * Modos:
 *   - `instance`: cuando se pasa `clientId`. La edge function devuelve las
 *     filas de `client_agents` del cliente con el template anidado. Este
 *     hook filtra solo `instance_status='active'` (oculta pausadas/archivadas).
 *   - `template`: cuando `clientId` es null/undefined. La edge function
 *     devuelve templates `kind=consultable` excepto `status='archived'`.
 *     No hay `instance_status`; se devuelven tal cual.
 *
 * Cache:
 *   - `queryKey: ['agent-list', clientId ?? null]` → cache separado por
 *     cliente; cambiar `clientId` re-fetchea automáticamente.
 *   - `staleTime: 5min` → los agentes no cambian seguido; evitamos refetch
 *     agresivo al abrir y cerrar el modal.
 */

export type AgentListMode = "instance" | "template";

export type AgentInstanceStatus = "active" | "paused" | "archived";

export interface Agent {
  template_id: string;
  name: string;
  display_name: string;
  description: string | null;
  role: string;
  capabilities: string[];
  color: string;
  /** Solo presente cuando `mode === 'instance'`. */
  instance_id?: string;
  /** Solo presente cuando `mode === 'instance'`. */
  instance_status?: AgentInstanceStatus;
}

interface ListAgentsResponse {
  mode: AgentListMode;
  agents: Agent[];
}

export interface UseAgentListReturn {
  agents: Agent[];
  mode: AgentListMode | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

const STALE_TIME_MS = 5 * 60 * 1000;

export function useAgentList(clientId?: string | null): UseAgentListReturn {
  const { user } = useAuth();
  const normalizedClientId = clientId ?? null;

  const query = useQuery<ListAgentsResponse>({
    queryKey: ["agent-list", normalizedClientId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("list-agents", {
        body: { client_id: normalizedClientId },
      });
      if (error) throw error;
      if (!data) throw new Error("list-agents: empty response");
      // La edge function responde { mode, agents }. supabase-js ya parsea JSON.
      const resp = data as Partial<ListAgentsResponse>;
      if (!resp.mode || !Array.isArray(resp.agents)) {
        throw new Error("list-agents: malformed response");
      }
      return { mode: resp.mode, agents: resp.agents };
    },
    enabled: !!user,
    staleTime: STALE_TIME_MS,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const agents = useMemo(() => {
    if (!query.data) return [];
    if (query.data.mode === "instance") {
      return query.data.agents.filter((a) => a.instance_status === "active");
    }
    return query.data.agents;
  }, [query.data]);

  return {
    agents,
    mode: query.data?.mode ?? null,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
    refetch: () => void query.refetch(),
  };
}
