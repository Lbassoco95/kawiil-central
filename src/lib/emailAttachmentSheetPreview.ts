/** Límite de tamaño para vista previa en memoria (DOCX, hojas de cálculo, CSV, etc.). */
export const EMAIL_ATTACHMENT_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;

const MAX_PREVIEW_ROWS = 400;
const MAX_PREVIEW_COLS = 48;

export type EmailSheetPreviewData = {
  sheetName: string;
  rows: string[][];
  truncatedRows: boolean;
  truncatedCols: boolean;
  extraSheets: number;
};

function stringifyCell(v: unknown): string {
  if (v == null || v === "") return "";
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? "" : v.toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return String(v);
}

function sniffCsvDelimiter(firstLine: string): string {
  const commas = (firstLine.match(/,/g) || []).length;
  const semis = (firstLine.match(/;/g) || []).length;
  if (semis > commas) return ";";
  return ",";
}

/**
 * Primera hoja del libro, truncada para UI. CSV/TSV como un solo «libro» de una hoja.
 */
export async function buildEmailSheetPreview(blob: Blob, fileName: string): Promise<EmailSheetPreviewData> {
  const XLSX = await import("xlsx");
  const nameLower = fileName.trim().toLowerCase();
  const mime = (blob.type || "").toLowerCase();

  const isTsv = nameLower.endsWith(".tsv");
  const isCsv =
    nameLower.endsWith(".csv") ||
    mime.includes("csv") ||
    mime === "text/comma-separated-values";

  let wb: import("xlsx").WorkBook;

  if (isTsv) {
    const text = await blob.text();
    wb = XLSX.read(text, { type: "string", FS: "\t", raw: false });
  } else if (isCsv) {
    const text = await blob.text();
    const firstNl = text.indexOf("\n");
    const firstLine = (firstNl === -1 ? text : text.slice(0, firstNl)).replace(/\r$/, "");
    const delim = sniffCsvDelimiter(firstLine);
    wb = XLSX.read(text, { type: "string", FS: delim, raw: false });
  } else {
    const buf = await blob.arrayBuffer();
    wb = XLSX.read(buf, { type: "array", cellDates: true });
  }

  if (!wb.SheetNames?.length) {
    throw new Error("El archivo no contiene hojas legibles.");
  }

  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error("No se pudo leer la primera hoja.");

  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];

  const allRows = matrix.map((row) =>
    (Array.isArray(row) ? row : []).map((c) => stringifyCell(c)),
  );

  let maxCol = 0;
  for (const r of allRows) maxCol = Math.max(maxCol, r.length);

  const truncatedCols = maxCol > MAX_PREVIEW_COLS;
  const colLimit = Math.min(maxCol, MAX_PREVIEW_COLS);

  const truncatedRows = allRows.length > MAX_PREVIEW_ROWS;
  const rowLimit = Math.min(allRows.length, MAX_PREVIEW_ROWS);

  const rows: string[][] = [];
  for (let i = 0; i < rowLimit; i++) {
    const r = allRows[i] ?? [];
    const slice = r.slice(0, colLimit).map((c) => c ?? "");
    while (slice.length < colLimit) slice.push("");
    rows.push(slice);
  }

  return {
    sheetName,
    rows,
    truncatedRows,
    truncatedCols,
    extraSheets: Math.max(0, wb.SheetNames.length - 1),
  };
}
