import * as XLSX from "xlsx";
import { norm, parseMoney, parseMovementDate } from "./bankImport";

export type CommitmentKind = "notaria" | "planeado" | "por_cobrar" | "impuesto_tercero";

export interface ParsedCommitment {
  kind: CommitmentKind;
  direction: "pagar" | "cobrar";
  counterparty: string | null;
  concept: string;
  amount: number; // MXN
  currency: string;
  originalAmount: number | null;
  fxRate: number | null;
  dueDate: string | null;
  status: "pendiente" | "pagado";
  category: string | null;
  notes: string | null;
  externalKey: string;
  sheetName: string;
}

type Rows = unknown[][];
const cell = (r: unknown[], i: number | undefined) => (i === undefined ? undefined : r[i]);
const text = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim();
const isPaid = (v: unknown) => /pagad|cobrad|liquid/.test(norm(v));
const MONTHS_ES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const monthLabel = (iso: string) => `${MONTHS_ES[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** Busca la primera fila cuyas celdas contengan todos los encabezados pedidos; devuelve índices de columna. */
function findHeader(rows: Rows, names: string[], from = 0): { row: number; cols: Record<string, number> } | null {
  for (let i = from; i < rows.length; i++) {
    const cols: Record<string, number> = {};
    (rows[i] ?? []).forEach((c, j) => {
      const h = norm(c);
      for (const n of names) if (cols[n] === undefined && (h === n || h.startsWith(n))) cols[n] = j;
    });
    if (names.every((n) => cols[n] !== undefined)) return { row: i, cols };
  }
  return null;
}

function parseNotaria(rows: Rows, sheet: string): ParsedCommitment[] {
  const h = findHeader(rows, ["servicio", "cliente", "precio notaria", "estatus"]);
  if (!h) return [];
  const out: ParsedCommitment[] = [];
  const seen = new Map<string, number>();
  for (let i = h.row + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const price = parseMoney(r[h.cols["precio notaria"]]);
    if (!price) continue;
    const servicio = text(r[h.cols.servicio]) || "trámite pendiente";
    const cliente = text(r[h.cols.cliente]) || null;
    const charged = parseMoney(cell(r, findHeader([rows[h.row]], ["monto cobrado"])?.cols["monto cobrado"]));
    const base = `notaria|${norm(cliente)}|${norm(servicio)}|${price}`;
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    out.push({
      kind: "notaria", direction: "pagar", counterparty: cliente, concept: `Notaría – ${servicio}`,
      amount: price, currency: "MXN", originalAmount: null, fxRate: null, dueDate: null,
      status: isPaid(r[h.cols.estatus]) ? "pagado" : "pendiente", category: "Notaría y trámites",
      notes: charged ? `Cobrado al cliente: $${charged.toLocaleString("es-MX")}` : null,
      externalKey: `${base}#${n}`, sheetName: sheet,
    });
  }
  return out;
}

/** Tabla CONCEPTO | FECHA DE PAGO | MONTO (ej. hoja NAVIDAD). */
function parsePlaneado(rows: Rows, sheet: string): ParsedCommitment[] {
  const h = findHeader(rows, ["concepto", "fecha de pago", "monto"]);
  if (!h) return [];
  const out: ParsedCommitment[] = [];
  for (let i = h.row + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const concept = text(r[h.cols.concepto]);
    if (!concept) break;
    const amount = parseMoney(r[h.cols.monto]);
    const due = parseMovementDate(r[h.cols["fecha de pago"]]);
    if (!amount || !due) continue;
    const title = concept.charAt(0).toUpperCase() + concept.slice(1).toLowerCase();
    out.push({
      kind: "planeado", direction: "pagar", counterparty: null, concept: `${title} (${sheet.toLowerCase()})`,
      amount, currency: "MXN", originalAmount: null, fxRate: null, dueDate: due, status: "pendiente",
      category: /navidad/i.test(sheet) ? "Navidad y fin de año" : null, notes: null,
      externalKey: `plan|${norm(sheet)}|${norm(concept)}|${due}|${amount}`, sheetName: sheet,
    });
  }
  return out;
}

/** Bloques «EMPRESA: X / MONTO MENSUAL: 250 USD» con tabla FECHA DE PAGO | MONTO | T.C | SALDO. */
function parsePorCobrar(rows: Rows, sheet: string): ParsedCommitment[] {
  const out: ParsedCommitment[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const labelIdx = r.findIndex((c) => norm(c).startsWith("empresa"));
    if (labelIdx < 0) continue;
    const company = text(r.slice(labelIdx + 1).find((c) => text(c)));
    let currency = "MXN";
    for (let k = i + 1; k < Math.min(i + 6, rows.length); k++) {
      const m = (rows[k] ?? []).map(text).find((t) => /\d/.test(t) && /(usd|mxn|eur)/i.test(t) && /mensual/i.test(norm((rows[k] ?? []).join(" "))));
      if (m) { currency = /usd/i.test(m) ? "USD" : /eur/i.test(m) ? "EUR" : "MXN"; break; }
    }
    const h = findHeader(rows, ["fecha de pago", "monto", "saldo"], i);
    if (!h) continue;
    const fxCol = (rows[h.row] ?? []).findIndex((c) => /^t\.?c/.test(norm(c)));
    for (let k = h.row + 1; k < rows.length; k++) {
      const rr = rows[k] ?? [];
      const date = parseMovementDate(rr[h.cols["fecha de pago"]]);
      if (!date) break;
      const monto = parseMoney(rr[h.cols.monto]);
      const saldo = parseMoney(rr[h.cols.saldo]);
      if (!monto || !saldo || saldo <= 0) continue;
      out.push({
        kind: "por_cobrar", direction: "cobrar", counterparty: company, concept: `Mensualidad ${monthLabel(date)}`,
        amount: saldo, currency, originalAmount: monto, fxRate: fxCol >= 0 ? parseMoney(rr[fxCol]) : null,
        dueDate: date, status: "pendiente", category: "Cobranza clientes", notes: "Monto convertido con T.C. del último día del mes",
        externalKey: `cobrar|${norm(company)}|${date}|${monto}`, sheetName: sheet,
      });
    }
  }
  return out;
}

/** Tabla de obligaciones fiscales de terceros: MES | IMPUESTO | MONTO | FECHA DE DEPOSITO | FECHA DE PAGO | ESTATUS. */
function parseImpuestos(rows: Rows, sheet: string): ParsedCommitment[] {
  const h = findHeader(rows, ["mes", "impuesto", "monto"]);
  if (!h) return [];
  const payCol = (rows[h.row] ?? []).findIndex((c) => norm(c) === "fecha de pago");
  const statusCol = (rows[h.row] ?? []).findIndex((c) => norm(c) === "estatus");
  const out: ParsedCommitment[] = [];
  for (let i = h.row + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    const mes = parseMovementDate(r[h.cols.mes]);
    const imp = text(r[h.cols.impuesto]);
    const amount = parseMoney(r[h.cols.monto]);
    if (!mes || !imp || !amount) continue;
    out.push({
      kind: "impuesto_tercero", direction: "pagar", counterparty: null, concept: `${imp} ${monthLabel(mes)}`,
      amount, currency: "MXN", originalAmount: null, fxRate: null, dueDate: payCol >= 0 ? parseMovementDate(r[payCol]) : null,
      status: statusCol >= 0 && isPaid(r[statusCol]) ? "pagado" : "pendiente", category: "Impuestos de terceros",
      notes: `Tesorería de terceros · hoja ${sheet}`, externalKey: `imp|${norm(sheet)}|${mes}|${norm(imp)}|${amount}`, sheetName: sheet,
    });
  }
  return out;
}

export function parseCommitmentsBuffer(buf: ArrayBuffer): ParsedCommitment[] {
  const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
  const out: ParsedCommitment[] = [];
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: false });
    out.push(...parseNotaria(rows, name), ...parsePlaneado(rows, name), ...parsePorCobrar(rows, name), ...parseImpuestos(rows, name));
  }
  return out;
}

export const COMMITMENT_KIND_LABEL: Record<CommitmentKind, string> = {
  notaria: "Pagos de notaría", planeado: "Pagos planeados (ej. Navidad)", por_cobrar: "Clientes por cobrar", impuesto_tercero: "Impuestos de terceros por mes",
};
