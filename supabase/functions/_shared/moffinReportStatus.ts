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
  const snap = json.moffinGetReportSnapshot;
  if (snap && typeof snap === "object" && !Array.isArray(snap)) {
    const nested = extractMoffinReportStatus(snap as Record<string, unknown>);
    if (nested) return nested;
  }
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

/** Mensaje de error en un envelope GET/POST (raíz o `serviceQuery`). */
function extractMoffinErrorMessageFromRecord(env: Record<string, unknown>): string | null {
  const pick = (o: unknown): string | null => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    const r = o as Record<string, unknown>;
    for (const k of ["errorMessage", "error_message", "message", "error", "description"]) {
      const v = r[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  const sq = env.serviceQuery;
  if (sq && typeof sq === "object" && !Array.isArray(sq)) {
    const r = sq as Record<string, unknown>;
    const innerResp = pick(r.response);
    if (innerResp) return innerResp;
    const innerState = pick(r.state);
    if (innerState) return innerState;
    const top = pick(r);
    if (top) return top;
  }
  const resp = pick(env.response);
  if (resp) return resp;
  return pick(env);
}

/**
 * Mensaje de error anidado (p. ej. `serviceQuery.response.errorMessage`) cuando el status es FAIL.
 * También busca dentro de `moffinGetReportSnapshot` (filas refrescadas / `raw_response` mergeado).
 */
export function extractMoffinErrorMessage(json: Record<string, unknown>): string | null {
  const snap = json.moffinGetReportSnapshot;
  if (snap && typeof snap === "object" && !Array.isArray(snap)) {
    const fromSnap = extractMoffinErrorMessageFromRecord(snap as Record<string, unknown>);
    if (fromSnap) return fromSnap;
  }
  return extractMoffinErrorMessageFromRecord(json);
}

/**
 * Texto único para `moffin_consults.error_message` cuando la consulta SAT (CSF/32D) falla:
 * indica origen (Nubarium vs API Moffin) y el detalle devuelto por el proveedor.
 */
export function buildMoffinConsultFailErrorMessage(json: Record<string, unknown>): string {
  const extracted = extractMoffinErrorMessage(json);
  const rootPieces = [json.message, json.error]
    .filter((x): x is string => typeof x === "string" && !!x.trim())
    .map((s) => s.trim());
  const rootJoined = rootPieces.length ? Array.from(new Set(rootPieces)).join(" · ") : "";
  const flat = moffinResponseMessagesFlattened(json);
  const flatFirst =
    flat.length > 0
      ? flat
          .split("|")
          .map((s) => s.trim())
          .find((s) => s.length > 0) ?? ""
      : "";
  let technical = extracted || rootJoined || flatFirst;
  if (!technical) technical = "Moffin reportó la consulta como fallida sin mensaje detallado.";
  const tl = technical.toLowerCase();
  const origin = /nubarium/.test(tl)
    ? "proveedor Nubarium (cadena SAT de Moffin)"
    : /sat|solutions|moffin|clave|credential|ciec|perfil/i.test(tl)
      ? "Moffin Solutions (consulta SAT)"
      : "Moffin Solutions";
  const out = `Origen: ${origin}. ${technical}`;
  return out.slice(0, 500);
}
