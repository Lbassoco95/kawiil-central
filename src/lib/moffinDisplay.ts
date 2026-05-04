/** Evita "Error X — CSF · fallo Moffin: Error X" cuando summary ya incluye error_message. */
export function mergeMoffinUiDetailParts(
  parts: (string | null | undefined)[],
): string | undefined {
  const cleaned = parts.map((p) => (typeof p === "string" ? p.trim() : "")).filter(Boolean);
  if (!cleaned.length) return undefined;
  if (cleaned.length === 1) return cleaned[0];
  let acc = cleaned[0];
  for (let i = 1; i < cleaned.length; i++) {
    const next = cleaned[i];
    const accL = acc.toLowerCase();
    const nextL = next.toLowerCase();
    if (accL === nextL) continue;
    if (accL.includes(nextL)) continue;
    if (nextL.includes(accL)) {
      acc = next;
      continue;
    }
    acc = `${acc} — ${next}`;
  }
  return acc;
}

export type MoffinConsultRow = {
  id: string;
  consult_type: string;
  status: string;
  summary: string | null;
  created_at: string;
  raw_response: unknown;
  document_id: string | null;
  error_message?: string | null;
  moffin_query_id?: string | null;
  documents?: { file_path: string | null; name: string | null } | null;
};

/** Pendiente en Moffin o éxito sin PDF guardado aún (reintento vía sincronizar). */
export function moffinConsultNeedsApiSync(
  row: Pick<MoffinConsultRow, "status" | "moffin_query_id" | "document_id" | "consult_type">,
): boolean {
  if (!row.moffin_query_id) return false;
  if (row.status === "pending") return true;
  if (
    row.status === "success" &&
    !row.document_id &&
    (row.consult_type === "constancia_situacion_fiscal" ||
      row.consult_type === "opinion_cumplimiento")
  ) {
    return true;
  }
  return false;
}

/** Útil para UI: respuesta GET /report o POST mezclada en raw_response. */
function lista69bInnerFromRaw(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const top =
    (o.moffinGetReportSnapshot as Record<string, unknown> | undefined) ?? o;
  const tryInner = (x: unknown): Record<string, unknown> | null =>
    x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
  return (
    tryInner(top.response) ??
    tryInner(top.state) ??
    tryInner((top.response as Record<string, unknown> | undefined)?.data) ??
    tryInner(top.data)
  );
}

export function pickLatestMoffinByType(rows: MoffinConsultRow[]): Map<string, MoffinConsultRow> {
  const map = new Map<string, MoffinConsultRow>();
  for (const r of rows) {
    if (!map.has(r.consult_type)) map.set(r.consult_type, r);
  }
  return map;
}

/** Resultado legible para lista 69-B (heurística sobre Estatus / resumen Moffin). */
export function lista69bHeadline(row: MoffinConsultRow | undefined): {
  title: string;
  detail?: string;
  tone: "ok" | "warn" | "muted" | "bad";
} {
  if (!row) {
    return { title: "Sin consulta reciente", tone: "muted" };
  }
  if (row.status === "pending") {
    const detail = mergeMoffinUiDetailParts([row.summary, row.error_message]);
    return { title: "Lista 69-B en proceso", detail, tone: "muted" };
  }
  if (row.status === "fail" || row.status === "error") {
    return {
      title: "Sin resultado válido",
      detail: mergeMoffinUiDetailParts([row.error_message, row.summary]),
      tone: "bad",
    };
  }
  const inner = lista69bInnerFromRaw(row.raw_response);
  const est = String(inner?.Estatus ?? inner?.estatus ?? inner?.resultado ?? "").trim();
  const blob = `${est} ${row.summary ?? ""}`.toLowerCase();
  if (/no localizado|no se encuentra|no aparece|sin registro|no figura|vigente sin/i.test(blob)) {
    return {
      title: "No figura en lista 69-B",
      detail: est || row.summary || undefined,
      tone: "ok",
    };
  }
  if (/localizado|presunto|definitivo|sentencia|incluido|lista\s*69/i.test(blob)) {
    return {
      title: "Revisar situación 69-B",
      detail: est || row.summary || undefined,
      tone: "warn",
    };
  }
  return {
    title: est || "Lista 69-B consultada",
    detail: row.summary ?? undefined,
    tone: "muted",
  };
}

export function certConsultLine(
  label: string,
  row: MoffinConsultRow | undefined,
): { title: string; detail?: string; hasFile: boolean; tone: "ok" | "warn" | "muted" | "bad" } {
  if (!row) {
    return { title: `${label}: sin consulta`, hasFile: false, tone: "muted" };
  }
  if (row.status === "pending") {
    return {
      title: `${label} en proceso`,
      detail: mergeMoffinUiDetailParts([row.summary, row.error_message]),
      hasFile: false,
      tone: "muted",
    };
  }
  if (row.status === "fail" || row.status === "error") {
    const em = row.error_message?.trim() ?? "";
    const fromMoffinApi = em.startsWith("Origen:");
    return {
      title: fromMoffinApi ? `${label}: error (Moffin)` : `${label}: error`,
      detail: fromMoffinApi
        ? em
        : mergeMoffinUiDetailParts([row.error_message, row.summary]),
      hasFile: false,
      tone: "bad",
    };
  }
  const doc = row.documents;
  const hasFile = !!(doc?.file_path);
  const isCert =
    row.consult_type === "constancia_situacion_fiscal" ||
    row.consult_type === "opinion_cumplimiento";
  if (row.status === "success" && !hasFile && isCert) {
    return {
      title: label,
      detail: [
        row.summary,
        row.error_message,
        "Sin PDF adjunto: la consulta suele devolver certificados RFC, no constancia/opinión en PDF salvo que Moffin lo incluya en tu plan. Puedes «Sincronizar con Moffin» por si el archivo llegó después.",
      ]
        .filter(Boolean)
        .join(" ")
        .trim(),
      hasFile: false,
      tone: "warn",
    };
  }
  return {
    title: label,
    detail: row.summary ?? undefined,
    hasFile,
    tone: row.status === "success" ? "ok" : "muted",
  };
}
