import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  invokeFunctionWithSession,
  functionInvokeUserMessageAsync,
} from "@/lib/supabaseInvoke";

/**
 * Lectura de MATI / Kit-to-Drive a través de `integraciones-gateway`.
 * El navegador nunca llama a MATI: solo a Kawiil. Los datos viven únicamente en
 * memoria (React Query sin persistencia) y caducan a los 60 s.
 */
export type MatiAction = "status" | "users" | "modules" | "tickets";

/** Escrituras (Fase 3, primera ola). Solo existen si el gateway las tiene activadas. */
export type MatiWriteAction = "ticket_update" | "ticket_message";

export const ESTADOS_TICKET = ["abierto", "en_progreso", "resuelto", "cerrado"] as const;
export const PRIORIDADES_TICKET = ["baja", "media", "alta", "urgente"] as const;
export type EstadoTicket = (typeof ESTADOS_TICKET)[number];
export type PrioridadTicket = (typeof PRIORIDADES_TICKET)[number];

export type MatiRow = Record<string, unknown>;

export type MatiGatewayResponse<T> = {
  configured: boolean;
  problems?: string[];
  data?: T;
  fetched_at?: string;
  /** El gateway tiene activadas las escrituras (bandera + firma + puente). El servidor las valida de todos modos. */
  writes_enabled?: boolean;
};

export type MatiStatusData = {
  ok?: boolean;
  status?: string;
  version?: string;
  environment?: string;
  empresa_nombre?: string;
};

async function callGateway<T>(
  action: MatiAction | MatiWriteAction,
  params?: Record<string, string | number | undefined>,
): Promise<MatiGatewayResponse<T>> {
  const { data, error } = await invokeFunctionWithSession<MatiGatewayResponse<T>>(
    "integraciones-gateway",
    { system: "mati", action, ...(params ? { params } : {}) },
  );
  if (error) throw new Error(await functionInvokeUserMessageAsync(data, error));
  if (!data) throw new Error("Respuesta vacía del servidor");
  return data;
}

export function useMatiStatus(enabled = true) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["mati-gateway", "status"],
    queryFn: () => callGateway<MatiStatusData>("status"),
    enabled: !!session?.access_token && enabled,
    staleTime: 60_000,
    gcTime: 60_000,
    retry: false,
  });
}

export function useMatiList(
  action: Exclude<MatiAction, "status">,
  enabled: boolean,
  params?: Record<string, string | number>,
) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ["mati-gateway", action, params ?? null],
    queryFn: () => callGateway<MatiRow[]>(action, params),
    enabled: !!session?.access_token && enabled,
    staleTime: 60_000,
    gcTime: 60_000,
    retry: false,
  });
}

/**
 * Cambia el estado y/o la prioridad de un ticket en MATI. El gateway rechaza la
 * petición si las escrituras no están activadas; la interfaz solo ofrece el botón
 * cuando `status` dice `writes_enabled`.
 */
export function useMatiTicketUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { id: string; estado?: EstadoTicket; prioridad?: PrioridadTicket }) =>
      callGateway<Record<string, unknown>>("ticket_update", p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mati-gateway", "tickets"] }),
  });
}

/** Responde un ticket en MATI. El texto viaja al gateway y nunca se guarda en el navegador. */
export function useMatiTicketMessage() {
  return useMutation({
    mutationFn: (p: { id: string; mensaje: string }) => callGateway<Record<string, unknown>>("ticket_message", p),
  });
}
