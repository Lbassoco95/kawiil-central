import * as XLSX from "xlsx";

export interface ParsedBankTx {
  date: string; // YYYY-MM-DD
  description: string;
  /** positivo = abono (entra), negativo = cargo (sale) */
  amount: number;
  balance: number | null;
}

export interface ParsedStatement {
  transactions: ParsedBankTx[];
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  /** Filas que no se pudieron leer (para avisar sin bloquear). */
  skipped: number;
}

const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export function parseMoney(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v == null) return null;
  let s = String(v).trim();
  if (!s || s === "-") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/-\s*$/.test(s)) {
    negative = true;
    s = s.replace(/-\s*$/, "");
  }
  if (/^-/.test(s)) {
    negative = true;
    s = s.replace(/^-/, "");
  }
  s = s.replace(/[^0-9.,]/g, "");
  if (!s) return null;
  // Formato MX/US: coma = miles, punto = decimales. Si solo hay coma y 1-2 decimales, es europeo.
  if (/,\d{1,2}$/.test(s) && !s.includes(".")) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const MONTHS: Record<string, number> = {
  ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6,
  jul: 7, ago: 8, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dic: 12, dec: 12,
};

const iso = (y: number, m: number, d: number) => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

export function parseBankDate(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : iso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null;
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(v).trim();
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/.exec(s);
  if (m) {
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return iso(y, +m[2], +m[1]); // día/mes/año (México)
  }
  m = /^(\d{1,2})[\s\-/]+([a-zA-Z]{3,5})\.?[\s\-/,]+(\d{2,4})/.exec(norm(s));
  if (m) {
    const mo = MONTHS[m[2]];
    if (mo) return iso(+m[3] < 100 ? 2000 + +m[3] : +m[3], mo, +m[1]);
  }
  return null;
}

type Cols = {
  date: number;
  desc: number;
  debit: number;
  credit: number;
  amount: number;
  balance: number;
};

function detectColumns(row: unknown[]): Cols | null {
  const cols: Cols = { date: -1, desc: -1, debit: -1, credit: -1, amount: -1, balance: -1 };
  row.forEach((cell, i) => {
    const h = norm(cell);
    if (!h) return;
    if (cols.date < 0 && /^fecha|date/.test(h)) cols.date = i;
    else if (cols.desc < 0 && /(descripcion|concepto|detalle|referencia|movimiento|description)/.test(h)) cols.desc = i;
    else if (cols.debit < 0 && /(cargo|retiro|debito|egreso|withdrawal|debit)/.test(h)) cols.debit = i;
    else if (cols.credit < 0 && /(abono|deposito|credito|ingreso|credit|deposit)/.test(h)) cols.credit = i;
    else if (cols.balance < 0 && /saldo|balance/.test(h)) cols.balance = i;
    else if (cols.amount < 0 && /(monto|importe|amount)/.test(h)) cols.amount = i;
  });
  const hasMoney = cols.amount >= 0 || cols.debit >= 0 || cols.credit >= 0;
  return cols.date >= 0 && hasMoney ? cols : null;
}

/** Convierte filas crudas (CSV/XLSX) en movimientos. Exportada para pruebas. */
export function parseStatementRows(rows: unknown[][]): ParsedStatement {
  let headerIdx = -1;
  let cols: Cols | null = null;
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const c = detectColumns(rows[i] ?? []);
    if (c) {
      headerIdx = i;
      cols = c;
      break;
    }
  }
  if (!cols) {
    throw new Error(
      "No encontramos las columnas del estado de cuenta. Necesitamos al menos Fecha y Monto (o Cargo/Abono).",
    );
  }

  const txs: ParsedBankTx[] = [];
  let skipped = 0;
  for (const row of rows.slice(headerIdx + 1)) {
    if (!row || row.every((c) => c == null || String(c).trim() === "")) continue;
    const date = parseBankDate(row[cols.date]);
    let amount: number | null = null;
    if (cols.debit >= 0 || cols.credit >= 0) {
      const debit = cols.debit >= 0 ? parseMoney(row[cols.debit]) : null;
      const credit = cols.credit >= 0 ? parseMoney(row[cols.credit]) : null;
      if (debit != null || credit != null) amount = (credit ?? 0) - Math.abs(debit ?? 0);
    }
    if (amount == null && cols.amount >= 0) amount = parseMoney(row[cols.amount]);
    if (!date || amount == null || amount === 0) {
      // filas de totales/encabezados repetidos no cuentan como error si no tienen fecha
      if (date || amount) skipped++;
      continue;
    }
    txs.push({
      date,
      description: cols.desc >= 0 ? String(row[cols.desc] ?? "").replace(/\s+/g, " ").trim() : "",
      amount: Math.round(amount * 100) / 100,
      balance: cols.balance >= 0 ? parseMoney(row[cols.balance]) : null,
    });
  }

  if (txs.length === 0) throw new Error("El archivo no trae movimientos que podamos leer.");

  const dates = txs.map((t) => t.date).sort();
  // El archivo puede venir del más nuevo al más viejo o al revés: ordenamos por fecha conservando orden relativo.
  const ordered = [...txs].sort((a, b) => a.date.localeCompare(b.date));
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const hasBalance = ordered.some((t) => t.balance != null);
  // Si el archivo está en orden descendente, el último del mismo día está al inicio del arreglo original.
  const descending = txs.length > 1 && txs[0].date > txs[txs.length - 1].date;
  const sameDayLast = descending ? txs[0] : last;
  const sameDayFirst = descending ? txs[txs.length - 1] : first;
  const closing = hasBalance ? sameDayLast.balance : null;
  const opening =
    hasBalance && sameDayFirst.balance != null
      ? Math.round((sameDayFirst.balance - sameDayFirst.amount) * 100) / 100
      : null;

  return {
    transactions: ordered,
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    openingBalance: opening,
    closingBalance: closing,
    skipped,
  };
}

export async function parseStatementFile(file: File): Promise<ParsedStatement> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    throw new Error(
      "Por ahora leemos estados de cuenta en Excel o CSV (casi todos los bancos permiten descargarlos así). El PDF se puede guardar como respaldo.",
    );
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true, raw: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("El archivo está vacío.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
  return parseStatementRows(rows);
}

/** Clave estable para no duplicar el mismo movimiento si se sube dos veces. */
export function txDedupeKey(t: ParsedBankTx, occurrence: number): string {
  return `${t.date}|${t.amount.toFixed(2)}|${norm(t.description).slice(0, 80)}|${t.balance ?? ""}|${occurrence}`;
}

export function withDedupeKeys(txs: ParsedBankTx[]): Array<ParsedBankTx & { dedupe_key: string }> {
  const seen = new Map<string, number>();
  return txs.map((t) => {
    const base = txDedupeKey(t, 0).replace(/\|0$/, "");
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...t, dedupe_key: `${base}|${n}` };
  });
}
