/** Categorías base. Las que aparezcan en importaciones o se creen en la app se guardan en finance_categories. */
export type CategoryKind = "gasto" | "ingreso" | "neutral";

export interface CategoryDef { name: string; kind: CategoryKind }

export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { name: "Cobranza clientes", kind: "ingreso" },
  { name: "Otros ingresos", kind: "ingreso" },
  { name: "Nómina y equipo", kind: "gasto" },
  { name: "IMSS e impuestos propios", kind: "gasto" },
  { name: "Software y plataformas", kind: "gasto" },
  { name: "Publicidad", kind: "gasto" },
  { name: "Transporte (Uber/Didi)", kind: "gasto" },
  { name: "Viáticos y comidas", kind: "gasto" },
  { name: "Honorarios externos", kind: "gasto" },
  { name: "Renta y servicios", kind: "gasto" },
  { name: "Notaría y trámites", kind: "gasto" },
  { name: "Compras generales", kind: "gasto" },
  { name: "Gastos personales socios", kind: "gasto" },
  { name: "Otros gastos", kind: "gasto" },
  { name: "Traspaso interno", kind: "neutral" },
  { name: "Impuestos de terceros", kind: "neutral" },
  { name: "Préstamos y aportaciones socios", kind: "neutral" },
];

const strip = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Etiquetas que ya usaba el área contable en la columna "Referencia" → categoría base. */
const REFERENCE_ALIASES: Record<string, string> = {
  uber: "Transporte (Uber/Didi)",
  didi: "Transporte (Uber/Didi)",
  plataformas: "Software y plataformas",
  publicidad: "Publicidad",
  "traspaso interno": "Traspaso interno",
  "prestacion comida": "Viáticos y comidas",
  compras: "Compras generales",
  "compras en linea": "Compras generales",
};

/**
 * Convierte la columna Referencia ya clasificada a mano ("Uber **3824", "Plataformas") en categoría.
 * Devuelve null para referencias de SPEI (números/hash largos) o vacías.
 */
export function categoryFromReference(reference: string | null | undefined): string | null {
  if (!reference) return null;
  const base = reference.replace(/\*+\s*\d{3,4}/g, "").replace(/\s+/g, " ").trim();
  if (base.length < 3 || base.length > 40) return null;
  if (/\d{5,}/.test(base) || !/^[\p{L}][\p{L}\s.&-]*$/u.test(base)) return null;
  const alias = REFERENCE_ALIASES[strip(base)];
  if (alias) return alias;
  if (/^compras?\b.*legal$/i.test(strip(base))) return "Compras generales";
  return base.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

const STOP = new Set([
  "compra", "compras", "con", "en", "de", "del", "la", "el", "los", "las", "por", "para", "spei", "stp", "td", "tc",
  "pago", "pagos", "deposito", "transferencia", "traspaso", "recibido", "enviado", "cargo", "abono", "sa", "cv", "sapi",
  "rl", "mex", "mx", "com", "www", "clabe", "ref", "referencia", "banco", "bancomer", "bbva", "hsbc", "afirme",
  "santander", "banorte", "nu", "inbursa", "scotiabank", "bankaool", "banregio", "azteca", "dlo", "rides",
  "serv", "una", "uno", "que", "mes", "y", "a", "al", "se", "servicio", "servicios", "factura", "fac", "folio",
]);

/** Tokens significativos de una descripción (comercios/personas). */
export function descriptionTokens(description: string): string[] {
  const cleaned = strip(description)
    .replace(/(^|\s)\*+\s*[a-z0-9]{3,}/g, " ")
    .replace(/[^a-z0-9\s]/g, " ");
  const out: string[] = [];
  for (const t of cleaned.split(/\s+/)) {
    if (t.length < 3 || STOP.has(t)) continue;
    if (/\d/.test(t)) continue; // folios, ids, montos
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 6);
}

/** Patrones que se aprenden de un movimiento: tokens, tarjeta, y dirección. */
export function extractPatterns(m: { description: string; reference?: string | null; debit: number; credit: number }): string[] {
  const dir = m.credit > 0 && m.debit === 0 ? "in" : "out";
  const patterns = descriptionTokens(m.description).map((t) => `t:${dir}:${t}`);
  const card = /\*{1,2}\s*(\d{4})/.exec(`${m.description} ${m.reference ?? ""}`);
  if (card) patterns.push(`card:${dir}:${card[1]}`);
  return patterns;
}

export interface Rule { pattern: string; category: string; hits: number }

export interface Suggestion {
  category: string;
  confidence: number; // 0..1
  evidence: number; // veces que el sistema vio este patrón
  autoApply: boolean;
}

/** Índice rápido: patrón -> categoría -> hits. */
export function buildRuleIndex(rules: Rule[]): Map<string, Map<string, number>> {
  const idx = new Map<string, Map<string, number>>();
  for (const r of rules) {
    let byCat = idx.get(r.pattern);
    if (!byCat) { byCat = new Map(); idx.set(r.pattern, byCat); }
    byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.hits);
  }
  return idx;
}

/**
 * Sugerencia de categoría: cada patrón vota por su categoría dominante con peso = pureza × evidencia.
 * `autoApply` solo si hay evidencia suficiente y consenso (para no clasificar sola en dudas).
 */
export function suggestCategory(
  m: { description: string; reference?: string | null; debit: number; credit: number },
  index: Map<string, Map<string, number>>,
): Suggestion | null {
  const votes = new Map<string, number>();
  let maxEvidence = 0;
  for (const p of extractPatterns(m)) {
    const byCat = index.get(p);
    if (!byCat) continue;
    let total = 0;
    byCat.forEach((h) => { total += h; });
    const strength = Math.min(1, Math.log2(total + 1) / 3); // 7+ muestras ≈ 1
    byCat.forEach((h, cat) => {
      const purity = h / total;
      votes.set(cat, (votes.get(cat) ?? 0) + purity * strength * (p.startsWith("card:") ? 0.6 : 1));
    });
    maxEvidence = Math.max(maxEvidence, total);
  }
  if (votes.size === 0) return null;
  let best = ""; let bestV = 0; let sum = 0;
  votes.forEach((v, c) => { sum += v; if (v > bestV) { bestV = v; best = c; } });
  const confidence = (bestV / sum) * Math.min(1, bestV);
  return { category: best, confidence, evidence: maxEvidence, autoApply: confidence >= 0.8 && maxEvidence >= 3 };
}

export interface NewCategoryProposal {
  key: string;
  suggestedName: string;
  count: number;
  total: number;
  movementIds: string[];
  sample: string;
  kind: CategoryKind;
}

/** Agrupa movimientos sin categoría útil por comercio/persona recurrente y propone crear una categoría. */
export function proposeNewCategories(
  movements: { id: string; description: string; reference?: string | null; debit: number; credit: number }[],
  minCount = 3,
): NewCategoryProposal[] {
  const groups = new Map<string, NewCategoryProposal>();
  for (const m of movements) {
    const toks = descriptionTokens(m.description);
    if (toks.length === 0) continue;
    const key = toks.slice(0, 2).join(" ");
    const g = groups.get(key) ?? {
      key, suggestedName: key.replace(/\b\p{L}/gu, (c) => c.toUpperCase()), count: 0, total: 0,
      movementIds: [], sample: m.description, kind: m.credit > m.debit ? "ingreso" : "gasto",
    };
    g.count++; g.total += m.credit > 0 ? m.credit : m.debit; g.movementIds.push(m.id);
    groups.set(key, g);
  }
  return [...groups.values()].filter((g) => g.count >= minCount).sort((a, b) => b.total - a.total).slice(0, 12);
}
