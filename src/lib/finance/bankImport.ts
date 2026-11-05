import * as XLSX from "xlsx";

/** Movimiento bancario normalizado, listo para guardarse en finance_movements. */
export interface ParsedMovement {
  date: string; // YYYY-MM-DD
  description: string;
  reference: string | null;
  debit: number; // cargo
  credit: number; // abono
  balance: number | null;
  observation: string | null;
  /** Posición de la fila en la hoja (orden original). */
  seq: number;
  dedupeKey: string;
}

export interface ParsedSheet {
  sheetName: string;
  openingBalance: number | null;
  movements: ParsedMovement[];
  skippedRows: number;
}

const MONTHS: Record<string, number> = {
  ene: 1, enero: 1, feb: 2, febrero: 2, mar: 3, marzo: 3, abr: 4, abril: 4,
  may: 5, mayo: 5, jun: 6, junio: 6, jul: 7, julio: 7, ago: 8, agosto: 8,
  sep: 9, sept: 9, septiembre: 9, set: 9, oct: 10, octubre: 10,
  nov: 11, noviembre: 11, dic: 12, diciembre: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

export function toIsoDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Acepta Date, serial de Excel, "01 de ene 2026", "2026-01-31", "31/01/2026". */
export function parseMovementDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // SheetJS (cellDates) entrega la hora local del libro; usamos componentes locales.
    return toIsoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number") {
    if (value > 30000 && value < 80000) {
      const p = XLSX.SSF.parse_date_code(value);
      return p ? toIsoDate(p.y, p.m, p.d) : null;
    }
    return null;
  }
  const s = String(value).trim().toLowerCase().replace(/\./g, "");
  let m = /^(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(?:de\s+)?(\d{4})$/.exec(s);
  if (m) {
    const mon = MONTHS[m[2].normalize("NFD").replace(/[̀-ͯ]/g, "")];
    return mon ? toIsoDate(Number(m[3]), mon, Number(m[1])) : null;
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return toIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return toIsoDate(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})\s+([a-z]{3,10})\s+(\d{4})$/.exec(s);
  if (m && MONTHS[m[2]]) return toIsoDate(Number(m[3]), MONTHS[m[2]], Number(m[1]));
  return null;
}

/** Acepta números o textos como "$1,234.50", "(500.00)", "-". Devuelve null si no es número. */
export function parseMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  let s = String(value).trim();
  if (!s || s === "-") return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  s = s.replace(/[$\s]|MXN|USD/gi, "").replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return neg ? -n : n;
}

export const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

type ColKey = "date" | "description" | "reference" | "debit" | "credit" | "balance" | "amount" | "observation";

function detectColumns(row: unknown[]): Partial<Record<ColKey, number>> | null {
  const cols: Partial<Record<ColKey, number>> = {};
  row.forEach((cell, i) => {
    const h = norm(cell);
    if (!h) return;
    const set = (k: ColKey) => { if (cols[k] === undefined) cols[k] = i; };
    if (h.startsWith("fecha") && !/pago|deposito|vencim/.test(h)) set("date");
    else if (h.startsWith("observ")) set("observation");
    else if (h.startsWith("descrip") || h === "concepto" || h === "detalle") set("description");
    else if (h.startsWith("referen")) set("reference");
    else if (h === "cargo" || h === "cargos" || h === "retiro" || h === "retiros" || h === "egreso") set("debit");
    else if (h === "abono" || h === "abonos" || h === "deposito" || h === "depositos" || h === "ingreso") set("credit");
    else if (h === "saldo") set("balance");
    else if (h === "monto" || h === "importe") set("amount");
  });
  const hasMoney = cols.debit !== undefined || cols.credit !== undefined || cols.amount !== undefined;
  return cols.date !== undefined && cols.description !== undefined && hasMoney ? cols : null;
}

function buildMovements(
  rows: unknown[][],
  cols: Partial<Record<ColKey, number>>,
  startRow: number,
): { movements: ParsedMovement[]; skipped: number } {
  const movements: ParsedMovement[] = [];
  const seen = new Map<string, number>();
  let skipped = 0;
  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r] ?? [];
    const date = parseMovementDate(row[cols.date!]);
    const description = String(row[cols.description!] ?? "").replace(/\s+/g, " ").trim();
    if (!date || !description) {
      if (row.some((c) => c != null && String(c).trim() !== "")) skipped++;
      continue;
    }
    let debit = cols.debit !== undefined ? parseMoney(row[cols.debit]) ?? 0 : 0;
    let credit = cols.credit !== undefined ? parseMoney(row[cols.credit]) ?? 0 : 0;
    if (cols.amount !== undefined && debit === 0 && credit === 0) {
      const a = parseMoney(row[cols.amount]) ?? 0;
      if (a < 0) debit = -a; else credit = a;
    }
    if (debit < 0) { credit += -debit; debit = 0; }
    if (credit < 0) { debit += -credit; credit = 0; }
    if (debit === 0 && credit === 0) { skipped++; continue; }
    const refRaw = cols.reference !== undefined ? String(row[cols.reference] ?? "").trim() : "";
    const balance = cols.balance !== undefined ? parseMoney(row[cols.balance]) : null;
    const obs = cols.observation !== undefined ? String(row[cols.observation] ?? "").replace(/\s+/g, " ").trim() : "";
    const base = [date, norm(description).slice(0, 140), norm(refRaw).slice(0, 60), debit.toFixed(2), credit.toFixed(2)].join("|");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    movements.push({
      date, description, reference: refRaw || null, debit, credit,
      balance: balance == null ? null : balance,
      observation: obs || null,
      seq: r,
      dedupeKey: `${base}#${n}`,
    });
  }
  return { movements, skipped };
}

function parseRows(rows: unknown[][], sheetName: string): ParsedSheet | null {
  let openingBalance: number | null = null;
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i] ?? [];
    const labelIdx = row.findIndex((c) => /^saldo (inicial|a favor)/.test(norm(c)));
    if (labelIdx >= 0 && openingBalance === null) {
      const val = row.slice(labelIdx + 1).map(parseMoney).find((v) => v !== null);
      if (val != null) openingBalance = val;
    }
    const cols = detectColumns(row);
    if (cols) {
      const { movements, skipped } = buildMovements(rows, cols, i + 1);
      return { sheetName, openingBalance, movements, skippedRows: skipped };
    }
  }
  return null;
}

/** Lee un libro de Excel/CSV y devuelve las hojas que parecen estado de cuenta. */
export async function parseBankWorkbook(file: File): Promise<ParsedSheet[]> {
  return parseBankBuffer(await file.arrayBuffer());
}

export function parseBankBuffer(buf: ArrayBuffer): ParsedSheet[] {
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
  const out: ParsedSheet[] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
    const parsed = parseRows(rows, name);
    if (parsed && parsed.movements.length > 0) out.push(parsed);
  }
  return out;
}

/**
 * Texto copiado y pegado desde la app del banco (columnas separadas por tab, ; o |).
 * Con encabezado usa los nombres; sin encabezado asume: Fecha, Descripción, [Referencia], Cargo, Abono, [Saldo].
 */
export function parsePastedMovements(text: string): ParsedSheet | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return null;
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : lines.some((l) => l.includes("|")) ? "|" : ";";
  const rows = lines.map((l) => l.split(sep).map((c) => c.trim()));
  const withHeader = parseRows(rows, "Pegado");
  if (withHeader) return withHeader;
  const width = Math.max(...rows.map((r) => r.length));
  const cols: Partial<Record<ColKey, number>> =
    width >= 6 ? { date: 0, description: 1, reference: 2, debit: 3, credit: 4, balance: 5 }
    : width === 5 ? { date: 0, description: 1, debit: 2, credit: 3, balance: 4 }
    : width === 4 ? { date: 0, description: 1, debit: 2, credit: 3 }
    : width === 3 ? { date: 0, description: 1, amount: 2 }
    : {};
  if (cols.date === undefined) return null;
  const { movements, skipped } = buildMovements(rows, cols, 0);
  return movements.length ? { sheetName: "Pegado", openingBalance: null, movements, skippedRows: skipped } : null;
}

/** Nombre de cuenta sugerido a partir del nombre de la hoja ("Fondeadora", "Banregio"…). */
export function suggestAccountName(sheetName: string): string {
  return sheetName.trim().replace(/^estado de cuenta\s*-?\s*/i, "") || sheetName;
}
