/** Llamadas a la API v1 del portal (Edge portal-api). Contrato: docs/portal/API.md. */
import { db } from "./supabase";

export class PortalApiError extends Error {
  constructor(public code: string, message: string, public details?: unknown, public status?: number) {
    super(message);
  }
}

export async function callApi<T = unknown>(operation: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await db.functions.invoke(`portal-api/v1/${operation}`, { body });
  if (error) {
    let payload: { error?: string; message?: string; details?: unknown } = {};
    try {
      payload = await (error as { context?: Response }).context?.json();
    } catch { /* sin cuerpo */ }
    throw new PortalApiError(payload.error ?? "error", payload.message ?? "No se pudo completar la operación.", payload.details,
      (error as { context?: Response }).context?.status);
  }
  return (data as { data: T }).data;
}

/** Abre un archivo por enlace firmado de 2 minutos (queda en bitácora). */
export async function openFile(kind: string, id: string) {
  const { url } = await callApi<{ url: string }>("archivos.enlace", { kind, id });
  window.open(url, "_blank", "noopener");
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
