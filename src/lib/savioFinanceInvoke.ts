import { supabase } from "@/integrations/supabase/client";

export type SavioFinanceApiAction = "invoices" | "payments" | "customers";

export type SavioInvokeResult = {
  ok?: boolean;
  savio_http_status?: number;
  action?: string;
  path?: string;
  data?: unknown;
  error?: string;
  missing?: string[];
  message?: string;
};

export async function invokeSavioFunctionErrorBody(error: unknown): Promise<SavioInvokeResult | null> {
  if (!error || typeof error !== "object") return null;
  const ctx = (error as { context?: unknown }).context;
  if (
    ctx &&
    typeof ctx === "object" &&
    "json" in ctx &&
    typeof (ctx as Response).json === "function"
  ) {
    try {
      const parsed = await (ctx as Response).json();
      if (parsed && typeof parsed === "object") {
        return { ok: false, ...(parsed as SavioInvokeResult) };
      }
    } catch {
      /* cuerpo no JSON */
    }
  }
  return null;
}

export async function fetchSavioResource(
  action: SavioFinanceApiAction,
  query: Record<string, string>,
  /** Si se indica, GET al detalle `/invoice/{id}` (o payment/customer) según action. */
  resourceId?: string | null,
): Promise<SavioInvokeResult> {
  const body: Record<string, unknown> = { action, query };
  const rid = resourceId?.trim();
  if (rid) body.resourceId = rid;

  const { data, error } = await supabase.functions.invoke("savio-finance-api", {
    body,
  });
  if (error) {
    const fromHttp = await invokeSavioFunctionErrorBody(error);
    if (fromHttp) return fromHttp;
    return { ok: false, error: error.message || "invoke_error" };
  }
  return (data || {}) as SavioInvokeResult;
}
