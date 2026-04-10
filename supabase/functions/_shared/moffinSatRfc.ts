/**
 * Extracción de PDF / URLs de respuestas POST /query/sat_rfc (OpenAPI: “SAT RFC Certificates”).
 * Lo habitual son certificados FIEL/SELLO con `path`/`url` a objetos `.cer`, no PDF del SAT.
 * No se deben tratar esos `.cer` como constancia u opinión en PDF.
 */

export type MoffinSatRfcConsultType =
  | "constancia_situacion_fiscal"
  | "opinion_cumplimiento";

/** URL de descarga que apunta a certificado digital (.cer), no a PDF fiscal. */
export function urlLooksLikeMoffinCertificateFile(u: string): boolean {
  const t = u.trim();
  try {
    if (new URL(t).pathname.toLowerCase().endsWith(".cer")) return true;
  } catch {
    if (/\.cer(\?|#|$)/i.test(t)) return true;
  }
  return false;
}

function asSatPdfUrlCandidate(u: string | null): string | null {
  if (!u) return null;
  return urlLooksLikeMoffinCertificateFile(u) ? null : u;
}

export function isLikelyMoffinDownloadUrl(u: string): boolean {
  const t = u.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  try {
    const parsed = new URL(t);
    if (parsed.username || parsed.password) return false;
    // Placeholders tipo https://user@host en el ejemplo OpenAPI
    if (parsed.hostname.includes("@")) return false;
  } catch {
    return false;
  }
  return true;
}

/** Convierte `path` de certificado Moffin (absoluto o relativo al host API) en URL descargable. */
export function resolveMoffinPathToAbsolute(pathVal: string, moffinBase: string): string | null {
  const p = pathVal.trim();
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) {
    return isLikelyMoffinDownloadUrl(p) ? p : null;
  }
  if (p.startsWith("/")) {
    const base = moffinBase.replace(/\/$/, "");
    const u = `${base}${p}`;
    return isLikelyMoffinDownloadUrl(u) ? u : null;
  }
  return null;
}

/** No usar `url` genérico: en sat_rfc suele apuntar a un endpoint JSON (~2 KB), no al PDF. */
function stringsFromCert(c: Record<string, unknown>): string[] {
  const keys = ["pdfURL", "pdfUrl", "fileURL", "fileUrl", "downloadUrl", "downloadURL"];
  const out: string[] = [];
  for (const k of keys) {
    const v = c[k];
    if (typeof v === "string" && isLikelyMoffinDownloadUrl(v) && !urlLooksLikeMoffinCertificateFile(v)) {
      out.push(v.trim());
    }
  }
  return out;
}

export function collectSatRfcCertificates(resp: Record<string, unknown>): Array<Record<string, unknown>> {
  const r = resp?.response as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== "object") return [];
  const data = r.data as Record<string, unknown> | null | undefined;
  const certs = data?.certificates;
  if (!Array.isArray(certs)) return [];
  return certs.filter((c) => c && typeof c === "object" && !Array.isArray(c)) as Array<
    Record<string, unknown>
  >;
}

function certMatchesConstanciaKeyword(type: string): boolean {
  return /constancia|situaci[oó]n|CIF|csf|identific/i.test(type);
}

function certMatchesOpinionKeyword(type: string): boolean {
  return /opini[oó]n|cumplimiento|OIC|positiva|negativa/i.test(type);
}

/** Orden estable: FIEL suele ir antes que SELLO en constancia; al revés para opinión es heurística. */
export function pickSatRfcPdfUrl(
  consultType: MoffinSatRfcConsultType,
  report: Record<string, unknown>,
): string | null {
  const certs = collectSatRfcCertificates(report);
  if (!certs.length) return null;

  const pred =
    consultType === "constancia_situacion_fiscal"
      ? certMatchesConstanciaKeyword
      : certMatchesOpinionKeyword;

  for (const c of certs) {
    if (pred(String(c.type ?? ""))) {
      const urls = stringsFromCert(c);
      if (urls[0]) return urls[0];
    }
  }

  const normType = (c: Record<string, unknown>) =>
    String(c.type ?? "")
      .trim()
      .toUpperCase();

  const byExactType = (label: string) => {
    const hit = certs.find((c) => normType(c) === label);
    const urls = hit ? stringsFromCert(hit) : [];
    return urls[0] ?? null;
  };

  if (consultType === "constancia_situacion_fiscal") {
    const a = byExactType("FIEL");
    if (a) return a;
    const b = byExactType("SELLO");
    if (b) return b;
  } else {
    const a = byExactType("SELLO");
    if (a) return a;
    const b = byExactType("FIEL");
    if (b) return b;
  }

  const allOrdered: string[] = [];
  for (const c of certs) {
    for (const u of stringsFromCert(c)) {
      if (!allOrdered.includes(u)) allOrdered.push(u);
    }
  }
  if (consultType === "constancia_situacion_fiscal") return allOrdered[0] ?? null;
  return allOrdered[1] ?? allOrdered[0] ?? null;
}

/** Misma prioridad de certificados que pickSatRfcPdfUrl pero usando `path` resuelto contra moffinBase. */
function pickSatRfcCertificatePathPdfUrl(
  consultType: MoffinSatRfcConsultType,
  report: Record<string, unknown>,
  moffinBase: string,
): string | null {
  const pathsFromCert = (c: Record<string, unknown>): string[] => {
    const pathVal = c.path;
    if (typeof pathVal !== "string") return [];
    const u = resolveMoffinPathToAbsolute(pathVal, moffinBase);
    return u ? [u] : [];
  };

  const certs = collectSatRfcCertificates(report);
  if (!certs.length) return null;

  const pred =
    consultType === "constancia_situacion_fiscal"
      ? certMatchesConstanciaKeyword
      : certMatchesOpinionKeyword;

  for (const c of certs) {
    if (pred(String(c.type ?? ""))) {
      const urls = pathsFromCert(c);
      if (urls[0]) return urls[0];
    }
  }

  const normType = (c: Record<string, unknown>) =>
    String(c.type ?? "")
      .trim()
      .toUpperCase();

  const byExactType = (label: string) => {
    const hit = certs.find((c) => normType(c) === label);
    const urls = hit ? pathsFromCert(hit) : [];
    return urls[0] ?? null;
  };

  if (consultType === "constancia_situacion_fiscal") {
    const a = byExactType("FIEL");
    if (a) return a;
    const b = byExactType("SELLO");
    if (b) return b;
  } else {
    const a = byExactType("SELLO");
    if (a) return a;
    const b = byExactType("FIEL");
    if (b) return b;
  }

  const allOrdered: string[] = [];
  for (const c of certs) {
    for (const u of pathsFromCert(c)) {
      if (!allOrdered.includes(u)) allOrdered.push(u);
    }
  }
  if (consultType === "constancia_situacion_fiscal") return allOrdered[0] ?? null;
  return allOrdered[1] ?? allOrdered[0] ?? null;
}

export function keyLooksLikePdfDownloadField(k: string): boolean {
  const n = k.replace(/_/g, "").toLowerCase();
  return n === "pdfurl" || n === "fileurl" || n === "downloadurl";
}

function collectUrlsByPdfLikeKeys(obj: unknown, out: string[], depth: number): void {
  if (depth > 24 || obj == null) return;
  if (typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    for (const x of obj) collectUrlsByPdfLikeKeys(x, out, depth + 1);
    return;
  }
  const o = obj as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if (
      typeof v === "string" &&
      keyLooksLikePdfDownloadField(k) &&
      isLikelyMoffinDownloadUrl(v) &&
      !urlLooksLikeMoffinCertificateFile(v)
    ) {
      const t = v.trim();
      if (!out.includes(t)) out.push(t);
    }
    collectUrlsByPdfLikeKeys(v, out, depth + 1);
  }
}

/**
 * Prioriza enlaces a nivel reporte; luego `certificates[].path` resuelto;
 * después campos explícitos pdfURL/fileURL en certificados.
 */
export function pickSatRfcPdfUrlForConsult(
  consultType: MoffinSatRfcConsultType,
  report: Record<string, unknown>,
  moffinBase?: string | null,
): string | null {
  const top = asSatPdfUrlCandidate(extractReportLevelPdfUrl(report));
  if (top) return top;
  const base = moffinBase?.trim();
  if (base) {
    const fromPath = asSatPdfUrlCandidate(
      pickSatRfcCertificatePathPdfUrl(consultType, report, base),
    );
    if (fromPath) return fromPath;
  }
  return asSatPdfUrlCandidate(pickSatRfcPdfUrl(consultType, report));
}

function keyLooksLikeBase64PayloadField(k: string): boolean {
  const n = k.replace(/_/g, "").toLowerCase();
  return n.includes("base64") || n === "pdf" || n === "document" || n === "filecontent" || n === "archivo";
}

/** Busca PDF embebido en base64 (si Moffin lo devuelve en JSON). */
export function extractPdfBase64FromSatReport(report: Record<string, unknown>): string | null {
  const tryString = (s: string): string | null => {
    const t = s.replace(/\s/g, "");
    if (t.length < 200) return null;
    if (!/^[A-Za-z0-9+/]+=*$/.test(t)) return null;
    try {
      const head = atob(t.slice(0, 120));
      if (head.startsWith("%PDF")) return t;
    } catch {
      return null;
    }
    return null;
  };

  let named: string | null = null;
  let loose: string | null = null;

  const visit = (obj: unknown, depth: number) => {
    if (depth > 22 || obj == null) return;
    if (typeof obj === "string") {
      const hit = tryString(obj);
      if (hit && !loose) loose = hit;
      return;
    }
    if (typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      for (const x of obj) visit(x, depth + 1);
      return;
    }
    const o = obj as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string") {
        const hit = tryString(v);
        if (hit) {
          if (keyLooksLikeBase64PayloadField(k)) named = hit;
          else if (!loose) loose = hit;
        }
      } else {
        visit(v, depth + 1);
      }
    }
  };

  visit(report, 0);
  return named ?? loose;
}

export function extractReportLevelPdfUrl(report: Record<string, unknown>): string | null {
  const resp = report.response as Record<string, unknown> | undefined;
  const data = resp?.data as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    report.pdfURL,
    report.pdfUrl,
    report.fileURL,
    report.fileUrl,
    resp?.pdfURL,
    resp?.pdfUrl,
    resp?.fileURL,
    resp?.fileUrl,
    data?.pdfURL,
    data?.pdfUrl,
    data?.fileURL,
    data?.fileUrl,
    (report.state as Record<string, unknown> | undefined)?.pdfURL,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && isLikelyMoffinDownloadUrl(c)) {
      const t = c.trim();
      if (!urlLooksLikeMoffinCertificateFile(t)) return t;
    }
  }
  const deep: string[] = [];
  collectUrlsByPdfLikeKeys(report, deep, 0);
  for (const u of deep) {
    if (!urlLooksLikeMoffinCertificateFile(u)) return u;
  }
  return null;
}

export function summarizeSatRfcCertificates(
  consultType: MoffinSatRfcConsultType,
  resp: Record<string, unknown>,
): string {
  const st = String(resp?.status ?? "").toUpperCase();
  const r = resp?.response as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== "object") {
    return st === "PENDING" ? "Certificados SAT: consulta en proceso" : "Sin respuesta de certificados";
  }
  const certs = collectSatRfcCertificates(resp);
  const pred =
    consultType === "constancia_situacion_fiscal"
      ? certMatchesConstanciaKeyword
      : certMatchesOpinionKeyword;
  const match = certs.find((c) => pred(String(c.type ?? "")));
  if (match) {
    return `Verificación RFC · certificado ${match.type}: ${match.state ?? ""}`.trim();
  }
  if (certs.length) {
    const parts = certs.map((c) => {
      const t = String(c.type ?? "?");
      const stt = c.state != null ? String(c.state) : "";
      return stt ? `${t} (${stt})` : t;
    });
    return `Verificación RFC · certificados SAT: ${parts.join(", ")}`;
  }
  const exists = r.exists;
  const ok = r.success;
  return `SAT RFC: success=${ok}, exists=${exists}`;
}
