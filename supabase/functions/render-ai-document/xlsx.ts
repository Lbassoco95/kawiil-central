// @ts-ignore: npm:exceljs types may not resolve perfectly in Deno.
import ExcelJS from "npm:exceljs@4.4.0";
import {
  type FinancialReportData,
  type InvoiceData,
  type KawiilTable,
  type KawiilTemplateKey,
  KAWIIL_BRAND,
  type ProposalData,
  resolveBranding,
} from "../_shared/ai-templates/index.ts";
import { formatCurrency } from "./common.ts";

/**
 * Genera XLSX con estilos Kawiil (header azul + filas alternadas).
 * Útil principalmente para propuesta / factura / reporte financiero.
 * Para otros templates genera una hoja con los datos planos.
 */

const BRAND_ARGB = `FF${KAWIIL_BRAND.tableHeaderBg.replace("#", "")}`;
const ROW_ALT_ARGB = `FF${KAWIIL_BRAND.tableRowAlt.replace("#", "")}`;
const BORDER_ARGB = `FF${KAWIIL_BRAND.borderSoft.replace("#", "")}`;

// deno-lint-ignore no-explicit-any
type AnyWs = any;

function styleHeaderRow(ws: AnyWs, rowIdx: number, cols: number) {
  const row = ws.getRow(rowIdx);
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_ARGB } };
    cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: BORDER_ARGB } },
      bottom: { style: "thin", color: { argb: BORDER_ARGB } },
      left: { style: "thin", color: { argb: BORDER_ARGB } },
      right: { style: "thin", color: { argb: BORDER_ARGB } },
    };
  }
  row.height = 22;
}

function styleDataRow(ws: AnyWs, rowIdx: number, cols: number, alt: boolean) {
  const row = ws.getRow(rowIdx);
  for (let c = 1; c <= cols; c++) {
    const cell = row.getCell(c);
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "hair", color: { argb: BORDER_ARGB } },
      bottom: { style: "hair", color: { argb: BORDER_ARGB } },
      left: { style: "hair", color: { argb: BORDER_ARGB } },
      right: { style: "hair", color: { argb: BORDER_ARGB } },
    };
    if (alt) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ROW_ALT_ARGB } };
    }
  }
}

function addKawiilTable(ws: AnyWs, startRow: number, table: KawiilTable): number {
  const cols = Math.max(table.headers?.length || 0, ...(table.rows || []).map((r) => r.length));
  if (!cols) return startRow;

  let row = startRow;
  if (table.headers?.length) {
    const headerRow = ws.getRow(row);
    table.headers.forEach((h, i) => {
      headerRow.getCell(i + 1).value = h;
    });
    styleHeaderRow(ws, row, cols);
    row++;
  }

  (table.rows || []).forEach((r, rIdx) => {
    const dataRow = ws.getRow(row);
    for (let c = 0; c < cols; c++) {
      const val = r[c] ?? "";
      dataRow.getCell(c + 1).value = val;
    }
    styleDataRow(ws, row, cols, rIdx % 2 === 1);
    row++;
  });

  // Auto width cap.
  for (let c = 1; c <= cols; c++) {
    const col = ws.getColumn(c);
    let max = 10;
    col.eachCell({ includeEmpty: false }, (cell: AnyWs) => {
      const v = cell.value;
      const len = v == null ? 0 : String(v).length;
      if (len > max) max = len;
    });
    col.width = Math.min(48, Math.max(10, max + 2));
  }

  return row + 1;
}

function titleCell(ws: AnyWs, title: string, subtitle: string) {
  ws.mergeCells(1, 1, 1, 6);
  const titleRow = ws.getRow(1);
  titleRow.getCell(1).value = title;
  titleRow.getCell(1).font = { bold: true, size: 16, color: { argb: `FF${KAWIIL_BRAND.accent.replace("#", "")}` } };
  titleRow.height = 26;
  ws.mergeCells(2, 1, 2, 6);
  const subRow = ws.getRow(2);
  subRow.getCell(1).value = subtitle;
  subRow.getCell(1).font = { italic: true, size: 10, color: { argb: `FF${KAWIIL_BRAND.textMuted.replace("#", "")}` } };
}

function buildProposalXlsx(wb: AnyWs, title: string, data: ProposalData) {
  const ws = wb.addWorksheet("Propuesta");
  titleCell(ws, title, "Propuesta comercial · Kawiil");
  let row = 4;

  if (data.client?.length) {
    row = addKawiilTable(ws, row, {
      headers: ["Dato del cliente", "Valor"],
      rows: data.client.map((kv) => [kv.label, kv.value]),
    });
  }
  const currency = data.currency || "MXN";
  row = addKawiilTable(ws, row, {
    headers: ["Descripción", "Cantidad", "P. Unitario", "Importe"],
    rows: data.line_items.map((li) => [
      li.description,
      li.quantity ?? "",
      li.unit_price ?? "",
      li.amount ?? (li.quantity !== undefined && li.unit_price !== undefined ? li.quantity * li.unit_price : ""),
    ]),
  });
  if (data.subtotal !== undefined || data.taxes !== undefined || data.total !== undefined) {
    const totalsRows: [string, string][] = [];
    if (data.subtotal !== undefined) totalsRows.push(["Subtotal", formatCurrency(data.subtotal, currency)]);
    if (data.taxes !== undefined) totalsRows.push(["Impuestos", formatCurrency(data.taxes, currency)]);
    if (data.total !== undefined) totalsRows.push(["Total", formatCurrency(data.total, currency)]);
    row = addKawiilTable(ws, row, { headers: ["Concepto", "Valor"], rows: totalsRows });
  }
  if (data.terms?.length) {
    row = addKawiilTable(ws, row, { headers: ["Términos"], rows: data.terms.map((t) => [t]) });
  }
}

function buildInvoiceXlsx(wb: AnyWs, title: string, data: InvoiceData) {
  const ws = wb.addWorksheet("Factura");
  titleCell(ws, title, data.folio ? `Folio ${data.folio}` : "Factura / remisión");
  let row = 4;

  row = addKawiilTable(ws, row, { headers: ["Emisor", "Valor"], rows: data.emisor.map((kv) => [kv.label, kv.value]) });
  row = addKawiilTable(ws, row, { headers: ["Receptor", "Valor"], rows: data.receptor.map((kv) => [kv.label, kv.value]) });

  const currency = data.currency || "MXN";
  row = addKawiilTable(ws, row, {
    headers: ["Concepto", "Cant.", "Unidad", "P. Unitario", "Importe"],
    rows: data.line_items.map((li) => [
      li.description,
      li.quantity ?? "",
      li.unit ?? "",
      li.unit_price ?? "",
      li.amount ?? "",
    ]),
  });
  if (data.subtotal !== undefined || data.taxes !== undefined || data.total !== undefined) {
    const totalsRows: [string, string][] = [];
    if (data.subtotal !== undefined) totalsRows.push(["Subtotal", formatCurrency(data.subtotal, currency)]);
    if (data.taxes !== undefined) totalsRows.push(["Impuestos", formatCurrency(data.taxes, currency)]);
    if (data.total !== undefined) totalsRows.push(["Total", formatCurrency(data.total, currency)]);
    row = addKawiilTable(ws, row, { headers: ["Concepto", "Valor"], rows: totalsRows });
  }
}

function buildFinancialReportXlsx(wb: AnyWs, title: string, data: FinancialReportData) {
  const ws = wb.addWorksheet("Resumen");
  titleCell(ws, title, data.period ? `Reporte financiero · ${data.period}` : "Reporte financiero");
  let row = 4;
  if (data.kpis?.length) {
    row = addKawiilTable(ws, row, {
      headers: ["Indicador", "Valor", "Δ / nota"],
      rows: data.kpis.map((k) => [k.label, k.value, k.delta || ""]),
    });
  }
  (data.tables || []).forEach((t, idx) => {
    const sheet = wb.addWorksheet(t.caption?.slice(0, 30) || `Tabla ${idx + 1}`);
    titleCell(sheet, t.caption || title, "Reporte financiero · Kawiil");
    addKawiilTable(sheet, 4, t);
  });
  if (data.notes?.length) {
    addKawiilTable(ws, row, { headers: ["Notas"], rows: data.notes.map((n) => [n]) });
  }
}

function buildGenericXlsx(wb: AnyWs, title: string, tables: KawiilTable[]) {
  if (!tables.length) {
    const ws = wb.addWorksheet("Documento");
    titleCell(ws, title, "Sin tablas");
    return;
  }
  tables.forEach((t, idx) => {
    const ws = wb.addWorksheet(t.caption?.slice(0, 30) || `Hoja ${idx + 1}`);
    titleCell(ws, t.caption || title, "Kawiil");
    addKawiilTable(ws, 4, t);
  });
}

export async function renderKawiilXlsx(input: {
  templateKey: KawiilTemplateKey;
  title: string;
  data: unknown;
  branding: ReturnType<typeof resolveBranding>;
}): Promise<Uint8Array> {
  // deno-lint-ignore no-explicit-any
  const wb: any = new (ExcelJS as any).Workbook();
  wb.creator = "Kawiil AI";
  wb.created = new Date();

  switch (input.templateKey) {
    case "propuesta_cotizacion":
      buildProposalXlsx(wb, input.title, input.data as ProposalData);
      break;
    case "factura_remision":
      buildInvoiceXlsx(wb, input.title, input.data as InvoiceData);
      break;
    case "reporte_financiero":
      buildFinancialReportXlsx(wb, input.title, input.data as FinancialReportData);
      break;
    default: {
      // Para informe / minuta / genérico: extraer todas las tablas de las secciones.
      const raw = input.data as { sections?: Array<{ tables?: KawiilTable[]; heading?: string }>; tables?: KawiilTable[] };
      const tables: KawiilTable[] = [];
      if (raw.tables?.length) tables.push(...raw.tables);
      if (raw.sections?.length) {
        for (const s of raw.sections) {
          if (s.tables?.length) {
            for (const t of s.tables) tables.push({ ...t, caption: t.caption || s.heading });
          }
        }
      }
      buildGenericXlsx(wb, input.title, tables);
    }
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
