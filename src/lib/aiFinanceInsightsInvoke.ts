import { supabase } from "@/integrations/supabase/client";

export type AiFinanceInsightsSnapshot = Record<string, unknown>;

export type AiFinanceInsightsResult =
  | { ok: true; markdown: string }
  | { ok: false; skip?: string; error?: string; message?: string };

export async function invokeAiFinanceInsights(
  snapshot: AiFinanceInsightsSnapshot,
): Promise<{ data: AiFinanceInsightsResult | null; error: Error | null }> {
  const { data, error } = await supabase.functions.invoke<AiFinanceInsightsResult>("ai-finance-insights", {
    body: { snapshot },
  });
  return { data: data ?? null, error: error as Error | null };
}
