import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { fetchAiChatSimpleContent, type AiChatSimpleMessage } from "@/lib/fetchAiChatSimple";
import { toDateStringMX, nowMX } from "@/lib/dateUtils";

export type AiModuleBriefingModule =
  | "dashboard"
  | "tareas"
  | "proyectos"
  | "clientes"
  | "finanzas";

export interface UseAiModuleBriefingInput {
  module: AiModuleBriefingModule;
  /** Hash SHA-256 (hex) del payload que alimenta el briefing; si cambia, se regenera. */
  payloadHash: string;
  /** Sólo se llama si hay que (re)generar. Devuelve los mensajes para ai-chat simple. */
  buildMessages: () => AiChatSimpleMessage[];
  /** Opcional: metadata extra que se guarda con el briefing (modelo, version, ...). */
  metadata?: Record<string, unknown>;
  /** Desactivar mientras faltan datos (p.ej. aún cargando tareas). */
  enabled?: boolean;
}

export interface UseAiModuleBriefingResult {
  content: string;
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  regenerate: () => Promise<void>;
  source: "cache" | "generated" | null;
}

/**
 * SHA-256 hex helper — disponible en browsers modernos vía crypto.subtle.
 * Útil para computar el payloadHash desde el caller:
 *
 *   const h = await sha256Hex(JSON.stringify({ tasksIds, overdue, ... }));
 */
export async function sha256Hex(input: string): Promise<string> {
  const buffer = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchOrgId(userId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("get_user_org_id", { _user_id: userId });
  if (error) return null;
  return (data as string | null) ?? null;
}

type BriefingRow = {
  id: string;
  content: string;
  payload_hash: string;
  briefing_date: string;
  metadata: unknown;
};

/**
 * Briefing IA cacheado en public.ai_module_briefings (user_id, module, briefing_date).
 * - SELECT por (user, module, hoyMX). Si payload_hash coincide → hit.
 * - Si miss o hash distinto → llama a ai-chat simple y upsert.
 */
export function useAiModuleBriefing(
  input: UseAiModuleBriefingInput,
): UseAiModuleBriefingResult {
  const { module, payloadHash, buildMessages, metadata, enabled = true } = input;
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const briefingDate = useMemo(() => toDateStringMX(nowMX()), []);
  const queryKey = useMemo(
    () => ["ai-module-briefing", user?.id, module, briefingDate] as const,
    [user?.id, module, briefingDate],
  );

  const query = useQuery({
    queryKey,
    enabled: !!user && !!payloadHash && enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<{
      content: string;
      source: "cache" | "generated";
    } | null> => {
      if (!user) return null;

      const { data: existing, error: selErr } = await supabase
        .from("ai_module_briefings")
        .select("id, content, payload_hash, briefing_date, metadata")
        .eq("user_id", user.id)
        .eq("module", module)
        .eq("briefing_date", briefingDate)
        .maybeSingle<BriefingRow>();

      if (selErr && selErr.code !== "PGRST116") throw selErr;

      if (existing && existing.payload_hash === payloadHash && existing.content) {
        return { content: existing.content, source: "cache" };
      }

      const orgId = await fetchOrgId(user.id);
      if (!orgId) {
        throw new Error("No se encontró la organización del usuario.");
      }

      const content = await fetchAiChatSimpleContent(buildMessages());
      const trimmed = (content || "").trim();
      if (!trimmed) throw new Error("La IA no devolvió contenido.");

      const { error: upErr } = await supabase
        .from("ai_module_briefings")
        .upsert(
          {
            user_id: user.id,
            organization_id: orgId,
            module,
            briefing_date: briefingDate,
            content: trimmed,
            payload_hash: payloadHash,
            metadata: (metadata ?? {}) as never,
          },
          { onConflict: "user_id,module,briefing_date" },
        );
      if (upErr) {
        // No hacemos throw: devolvemos el contenido generado aunque el cache falle.
        console.warn("[useAiModuleBriefing] upsert falló:", upErr);
      }

      return { content: trimmed, source: "generated" };
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sin sesión.");
      const orgId = await fetchOrgId(user.id);
      if (!orgId) throw new Error("No se encontró la organización del usuario.");

      const content = await fetchAiChatSimpleContent(buildMessages());
      const trimmed = (content || "").trim();
      if (!trimmed) throw new Error("La IA no devolvió contenido.");

      const { error: upErr } = await supabase
        .from("ai_module_briefings")
        .upsert(
          {
            user_id: user.id,
            organization_id: orgId,
            module,
            briefing_date: briefingDate,
            content: trimmed,
            payload_hash: payloadHash,
            metadata: (metadata ?? {}) as never,
          },
          { onConflict: "user_id,module,briefing_date" },
        );
      if (upErr) console.warn("[useAiModuleBriefing] regenerate upsert falló:", upErr);
      return trimmed;
    },
    onSuccess: (content) => {
      queryClient.setQueryData(queryKey, { content, source: "generated" as const });
    },
  });

  const regenerate = useCallback(async () => {
    await regenerateMutation.mutateAsync();
  }, [regenerateMutation]);

  return {
    content: query.data?.content ?? "",
    isLoading: query.isLoading,
    isRefreshing: regenerateMutation.isPending || query.isFetching,
    error: (query.error as Error | null) ?? (regenerateMutation.error as Error | null) ?? null,
    regenerate,
    source: query.data?.source ?? null,
  };
}
