/**
 * Helpers para la consulta de Facturas SAT (CFDI) vía Moffin Solutions.
 * Estilo Solutions: la CIEC se usa solo para crear/recuperar el perfil SAT (profileId);
 * NUNCA viaja en el body de la consulta de facturas.
 * @see https://solutions-docs.moffin.mx/apis/consultas-al-sat
 */

/** Ruta POST Solutions para facturas (CFDI). Configurable por secreto. */
export function moffinSolutionsCfdiPath(): string {
  const raw = Deno.env.get("MOFFIN_SOLUTIONS_PATH_CFDI")?.trim();
  const path = raw && raw.length > 0 ? raw : "/query/sat/cfdi";
  return path.startsWith("/") ? path : `/${path}`;
}

/**
 * Candidatos de path para facturas (CFDI) en Solutions. El endpoint no está
 * documentado públicamente; probamos los nombres más probables. Si Moffin confirma
 * el correcto, fíjalo en MOFFIN_SOLUTIONS_PATH_CFDI y se intenta primero.
 * Un 404 / HTML no-JSON indica que ese path no existe (no genera cargo); el primero
 * que responde JSON (éxito o error real) es el endpoint correcto.
 */
export function moffinSolutionsCfdiPathCandidates(): string[] {
  const configured = Deno.env.get("MOFFIN_SOLUTIONS_PATH_CFDI")?.trim();
  const defaults = [
    "/query/sat/cfdi",
    "/query/sat/cfdis",
    "/query/sat/invoices",
    "/query/sat/facturas",
    "/query/sat/comprobantes",
  ];
  const list = configured ? [configured, ...defaults] : defaults;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of list) {
    const norm = p.startsWith("/") ? p : `/${p}`;
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}

/**
 * Candidatos de path para facturas en el API legacy (app.moffin.mx, la misma de 69-B).
 * Patrón legacy: body {externalId, rfc, CIEC, startdate, enddate} con auth `Token`.
 * Configurable con MOFFIN_LEGACY_PATH_CFDI (se intenta primero).
 */
export function moffinLegacyCfdiPathCandidates(): string[] {
  const configured = Deno.env.get("MOFFIN_LEGACY_PATH_CFDI")?.trim();
  const defaults = [
    "/query/sat_invoices",
    "/query/sat_cfdi",
    "/query/cfdi",
    "/query/facturas",
    "/queries",
  ];
  const list = configured ? [configured, ...defaults] : defaults;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of list) {
    const norm = p.startsWith("/") ? p : `/${p}`;
    if (!seen.has(norm)) {
      seen.add(norm);
      out.push(norm);
    }
  }
  return out;
}
export type MoffinCfdiNormalized = {
  id: string | null;
  uuid: string | null;
  fechaCFDI: string | null;
  fechaTimbre: string | null;
  fechaCancelacion: string | null;
  emisor: string | null;
  receptor: string | null;
  rfcEmisor: string | null;
  rfcReceptor: string | null;
  /** ingreso | egreso (tal cual lo reporta Moffin). */
  tipo: string | null;
  /** emitida = el RFC del cliente es el emisor; recibida = es el receptor. */
  direccion: "emitida" | "recibida" | "desconocida";
  estatus: string | null;
  vigente: boolean;
  total: number | null;
  pagada: boolean | null;
};

export type MoffinCfdiCounters = {
  totalCfdi: number;
  totalVigentes: number;
  totalCanceladas: number;
  emitidasVigentes: number;
  recibidasVigentes: number;
  emitidasVigentesTotalMxn: number;
  recibidasVigentesTotalMxn: number;
};

function str(x: unknown): string | null {
  if (typeof x === "string" && x.trim()) return x.trim();
  if (typeof x === "number" && Number.isFinite(x)) return String(x);
  return null;
}

function num(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string") {
    const n = parseFloat(x.replace(/,/g, "").trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function bool(x: unknown): boolean | null {
  if (typeof x === "boolean") return x;
  if (typeof x === "string") {
    const t = x.trim().toLowerCase();
    if (["true", "1", "si", "sí", "pagada"].includes(t)) return true;
    if (["false", "0", "no"].includes(t)) return false;
  }
  return null;
}

function normalizeRfc(x: unknown): string | null {
  const s = str(x);
  return s ? s.toUpperCase().replace(/\s/g, "") : null;
}

function isVigente(estatus: string | null): boolean {
  if (!estatus) return false;
  return /vigente/i.test(estatus);
}

/** Mapea un objeto CFDI crudo de Moffin a la forma normalizada. */
export function normalizeCfdi(
  raw: Record<string, unknown>,
  clientRfc: string,
): MoffinCfdiNormalized {
  const rfcEmisor = normalizeRfc(raw.rfcEmisor ?? raw.rfc_emisor);
  const rfcReceptor = normalizeRfc(raw.rfcReceptor ?? raw.rfc_receptor);
  const clientRfcNorm = clientRfc.toUpperCase().replace(/\s/g, "");
  let direccion: MoffinCfdiNormalized["direccion"] = "desconocida";
  if (rfcEmisor && rfcEmisor === clientRfcNorm) direccion = "emitida";
  else if (rfcReceptor && rfcReceptor === clientRfcNorm) direccion = "recibida";
  const estatus = str(raw.estatus ?? raw.status);
  return {
    id: str(raw.id),
    uuid: str(raw.uuid),
    fechaCFDI: str(raw.fechaCFDI ?? raw.fecha_cfdi ?? raw.fecha),
    fechaTimbre: str(raw.fechaTimbre ?? raw.fecha_timbre),
    fechaCancelacion: str(raw.fechaCancelacion ?? raw.fecha_cancelacion),
    emisor: str(raw.emisor),
    receptor: str(raw.receptor),
    rfcEmisor,
    rfcReceptor,
    tipo: str(raw.tipo),
    direccion,
    estatus,
    vigente: isVigente(estatus),
    total: num(raw.total),
    pagada: bool(raw.pagada),
  };
}

/** Busca el arreglo de CFDIs en las ubicaciones habituales de la respuesta de Moffin. */
export function extractCfdiArray(
  json: Record<string, unknown>,
): Record<string, unknown>[] | null {
  const candidates: unknown[] = [
    json.cfdis,
    json.facturas,
    json.invoices,
    json.results,
    json.result,
    json.data,
    json.items,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
  }
  // data.cfdis / data.results anidados
  const data = json.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    for (const c of [d.cfdis, d.facturas, d.invoices, d.results, d.items]) {
      if (Array.isArray(c)) return c.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
    }
  }
  return null;
}

export function computeCfdiCounters(cfdis: MoffinCfdiNormalized[]): MoffinCfdiCounters {
  const counters: MoffinCfdiCounters = {
    totalCfdi: cfdis.length,
    totalVigentes: 0,
    totalCanceladas: 0,
    emitidasVigentes: 0,
    recibidasVigentes: 0,
    emitidasVigentesTotalMxn: 0,
    recibidasVigentesTotalMxn: 0,
  };
  for (const c of cfdis) {
    if (c.vigente) {
      counters.totalVigentes += 1;
      if (c.direccion === "emitida") {
        counters.emitidasVigentes += 1;
        counters.emitidasVigentesTotalMxn += c.total ?? 0;
      } else if (c.direccion === "recibida") {
        counters.recibidasVigentes += 1;
        counters.recibidasVigentesTotalMxn += c.total ?? 0;
      }
    } else {
      counters.totalCanceladas += 1;
    }
  }
  // Redondeo a 2 decimales para evitar ruido de punto flotante
  counters.emitidasVigentesTotalMxn = Math.round(counters.emitidasVigentesTotalMxn * 100) / 100;
  counters.recibidasVigentesTotalMxn = Math.round(counters.recibidasVigentesTotalMxn * 100) / 100;
  return counters;
}
