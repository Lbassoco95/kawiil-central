/** Catálogo SAT local para /diseno y fallback cuando no hay RPC. Búsqueda aproximada. */

export type SatCatalogHit = { clave: string; descripcion: string; score: number };

type Entry = { clave: string; descripcion: string; synonyms: string[] };

const PROD_SERV: Entry[] = [
  { clave: "80101500", descripcion: "Servicios de consultoría de negocios", synonyms: ["consultoria", "asesoria", "negocios"] },
  { clave: "80101501", descripcion: "Servicios de consultoría en planeación estratégica", synonyms: ["planeacion", "estrategia"] },
  { clave: "80101507", descripcion: "Servicios de consultoría en recursos humanos", synonyms: ["rh", "rrhh", "recursos humanos"] },
  { clave: "80121500", descripcion: "Servicios de asesoría legal", synonyms: ["legal", "juridico", "abogado"] },
  { clave: "80131500", descripcion: "Servicios de contabilidad", synonyms: ["contabilidad", "contable", "contador", "conta"] },
  { clave: "80131501", descripcion: "Servicios de auditoría", synonyms: ["auditoria"] },
  { clave: "80131502", descripcion: "Servicios de preparación de impuestos", synonyms: ["impuestos", "fiscal", "declaracion", "isr", "iva"] },
  { clave: "80131503", descripcion: "Servicios de nómina", synonyms: ["nomina", "payroll"] },
  { clave: "81111500", descripcion: "Diseño de software o hardware", synonyms: ["software", "desarrollo", "programacion"] },
  { clave: "81112000", descripcion: "Servicios de software", synonyms: ["saas", "licencia software"] },
  { clave: "84111506", descripcion: "Servicios de facturación", synonyms: ["facturacion", "factura", "cfdi"] },
];

const UNIDAD: Entry[] = [
  { clave: "E48", descripcion: "Unidad de servicio", synonyms: ["servicio", "servicios", "act"] },
  { clave: "H87", descripcion: "Pieza", synonyms: ["pieza", "pza", "unidad"] },
  { clave: "HUR", descripcion: "Hora", synonyms: ["hora", "horas"] },
  { clave: "MON", descripcion: "Mes", synonyms: ["mes", "mensual"] },
];

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .trim();
}

/** Score 0–1: coincidencia aproximada por clave, descripción o sinónimos. */
export function scoreApprox(query: string, entry: Entry): number {
  const q = norm(query);
  if (!q) return 0;
  const digits = q.replace(/\D/g, "");
  if (digits && entry.clave.startsWith(digits)) return Math.min(0.99, 0.7 + digits.length / entry.clave.length * 0.29);

  const hay = norm(`${entry.descripcion} ${entry.synonyms.join(" ")} ${entry.clave}`);
  if (hay.includes(q)) return 0.92;
  const tokens = q.split(/\s+/).filter(Boolean);
  let hit = 0;
  for (const t of tokens) {
    if (t.length < 2) continue;
    if (hay.includes(t)) { hit += 1; continue; }
    // prefijo / substring en palabras del catálogo
    const words = hay.split(/\s+/);
    if (words.some((w) => w.startsWith(t) || t.startsWith(w.slice(0, Math.min(4, w.length))))) hit += 0.7;
  }
  if (hit <= 0) return 0;
  return Math.min(0.9, 0.35 + hit / Math.max(tokens.length, 1) * 0.5);
}

export function suggestSatCatalogLocal(
  catalog: "c_ClaveProdServ" | "c_ClaveUnidad",
  q: string,
  limit = 8,
): SatCatalogHit[] {
  const entries = catalog === "c_ClaveUnidad" ? UNIDAD : PROD_SERV;
  return entries
    .map((e) => ({ clave: e.clave, descripcion: e.descripcion, score: scoreApprox(q, e) }))
    .filter((h) => h.score >= 0.35)
    .sort((a, b) => b.score - a.score || a.clave.localeCompare(b.clave))
    .slice(0, Math.max(1, Math.min(limit, 40)));
}
