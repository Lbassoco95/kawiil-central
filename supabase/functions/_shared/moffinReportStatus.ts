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
 * Extrae el status real del reporte. Moffin Solutions suele envolver la consulta en
 * `serviceQuery.status` cuando el GET usa `/query/{id}`; el status a nivel raíz puede estar vacío.
 */
export function extractMoffinReportStatus(json: Record<string, unknown>): string {
  const rootStatus = typeof json.status === "string" ? json.status.trim() : "";
  if (rootStatus) return rootStatus;
  const sq = json.serviceQuery;
  if (sq && typeof sq === "object" && !Array.isArray(sq)) {
    const inner = (sq as Record<string, unknown>).status;
    if (typeof inner === "string" && inner.trim()) return inner.trim();
  }
  const data = json.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const inner = (data as Record<string, unknown>).status;
    if (typeof inner === "string" && inner.trim()) return inner.trim();
  }
  return "";
}

/** Status mapeado a UI priorizando `serviceQuery.status` cuando el GET devuelve el envelope. */
export function mapMoffinReportStatus(json: Record<string, unknown>): MoffinConsultUiStatus {
  return mapMoffinStatus(extractMoffinReportStatus(json));
}

/**
 * Incluye cola + respuestas meta de Moffin (p. ej. GET service_queries) sin cuerpo SAT/PDF todavía.
 * Ej.: "Service query fetched successfully". Nunca fuerza pending si el `serviceQuery.status`
 * (o raíz) ya es terminal (SUCCESS/FAIL).
 */
export function moffinMessageImpliesSatStillProcessing(json: Record<string, unknown>): boolean {
  const explicit = extractMoffinReportStatus(json).toUpperCase();
  if (
    explicit === "SUCCESS" ||
    explicit === "COMPLETED" ||
    explicit === "DONE" ||
    explicit === "SUCCEEDED" ||
    explicit === "FAIL" ||
    explicit === "FAILED" ||
    explicit === "FAILURE"
  ) {
    return false;
  }
  if (moffinMessageImpliesQueuedProcessing(json)) return true;
  const msg = moffinResponseMessagesFlattened(json).toLowerCase();
  return /service query fetched successfully|service query[\s\w]*successfully|query fetched successfully/i.test(
    msg,
  );
}

/** Mensaje de error anidado (p. ej. `serviceQuery.response.errorMessage`) cuando el status es FAIL. */
export function extractMoffinErrorMessage(json: Record<string, unknown>): string | null {
  const pick = (o: unknown): string | null => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const r = o as Record<string, unknown>;
    for (const k of ["errorMessage", "error_message", "message", "error", "description"]) {
      const v = r[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  const sq = json.serviceQuery;
  if (sq && typeof sq === "object" && !Array.isArray(sq)) {
    const r = sq as Record<string, unknown>;
    const innerResp = pick(r.response);
    if (innerResp) return innerResp;
    const innerState = pick(r.state);
    if (innerState) return innerState;
    const top = pick(r);
    if (top) return top;
  }
  const resp = pick(json.response);
  if (resp) return resp;
  return pick(json);
}
