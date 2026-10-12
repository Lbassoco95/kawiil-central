import { useQuery } from "@tanstack/react-query";
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

export type MatiRow = Record<string, unknown>;

export type MatiGatewayResponse<T> = {
  configured: boolean;
  problems?: string[];
  data?: T;
  fetched_at?: string;
};

export type MatiStatusData = {
  ok?: boolean;
  status?: string;
  version?: string;
  environment?: string;
  empresa_nombre?: string;
};

async function callGateway<T>(
  action: MatiAction,
  params?: Record<string, string | number>,
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
