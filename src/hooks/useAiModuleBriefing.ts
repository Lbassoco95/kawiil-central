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
  /** Hash SHA-256 (hex) del payload que alimenta el briefing; se guarda para trazabilidad. */
  payloadHash: string;
  /** Sólo se llama si hay que (re)generar. Devuelve los mensajes para ai-chat simple. */
  buildMessages: () => AiChatSimpleMessage[];
  /** Opcional: metadata extra que se guarda con el briefing (modelo, version, ...). */
  metadata?: Record<string, unknown>;
  /** Desactivar mientras faltan datos (p.ej. aún cargando tareas). */
  enabled?: boolean;
  /**
   * Si `true`, al montar consulta cache y si no hay fila del día, genera automáticamente.
   * Si `false` (default), sólo LEE el cache — la generación requiere llamar a `regenerate()`.
   *
   * Política: el hero del dashboard pasa `true` (1 briefing automático/día).
   * Los briefings de módulo (proyectos, finanzas, tareas, ...) pasan `false` para
   * que el usuario los dispare explícitamente con un botón "Generar briefing".
   */
  autoFetch?: boolean;
}

export interface UseAiModuleBriefingResult {
  content: string;
  /** Insights por KPI (si el briefing los incluyó en metadata.metric_insights). */
  metricInsights: Record<string, string>;
  isLoading: boolean;
  isRefreshing: boolean;
  error: Error | null;
  regenerate: () => Promise<void>;
  source: "cache" | "generated" | null;
  /** `true` cuando hay fila cacheada para el día (aunque el contenido aún no esté renderizado). */
  hasCached: boolean;
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

type QueryData = {
  content: string;
  source: "cache" | "generated";
  metricInsights: Record<string, string>;
  hasCached: boolean;
} | null;

function extractMetricInsights(metadata: unknown): Record<string, string> {
  if (!metadata || typeof metadata !== "object") return {};
  const mi = (metadata as { metric_insights?: unknown }).metric_insights;
  if (!mi || typeof mi !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(mi as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim().length > 0) out[k] = v;
  }
  return out;
}

/**
 * Helper reutilizable para los prompts: instrucciones estándar para que Claude
 * devuelva un JSON `{ markdown, metric_insights }`. Los callers lo concatenan
 * a su propio contexto y, opcionalmente, enumeran los `kpi_id` esperados.
 */
export function briefingJsonInstructions(params: {
  metricKeys?: string[];
  maxInsightChars?: number;
}): string {
  const { metricKeys = [], maxInsightChars = 140 } = params;
  const keysList =
    metricKeys.length > 0
      ? metricKeys.map((k) => `"${k}"`).join(", ")
      : "(ninguno — puedes omitir metric_insights o devolver {})";
  return [
    "",
    "FORMATO DE RESPUESTA — IMPORTANTE:",
    "Devuelve ÚNICAMENTE un JSON válido (sin texto antes ni después, sin ```fences```) con esta forma exacta:",
    "{",
    '  "markdown": "<el briefing completo en markdown>",',
    '  "metric_insights": { "<kpi_id>": "<frase corta con el insight>" }',
    "}",
    `KPIs esperados en metric_insights: ${keysList}.`,
    `Cada insight debe ser una sola frase (máx ${maxInsightChars} caracteres), concreto, sin saludos.`,
    "Si no tienes un insight útil para un KPI, omite esa clave.",
    'El campo "markdown" es OBLIGATORIO y contiene el briefing completo tal como lo verá el usuario.',
  ].join("\n");
}

/**
 * Intenta parsear el output de IA como JSON estructurado `{ markdown, metric_insights }`.
 * Soporta respuestas envueltas en ```json ... ``` o texto plano.
 *
 * Si el parse tiene éxito y la estructura es correcta, devuelve `{ markdown, metricInsights }`.
 * En caso contrario devuelve `{ markdown: rawContent, metricInsights: {} }` (retrocompat).
 */
export function parseBriefingOutput(rawContent: string): {
  markdown: string;
  metricInsights: Record<string, string>;
} {
  const trimmed = (rawContent || "").trim();
  if (!trimmed) return { markdown: "", metricInsights: {} };

  // Intentar extraer un bloque JSON: ```json ... ``` o primer objeto `{...}`.
  let candidate: string | null = null;
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    candidate = fenceMatch[1].trim();
  } else if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    candidate = trimmed;
  } else {
    // Buscar el primer objeto JSON razonable dentro del texto.
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      candidate = trimmed.slice(firstBrace, lastBrace + 1);
    }
  }

  if (candidate) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === "object") {
        const obj = parsed as { markdown?: unknown; metric_insights?: unknown };
        const md = typeof obj.markdown === "string" ? obj.markdown.trim() : "";
        if (md) {
          const mi: Record<string, string> = {};
          if (obj.metric_insights && typeof obj.metric_insights === "object") {
            for (const [k, v] of Object.entries(obj.metric_insights as Record<string, unknown>)) {
              if (typeof v === "string" && v.trim().length > 0) mi[k] = v.trim();
            }
          }
          return { markdown: md, metricInsights: mi };
        }
      }
    } catch {
      /* no era JSON válido: caemos a texto plano */
    }
  }

  return { markdown: trimmed, metricInsights: {} };
}

/**
 * Briefing IA cacheado en public.ai_module_briefings (user_id, module, briefing_date).
 *
 * Blindaje 1/día: si ya existe fila para `(user, module, hoyMX)`, el hook devuelve
 * la fila existente **aunque el payload_hash haya cambiado** durante el día.
 * La regeneración sólo ocurre con `regenerate()` explícito. Esto evita que cambios
 * menores en tareas/KPIs durante el día disparen llamadas a Anthropic silenciosas.
 *
 * Modo on-demand (`autoFetch: false`): el hook sólo LEE el cache. Si no hay fila,
 * `content` queda vacío hasta que el caller llame a `regenerate()` (ej. botón).
 */
export function useAiModuleBriefing(
  input: UseAiModuleBriefingInput,
): UseAiModuleBriefingResult {
  const {
    module,
    payloadHash,
    buildMessages,
    metadata,
    enabled = true,
    autoFetch = false,
  } = input;
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const briefingDate = useMemo(() => toDateStringMX(nowMX()), []);
  const queryKey = useMemo(
    () => ["ai-module-briefing", user?.id, module, briefingDate] as const,
    [user?.id, module, briefingDate],
  );

  const query = useQuery<QueryData>({
    queryKey,
    // Nota: payloadHash ya NO es requisito para habilitar la query — necesitamos
    // poder consultar el cache del día aunque el hash aún no se haya calculado.
    enabled: !!user && enabled,
    staleTime: 10 * 60 * 1000,
    queryFn: async (): Promise<QueryData> => {
      if (!user) return null;

      const { data: existing, error: selErr } = await supabase
        .from("ai_module_briefings")
        .select("id, content, payload_hash, briefing_date, metadata")
        .eq("user_id", user.id)
        .eq("module", module)
        .eq("briefing_date", briefingDate)
        .maybeSingle<BriefingRow>();

      if (selErr && selErr.code !== "PGRST116") throw selErr;

      // Blindaje 1/día: si hay fila para hoy, la servimos aunque cambie el hash.
      if (existing && existing.content) {
        return {
          content: existing.content,
          source: "cache",
          metricInsights: extractMetricInsights(existing.metadata),
          hasCached: true,
        };
      }

      // No hay fila del día. En modo on-demand no generamos: devolvemos null.
      if (!autoFetch) {
        return {
          content: "",
          source: "cache",
          metricInsights: {},
          hasCached: false,
        };
      }

      // Modo automático: generar (solo si hay payloadHash ya calculado).
      if (!payloadHash) return null;

      const orgId = await fetchOrgId(user.id);
      if (!orgId) {
        throw new Error("No se encontró la organización del usuario.");
      }

      const raw = await fetchAiChatSimpleContent(buildMessages());
      const { markdown, metricInsights } = parseBriefingOutput(raw);
      if (!markdown) throw new Error("La IA no devolvió contenido.");

      const mergedMetadata: Record<string, unknown> = {
        ...(metadata ?? {}),
        ...(Object.keys(metricInsights).length > 0
          ? { metric_insights: metricInsights }
          : {}),
      };

      const { error: upErr } = await supabase
        .from("ai_module_briefings")
        .upsert(
          {
            user_id: user.id,
            organization_id: orgId,
            module,
            briefing_date: briefingDate,
            content: markdown,
            payload_hash: payloadHash,
            metadata: mergedMetadata as never,
          },
          { onConflict: "user_id,module,briefing_date" },
        );
      if (upErr) {
        // No hacemos throw: devolvemos el contenido generado aunque el cache falle.
        console.warn("[useAiModuleBriefing] upsert falló:", upErr);
      }

      return {
        content: markdown,
        source: "generated",
        metricInsights,
        hasCached: true,
      };
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Sin sesión.");
      const orgId = await fetchOrgId(user.id);
      if (!orgId) throw new Error("No se encontró la organización del usuario.");

      const raw = await fetchAiChatSimpleContent(buildMessages());
      const { markdown, metricInsights } = parseBriefingOutput(raw);
      if (!markdown) throw new Error("La IA no devolvió contenido.");

      const mergedMetadata: Record<string, unknown> = {
        ...(metadata ?? {}),
        ...(Object.keys(metricInsights).length > 0
          ? { metric_insights: metricInsights }
          : {}),
      };

      const { error: upErr } = await supabase
        .from("ai_module_briefings")
        .upsert(
          {
            user_id: user.id,
            organization_id: orgId,
            module,
            briefing_date: briefingDate,
            content: markdown,
            payload_hash: payloadHash,
            metadata: mergedMetadata as never,
          },
          { onConflict: "user_id,module,briefing_date" },
        );
      if (upErr) console.warn("[useAiModuleBriefing] regenerate upsert falló:", upErr);
      return { markdown, metricInsights };
    },
    onSuccess: ({ markdown, metricInsights }) => {
      queryClient.setQueryData<QueryData>(queryKey, {
        content: markdown,
        source: "generated",
        metricInsights,
        hasCached: true,
      });
    },
  });

  const regenerate = useCallback(async () => {
    await regenerateMutation.mutateAsync();
  }, [regenerateMutation]);

  const data = query.data ?? null;

  return {
    content: data?.content ?? "",
    metricInsights: data?.metricInsights ?? {},
    isLoading: query.isLoading,
    isRefreshing: regenerateMutation.isPending || query.isFetching,
    error: (query.error as Error | null) ?? (regenerateMutation.error as Error | null) ?? null,
    regenerate,
    source: data?.source ?? null,
    hasCached: data?.hasCached ?? false,
  };
}
