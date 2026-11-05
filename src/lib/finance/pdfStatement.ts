import { movementsFromRaw, norm, parseMovementDate, parseMoney, type ParsedSheet } from "./bankImport";

/** Fragmento de texto del PDF con su posición (x hacia la derecha, y hacia arriba, como en pdf.js). */
export interface PdfTextItem { str: string; x: number; y: number; width: number; page: number }

export interface PdfStatementResult {
  sheet: ParsedSheet | null;
  /** columnas = cargo/abono por posición bajo el encabezado; saldo = por el cambio de saldo entre renglones. */
  mode: "columnas" | "saldo" | null;
  /** Renglones con saldo contra los que se pudo comprobar la cadena (saldo anterior ± monto = saldo). */
  checked: number;
  chainOk: number;
  warnings: string[];
  finalBalance: number | null;
}

const MONEY = /^-?\(?\$?\s?-?\d{1,3}(,\d{3})*(\.\d{2})\)?$|^-?\(?\$?\s?-?\d+\.\d{2}\)?$/;
const isMoney = (s: string) => MONEY.test(s.trim());
const DATE_FULL = [
  /^\d{1,2}\s+de\s+[a-záéíóú.]+\s+(de\s+)?\d{4}$/i,
  /^\d{1,2}[\s/-]+[a-záéíóú.]{3,10}[\s/-]+\d{4}$/i,
  /^\d{4}-\d{2}-\d{2}$/,
  /^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/,
];
const DATE_NOYEAR = [/^\d{1,2}\s+(de\s+)?[a-záéíóú]{3,10}\.?$/i, /^\d{1,2}[/-][a-záéíóú]{3,10}\.?$/i, /^\d{1,2}[/-]\d{1,2}$/];
const STOP_LINE = /p[aá]gina|saldo (inicial|anterior|final|promedio|al corte)|total|periodo|clabe|rfc|estado de cuenta|resumen|fondeadora|banregio|folio fiscal/i;

function groupLines(items: PdfTextItem[]): PdfTextItem[][] {
  const lines: PdfTextItem[][] = [];
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  for (const pg of pages) {
    const its = items.filter((i) => i.page === pg && i.str.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);
    let cur: PdfTextItem[] = []; let curY = Number.NaN;
    for (const it of its) {
      if (cur.length && Math.abs(it.y - curY) > 3) { lines.push(cur.sort((a, b) => a.x - b.x)); cur = []; }
      if (!cur.length) curY = it.y;
      cur.push(it);
    }
    if (cur.length) lines.push(cur.sort((a, b) => a.x - b.x));
  }
  return lines;
}

function yearOf(items: PdfTextItem[]): number {
  const count = new Map<number, number>();
  for (const it of items) for (const m of it.str.matchAll(/\b(20\d{2})\b/g)) count.set(Number(m[1]), (count.get(Number(m[1])) ?? 0) + 1);
  let best = new Date().getFullYear(); let bn = 0;
  count.forEach((n, y) => { if (n > bn) { bn = n; best = y; } });
  return best;
}

/** Consume el prefijo más largo de la línea que sea una fecha. */
function takeDate(line: PdfTextItem[], defaultYear: number): { iso: string; used: number } | null {
  let best: { iso: string; used: number } | null = null;
  let acc = "";
  for (let k = 0; k < Math.min(line.length, 5); k++) {
    acc = `${acc} ${line[k].str}`.trim();
    const full = DATE_FULL.some((r) => r.test(acc));
    const noYear = !full && DATE_NOYEAR.some((r) => r.test(acc));
    if (!full && !noYear) continue;
    const iso = parseMovementDate(full ? acc : /[/-]\d{1,2}$/.test(acc) && /^\d/.test(acc) && !/[a-z]/i.test(acc) ? `${acc}/${defaultYear}` : `${acc.replace(/\.$/, "")} ${defaultYear}`);
    if (iso) best = { iso, used: k + 1 };
  }
  return best;
}

const toNum = (s: string): number => parseMoney(s) ?? 0;

/**
 * Convierte los textos posicionados de un estado de cuenta en movimientos. Sin muestra del banco,
 * se apoya en la estructura común (fecha al inicio, importes a la derecha) y valida con la cadena de saldos.
 */
export function parseStatementItems(items: PdfTextItem[]): PdfStatementResult {
  const warnings: string[] = [];
  const year = yearOf(items);
  const lines = groupLines(items);

  let cols: { debit?: number; credit?: number; balance?: number; reference?: number } = {};
  let opening: number | null = null;
  let finalBalance: number | null = null;
  interface Raw { date: string; description: string; reference: string | null; debit: number; credit: number; balance: number | null; amount: number | null; negative: boolean; hint: boolean }
  let raw: Raw[] = [];
  let mode: "columnas" | "saldo" | null = null;
  const amountAfter = (t: string, label: RegExp): number | null => {
    const m = new RegExp(`${label.source}[^\\d()-]*(\\(?-?\\$?\\s?-?[\\d,]+\\.\\d{2}\\)?)`, "i").exec(t);
    return m ? parseMoney(m[m.length - 1].replace(/\s/g, "")) : null;
  };

  for (const line of lines) {
    const text = line.map((i) => i.str).join(" ");
    const t = norm(text);

    // Encabezado de la tabla: guarda dónde está cada columna.
    const kw = { debit: /^(cargos?|retiros?|egresos?|debitos?|salidas?)$/, credit: /^(abonos?|depositos?|ingresos?|creditos?|entradas?)$/, balance: /^saldo$/ };
    const found: typeof cols = {};
    for (const it of line) {
      const w = norm(it.str);
      if (kw.debit.test(w)) found.debit = it.x + it.width / 2;
      else if (kw.credit.test(w)) found.credit = it.x + it.width / 2;
      else if (kw.balance.test(w)) found.balance = it.x + it.width / 2;
      else if (/^referencia$/.test(w)) found.reference = it.x - 3;
    }
    if ((found.debit !== undefined || found.credit !== undefined) && /fecha|descrip|concepto|detalle|referencia/.test(t)) { cols = found; continue; }

    const op = amountAfter(text, /saldo (inicial|anterior)/);
    if (/saldo (inicial|anterior)/.test(t) && op !== null) { opening = op; continue; }
    const fin = amountAfter(text, /saldo (final|al corte)/);
    if (/saldo (final|al corte)/.test(t) && fin !== null) { finalBalance = fin; continue; }

    const d = takeDate(line, year);
    const rest = d ? line.slice(d.used) : line;
    const amounts = rest.filter((i) => isMoney(i.str));
    const textItems = rest.filter((i) => !isMoney(i.str));
    const refItems = cols.reference !== undefined ? textItems.filter((i) => i.x >= (cols.reference as number)) : [];
    const words = textItems.filter((i) => !refItems.includes(i)).map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
    const reference = refItems.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim() || null;

    if (d && amounts.length > 0 && words) {
      if (cols.debit !== undefined || cols.credit !== undefined) {
        mode = mode ?? "columnas";
        let debit = 0; let credit = 0; let balance: number | null = null;
        for (const a of amounts) {
          const c = a.x + a.width / 2; const v = Math.abs(toNum(a.str));
          const dist = (x?: number) => (x === undefined ? Infinity : Math.abs(c - x));
          const best = Math.min(dist(cols.debit), dist(cols.credit), dist(cols.balance));
          if (best === dist(cols.balance)) balance = toNum(a.str);
          else if (best === dist(cols.debit)) debit += v;
          else credit += v;
        }
        if (debit === 0 && credit === 0) continue;
        raw.push({ date: d.iso, description: words, reference, debit, credit, balance, amount: null, negative: false, hint: false });
      } else {
        mode = mode ?? "saldo";
        const balance = amounts.length >= 2 ? toNum(amounts[amounts.length - 1].str) : null;
        const amtItem = amounts.length >= 2 ? amounts[amounts.length - 2] : amounts[0];
        raw.push({ date: d.iso, description: words, reference, debit: 0, credit: 0, balance, amount: Math.abs(toNum(amtItem.str)), negative: /^-|^\(/.test(amtItem.str.trim()), hint: false });
      }
      continue;
    }

    // Línea sin fecha ni importes: continuación de la descripción anterior.
    if (!d && amounts.length === 0 && raw.length && text.length < 90 && !STOP_LINE.test(t) && !/^\d+$/.test(text.trim())) {
      const last = raw[raw.length - 1];
      if (last.description.length < 200) last.description = `${last.description} ${words}`.trim();
    }
  }

  if (raw.length === 0) {
    return { sheet: null, mode: null, checked: 0, chainOk: 0, warnings: ["No encontré movimientos en el PDF. Puede ser un PDF escaneado (imagen) o un formato distinto."], finalBalance };
  }

  // Modo saldo: sin columnas de cargo/abono, el signo sale del cambio de saldo, en orden cronológico.
  if (mode === "saldo") {
    if (raw[0].date > raw[raw.length - 1].date) raw = [...raw].reverse();
    let prev = opening;
    for (const r of raw) {
      const v = r.amount ?? 0;
      if (r.balance !== null && prev !== null) {
        const asCredit = Math.abs(prev + v - r.balance) < 0.02; const asDebit = Math.abs(prev - v - r.balance) < 0.02;
        if (asCredit && !asDebit) r.credit = v; else if (asDebit && !asCredit) r.debit = v; else r.hint = true;
      } else r.hint = true;
      if (r.hint) {
        if (r.negative || /retiro|compra|pago|cargo|comisi|spei a |transferencia a |mensualidad/i.test(r.description)) r.debit = v; else r.credit = v;
      }
      if (r.balance !== null) prev = r.balance;
    }
    if (raw.some((r) => r.hint)) warnings.push("Algunos importes no traían columna ni saldo anterior para saber si son cargo o abono; se dedujeron por el signo o la descripción. Revísalos en la vista previa.");
  }

  const movements = movementsFromRaw(raw.filter((r) => r.debit > 0 || r.credit > 0).map((r) => ({ date: r.date, description: r.description, reference: r.reference, debit: r.debit, credit: r.credit, balance: r.balance })));

  // Comprobación de la cadena de saldos en orden cronológico.
  let checked = 0; let chainOk = 0; let prev = opening;
  for (const m of movements) {
    if (m.balance !== null && prev !== null) { checked++; if (Math.abs(prev + m.credit - m.debit - m.balance) < 0.02) chainOk++; }
    if (m.balance !== null) prev = m.balance;
  }
  if (checked > 0 && chainOk < checked) warnings.push(`El saldo cuadra en ${chainOk} de ${checked} renglones: puede haber movimientos mal leídos o faltantes. Revisa la vista previa.`);
  if (checked === 0) warnings.push("No pude comprobar los saldos (el PDF no trae saldo por renglón o falta el saldo inicial). Revisa la vista previa con cuidado.");

  return { sheet: { sheetName: "PDF", openingBalance: opening, movements, skippedRows: 0 }, mode, checked, chainOk, warnings, finalBalance };
}

/** Lee el PDF en el navegador con pdf.js y devuelve los textos con su posición. */
export async function extractPdfItems(buf: ArrayBuffer): Promise<PdfTextItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfjs: any = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const workerMod = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const out: PdfTextItem[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    for (const it of content.items as { str?: string; transform?: number[]; width?: number }[]) {
      if (!it.str || !it.transform) continue;
      out.push({ str: it.str, x: it.transform[4], y: it.transform[5], width: it.width ?? 0, page: p });
    }
  }
  return out;
}

export async function parsePdfStatement(file: File): Promise<PdfStatementResult> {
  return parseStatementItems(await extractPdfItems(await file.arrayBuffer()));
}
