/**
 * Estados de informes Moffin (Solutions y legacy): unificar cola / proceso vs fallo.
 */

export type MoffinConsultUiStatus = "success" | "fail" | "pending" | "error";

export function mapMoffinStatus(s: string | undefined): MoffinConsultUiStatus {
  const u = String(s ?? "").trim().toUpperCase();
  if (u === "SUCCESS" || u === "COMPLETED" || u === "DONE" || u === "SUCCEEDED") return "success";
  if (
    u === "PENDING" ||
    u === "QUEUED" ||
    u === "QUEUE" ||
    u === "PROCESSING" ||
    u === "IN_PROGRESS" ||
    u === "RUNNING" ||
    u === "SUBMITTED" ||
    u === "WAITING" ||
    u === "WORKING" ||
    u === "STARTED"
  ) {
    return "pending";
  }
  if (u === "FAIL" || u === "FAILED" || u === "FAILURE") return "fail";
  return "error";
}

/**
 * Une mensajes en raíz y un nivel en `data`, `query`, `response`, `result` (Moffin a veces anida el texto).
 */
export function moffinResponseMessagesFlattened(json: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (x: unknown) => {
    if (typeof x === "string" && x.trim()) parts.push(x.trim());
  };
  push(json.message);
  push(json.error);
  push(json.statusText);
  const shallow = (obj: unknown) => {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    const o = obj as Record<string, unknown>;
    push(o.message);
    push(o.error);
    push(o.statusText);
    push(o.description);
  };
  shallow(json.data);
  shallow(json.query);
  shallow(json.response);
  shallow(json.result);
  return parts.join(" | ");
}

/** Mensaje típico cuando Moffin aceptó la solicitud pero el PDF aún no está listo (async / cola). */
export function moffinMessageImpliesQueuedProcessing(json: Record<string, unknown>): boolean {
  const msg = moffinResponseMessagesFlattened(json).toLowerCase();
  return /queued|en cola|for processing|processing|pending|en proceso|async|submitted|being processed/i.test(
    msg,
  );
}

/**
 * Incluye cola + respuestas meta de Moffin (p. ej. GET service_queries) sin cuerpo SAT/PDF todavía.
 * Ej.: "Service query fetched successfully".
 */
export function moffinMessageImpliesSatStillProcessing(json: Record<string, unknown>): boolean {
  if (moffinMessageImpliesQueuedProcessing(json)) return true;
  const msg = moffinResponseMessagesFlattened(json).toLowerCase();
  return /service query fetched successfully|service query[\s\w]*successfully|query fetched successfully/i.test(
    msg,
  );
}
