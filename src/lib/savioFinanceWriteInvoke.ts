import { supabase } from "@/integrations/supabase/client";
import { savioFinanceWriteFailureHint } from "@/lib/savioFinanceApiHints";
import { invokeSavioFunctionErrorBody } from "@/lib/savioFinanceInvoke";
import type { SavioWriteOperation } from "@/lib/savioWriteOperations";

export type SavioWriteInvokeResult = {
  ok?: boolean;
  savio_http_status?: number;
  operation?: string;
  path?: string;
  data?: unknown;
  error?: string;
  message?: string;
  missing?: string[];
};

export async function invokeSavioFinanceWrite(
  operation: SavioWriteOperation,
  payload: Record<string, unknown>,
): Promise<SavioWriteInvokeResult> {
  try {
    const { data, error } = await supabase.functions.invoke("savio-finance-write", {
      body: { operation, payload },
    });
    if (error) {
      const fromHttp = await invokeSavioFunctionErrorBody(error);
      if (fromHttp) {
        const hint = savioFinanceWriteFailureHint(fromHttp);
        return {
          ...fromHttp,
          message: fromHttp.message || hint || error.message || "Error al invocar facturación.",
        };
      }
      const msg = error.message || "invoke_error";
      return { ok: false, error: msg, message: msg };
    }
    const body = (data || {}) as SavioWriteInvokeResult;
    if (body.ok !== true) {
      const hint = savioFinanceWriteFailureHint(body);
      return { ...body, message: body.message || hint || "No se pudo guardar en facturación." };
    }
    return body;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: "unexpected", message: msg || "Error inesperado al contactar facturación." };
  }
}
