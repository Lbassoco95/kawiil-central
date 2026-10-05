/**
 * Acceso del back-office a las tablas y a la API v1 del portal del cliente.
 * Las tablas portal_* aún no están en `types.ts` generado; mientras tanto se
 * usan sin tipos de tabla. Todo pasa por la RLS con la sesión del equipo.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export const portalDb = supabase as unknown as SupabaseClient;

async function call<T = unknown>(operation: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await portalDb.functions.invoke(`portal-api/v1/${operation}`, { body });
  if (error) {
    let msg = "No se pudo completar la operación.";
    try { msg = (await (error as { context?: Response }).context?.json())?.message ?? msg; } catch { /* sin cuerpo */ }
    throw new Error(msg);
  }
  return (data as { data: T }).data;
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export const portalApi = {
  call,
  async openFile(kind: string, id: string) {
    const { url } = await call<{ url: string }>("archivos.enlace", { kind, id });
    window.open(url, "_blank", "noopener");
  },
};
