import { supabase } from "@/integrations/supabase/client";
import { sanitizeStorageFileName } from "@/lib/storageFilename";
import { describeEdgeFnError } from "@/lib/edgeFnError";

export interface ReceiptResult {
  amount: number | null;
  currency: string;
  date: string | null;
  vendor: string | null;
  description: string;
  suggested_category: string;
}

/**
 * Sube temporalmente un comprobante (foto/PDF), pide a la IA que lea sus datos
 * (monto, fecha, concepto, categoría) y limpia el archivo temporal.
 * Sirve para precargar el formulario de nueva solicitud de gasto.
 */
export async function parseReceiptWithAi(file: File): Promise<ReceiptResult> {
  const { data: userRes } = await supabase.auth.getUser();
  const userId = userRes.user?.id;
  if (!userId) throw new Error("No hay sesión activa.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .single();
  const orgId = profile?.organization_id;
  if (!orgId) throw new Error("No se encontró la organización del usuario.");

  const safe = sanitizeStorageFileName(file.name);
  const path = `finance-receipts/${orgId}/tmp_${crypto.randomUUID()}_${safe}`;

  const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
  if (upErr) throw upErr;

  try {
    const { data, error } = await supabase.functions.invoke("finance-parse-statement", {
      body: { mode: "receipt", path, source_type: file.type },
    });
    if (error) throw new Error(describeEdgeFnError(error, "finance-parse-statement"));
    const receipt = (data as { receipt?: ReceiptResult })?.receipt;
    if (!receipt) throw new Error("La IA no devolvió datos del comprobante.");
    return receipt;
  } finally {
    await supabase.storage.from("documents").remove([path]).catch(() => {});
  }
}
