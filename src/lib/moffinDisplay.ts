export type MoffinConsultRow = {
  id: string;
  consult_type: string;
  status: string;
  summary: string | null;
  created_at: string;
  raw_response: unknown;
  document_id: string | null;
  documents?: { file_path: string | null; name: string | null } | null;
};

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
    return { title: "Lista 69-B en proceso", detail: row.summary ?? undefined, tone: "muted" };
  }
  if (row.status === "fail" || row.status === "error") {
    return {
      title: "Sin resultado válido",
      detail: row.summary ?? undefined,
      tone: "bad",
    };
  }
  const raw = row.raw_response as Record<string, unknown> | null | undefined;
  const inner = raw?.response as Record<string, unknown> | undefined;
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
      detail: row.summary ?? undefined,
      hasFile: false,
      tone: "muted",
    };
  }
  if (row.status === "fail" || row.status === "error") {
    return {
      title: `${label}: error`,
      detail: row.summary ?? undefined,
      hasFile: false,
      tone: "bad",
    };
  }
  const doc = row.documents;
  const hasFile = !!(doc?.file_path);
  return {
    title: label,
    detail: row.summary ?? undefined,
    hasFile,
    tone: row.status === "success" ? "ok" : "muted",
  };
}
