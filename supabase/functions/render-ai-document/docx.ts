import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "npm:docx@8.5.0";
import {
  type ExecutiveReportData,
  type FinancialReportData,
  type GenericDocumentData,
  type InvoiceData,
  KAWIIL_BRAND,
  type KawiilSection,
  type KawiilTable,
  type KawiilTemplateKey,
  type MeetingMinutesData,
  type ProposalData,
  resolveBranding,
} from "../_shared/ai-templates/index.ts";
import {
  capHeadingLevel,
  flattenMarkdownBodyChunk,
  parseMarkdownHeadingLine,
  splitInlineMarkdownSegments,
} from "../_shared/markdown-inline.ts";
import { formatCurrency } from "./common.ts";

/**
 * Renderer DOCX con estilos Kawiil (cover, heading colors, shaded tables,
 * page numbers). Reemplaza al renderer plano anterior.
 */

const BRAND_HEX = KAWIIL_BRAND.accent.replace("#", "");
const BRAND_PRIMARY_HEX = KAWIIL_BRAND.primaryDark.replace("#", "");
const TABLE_HEADER_HEX = KAWIIL_BRAND.tableHeaderBg.replace("#", "");
const ROW_ALT_HEX = KAWIIL_BRAND.tableRowAlt.replace("#", "");
const BORDER_HEX = KAWIIL_BRAND.borderSoft.replace("#", "");

function textRun(text: string, opts: { bold?: boolean; color?: string; italics?: boolean; size?: number } = {}) {
  return new TextRun({
    text,
    bold: opts.bold,
    color: opts.color,
    italics: opts.italics,
    size: opts.size,
  });
}

function paragraph(text: string | TextRun[], opts: { bold?: boolean; size?: number; color?: string } = {}) {
  const children = Array.isArray(text) ? text : [textRun(text, opts)];
  return new Paragraph({
    children,
    spacing: { before: 60, after: 120 },
    alignment: AlignmentType.JUSTIFIED,
  });
}

/** Párrafo justificado con **negrita** / *cursiva* interpretadas (texto del modelo). */
function paragraphFromMarkdown(body: string): Paragraph {
  const runs = splitInlineMarkdownSegments(body).map((s) =>
    textRun(s.text, { bold: s.bold, italics: s.italics })
  );
  return new Paragraph({
    children: runs.length ? runs : [textRun(body)],
    spacing: { before: 60, after: 120 },
    alignment: AlignmentType.JUSTIFIED,
  });
}

/** Encabezado con posible Markdown inline en el título. */
function headingFromMarkdown(title: string, level: 1 | 2 | 3) {
  const headingLevel = level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
  const size = level === 1 ? 32 : level === 2 ? 26 : 22;
  const color = level === 1 ? BRAND_HEX : BRAND_PRIMARY_HEX;
  const runs = splitInlineMarkdownSegments(title).map((s) =>
    textRun(s.text, { bold: true, italics: s.italics, color, size })
  );
  return new Paragraph({
    heading: headingLevel,
    children: runs.length ? runs : [textRun(title, { bold: true, color, size })],
    spacing: { before: 240, after: 120 },
  });
}

/** Varias líneas / ## encabezados en un solo campo del modelo → párrafos DOCX. */
function appendMarkdownBodyChunks(out: Paragraph[], chunk: string) {
  const trimmed = chunk.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return;
  const blocks = flattenMarkdownBodyChunk(trimmed);
  if (!blocks.length) {
    out.push(paragraphFromMarkdown(trimmed));
    return;
  }
  for (const block of blocks) {
    if (block.kind === "heading") {
      out.push(headingFromMarkdown(block.title, capHeadingLevel(block.level)));
    } else {
      out.push(paragraphFromMarkdown(block.text));
    }
  }
}

/** Inserta párrafos DOCX interpretando Markdown en un array mixto de hijos del documento. */
function appendMarkdownToMixed(children: (Paragraph | Table)[], text: string) {
  const acc: Paragraph[] = [];
  appendMarkdownBodyChunks(acc, text);
  children.push(...acc);
}

function heading(text: string, level: 1 | 2 | 3 = 1) {
  const headingLevel = level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
  const size = level === 1 ? 32 : level === 2 ? 26 : 22;
  return new Paragraph({
    heading: headingLevel,
    children: [textRun(text, { bold: true, color: level === 1 ? BRAND_HEX : BRAND_PRIMARY_HEX, size })],
    spacing: { before: 240, after: 120 },
  });
}

function bulletItem(text: string) {
  const runs = splitInlineMarkdownSegments(text).map((s) => textRun(s.text, { bold: s.bold, italics: s.italics }));
  return new Paragraph({
    children: runs.length ? runs : [textRun(text)],
    bullet: { level: 0 },
    spacing: { after: 40 },
  });
}

function numberedItem(text: string, idx: number) {
  const runs = splitInlineMarkdownSegments(text).map((s) => textRun(s.text, { bold: s.bold, italics: s.italics }));
  return new Paragraph({
    children: [textRun(`${idx + 1}. `), ...(runs.length ? runs : [textRun(text)])],
    spacing: { after: 40 },
    indent: { left: 360 },
  });
}

function buildTable(t: KawiilTable): Table {
  const cols = Math.max(t.headers?.length || 0, ...(t.rows || []).map((r) => r.length));
  const rows: TableRow[] = [];

  if (t.headers?.length) {
    rows.push(new TableRow({
      tableHeader: true,
      children: t.headers.map((h) => new TableCell({
        shading: { type: ShadingType.CLEAR, fill: TABLE_HEADER_HEX, color: "auto" },
        children: [new Paragraph({
          children: splitInlineMarkdownSegments(String(h)).map((s) =>
            textRun(s.text, { bold: true, color: "FFFFFF", italics: s.italics })
          ),
          spacing: { before: 60, after: 60 },
        })],
      })),
    }));
  }

  (t.rows || []).forEach((row, rowIdx) => {
    const fill = rowIdx % 2 === 1 ? ROW_ALT_HEX : undefined;
    const cells: TableCell[] = [];
    for (let c = 0; c < cols; c++) {
      const val = row[c] ?? "";
      const cellRuns = splitInlineMarkdownSegments(String(val)).map((s) =>
        textRun(s.text, { bold: s.bold, italics: s.italics })
      );
      cells.push(new TableCell({
        shading: fill ? { type: ShadingType.CLEAR, fill, color: "auto" } : undefined,
        children: [new Paragraph({
          children: cellRuns.length ? cellRuns : [textRun(String(val))],
          spacing: { before: 40, after: 40 },
        })],
      }));
    }
    rows.push(new TableRow({ children: cells }));
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
      left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
      right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: BORDER_HEX },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: BORDER_HEX },
    },
    rows,
  });
}

function metadataTable(meta?: {
  code?: string;
  emisor?: string;
  destinatario?: string;
  fecha?: string;
  version?: string;
  clasificacion?: string;
}): Table | null {
  if (!meta) return null;
  const rows: Array<[string, string]> = [];
  if (meta.code) rows.push(["Código", meta.code]);
  if (meta.emisor) rows.push(["Área emisora", meta.emisor]);
  if (meta.destinatario) rows.push(["Dirigido a", meta.destinatario]);
  if (meta.fecha) rows.push(["Fecha de emisión", meta.fecha]);
  if (meta.version) rows.push(["Versión", meta.version]);
  if (meta.clasificacion) rows.push(["Clasificación", meta.clasificacion]);
  if (!rows.length) return null;

  return new Table({
    width: { size: 80, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
      left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
      right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: BORDER_HEX },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: BORDER_HEX },
    },
    rows: rows.map(([label, value]) => new TableRow({
      children: [
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill: BRAND_HEX, color: "auto" },
          width: { size: 30, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ children: [textRun(label, { bold: true, color: "FFFFFF" })] })],
        }),
        new TableCell({
          children: [new Paragraph({
            children: splitInlineMarkdownSegments(value).map((s) =>
              textRun(s.text, { bold: s.bold, italics: s.italics })
            ),
          })],
        }),
      ],
    })),
  });
}

function renderSection(s: KawiilSection, level: 1 | 2 = 2): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  if (s.heading) {
    const trimmed = s.heading.replace(/\r\n/g, "\n").trim();
    const singleLine = !trimmed.includes("\n");
    const parsed = singleLine ? parseMarkdownHeadingLine(trimmed) : null;
    const displayTitle = parsed ? parsed.title : trimmed;
    const effLevel: 1 | 2 | 3 = parsed ? capHeadingLevel(parsed.level) : (level === 1 ? 1 : 2);
    out.push(headingFromMarkdown(displayTitle, effLevel));
  }
  const paraChunks: Paragraph[] = [];
  for (const p of s.paragraphs || []) appendMarkdownBodyChunks(paraChunks, p);
  out.push(...paraChunks);
  for (const b of s.bullets || []) out.push(bulletItem(b));
  for (const t of s.tables || []) out.push(buildTable(t));
  if (s.callout) {
    const titleRuns = s.callout.title
      ? splitInlineMarkdownSegments(s.callout.title).map((seg) =>
        textRun(seg.text, { bold: true, italics: seg.italics, color: BRAND_HEX })
      )
      : [];
    const titleSep = s.callout.title ? textRun(": ", { bold: true, color: BRAND_HEX }) : null;
    const bodyRuns = splitInlineMarkdownSegments(s.callout.body).map((seg) =>
      textRun(seg.text, { bold: seg.bold, italics: seg.italics })
    );
    out.push(new Paragraph({
      children: [
        ...titleRuns,
        ...(titleSep ? [titleSep] : []),
        ...bodyRuns,
      ],
      spacing: { before: 120, after: 120 },
      indent: { left: 360 },
      alignment: AlignmentType.JUSTIFIED,
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: BRAND_PRIMARY_HEX, space: 8 } },
    }));
  }
  return out;
}

function coverBlock(title: string, subtitle: string, meta: Parameters<typeof metadataTable>[0]): (Paragraph | Table)[] {
  const parts: (Paragraph | Table)[] = [];
  parts.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [textRun(title, { bold: true, color: BRAND_HEX, size: 52 })],
    spacing: { before: 600, after: 120 },
  }));
  parts.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [textRun(subtitle, { italics: true, color: KAWIIL_BRAND.textMuted.replace("#", ""), size: 24 })],
    spacing: { after: 480 },
  }));
  const meta_ = metadataTable(meta);
  if (meta_) parts.push(meta_);
  return parts;
}

function buildHeader(brand: { orgName: string }, code?: string) {
  return new Header({
    children: [new Paragraph({
      children: [
        textRun(brand.orgName.toUpperCase(), { bold: true, color: BRAND_PRIMARY_HEX, size: 18 }),
        textRun(code ? `   |   ${code}  ·  Confidencial` : "   |   Confidencial", { color: KAWIIL_BRAND.footerText.replace("#", ""), size: 16 }),
      ],
    })],
  });
}

function buildFooter(brand: { orgName: string }) {
  return new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.RIGHT,
      children: [
        textRun(`${brand.orgName}   ·   Página `, { color: KAWIIL_BRAND.footerText.replace("#", ""), size: 16 }),
        new TextRun({ children: [PageNumber.CURRENT], color: KAWIIL_BRAND.footerText.replace("#", ""), size: 16 }),
        textRun(" de ", { color: KAWIIL_BRAND.footerText.replace("#", ""), size: 16 }),
        new TextRun({ children: [PageNumber.TOTAL_PAGES], color: KAWIIL_BRAND.footerText.replace("#", ""), size: 16 }),
      ],
    })],
  });
}

function buildExecutiveReport(title: string, data: ExecutiveReportData, brand: ReturnType<typeof resolveBranding>): Document {
  const children: (Paragraph | Table)[] = [];
  children.push(...coverBlock(title, "Informe ejecutivo", data.metadata));
  children.push(new Paragraph({ children: [new TextRun({ text: "", break: 1 })], pageBreakBefore: true }));

  if (data.summary) {
    children.push(heading("Resumen ejecutivo", 1));
    appendMarkdownToMixed(children, data.summary);
  }
  for (const s of data.sections) children.push(...renderSection(s, 1));
  if (data.recommendations?.length) {
    children.push(heading("Recomendaciones", 1));
    data.recommendations.forEach((r, i) => children.push(numberedItem(r, i)));
  }
  if (data.signatures?.length) {
    children.push(heading("Firmas", 1));
    const row = new TableRow({
      children: data.signatures.map((s) => new TableCell({
        borders: { top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: BorderStyle.SINGLE, size: 6, color: "000000" }, left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } },
        children: [
          new Paragraph({ children: [textRun(" ", { size: 20 })], spacing: { before: 400 } }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [textRun(s.name || " ", { bold: true })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [textRun(s.role, { color: KAWIIL_BRAND.textMuted.replace("#", ""), size: 18 })] }),
        ],
      })),
    });
    children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [row] }));
  }

  return new Document({
    creator: "Kawiil AI",
    title,
    sections: [{
      headers: { default: buildHeader(brand, data.metadata?.code) },
      footers: { default: buildFooter(brand) },
      children,
    }],
  });
}

function buildMeetingMinutes(title: string, data: MeetingMinutesData, brand: ReturnType<typeof resolveBranding>): Document {
  const children: (Paragraph | Table)[] = [];
  children.push(...coverBlock(title, "Minuta de reunión", data.metadata));

  if (data.attendees?.length) {
    children.push(heading("Participantes", 2));
    for (const a of data.attendees) children.push(bulletItem(a.role ? `${a.name} — ${a.role}` : a.name));
  }
  if (data.absentees?.length) {
    children.push(paragraph([textRun("Ausentes: ", { bold: true }), textRun(data.absentees.join(", "))]));
  }
  if (data.agenda?.length) {
    children.push(heading("Agenda", 2));
    data.agenda.forEach((a, i) => children.push(numberedItem(a, i)));
  }
  if (data.topics?.length) {
    children.push(heading("Temas discutidos", 1));
    for (const t of data.topics) {
      children.push(heading(t.title, 3));
      if (t.discussion) appendMarkdownToMixed(children, t.discussion);
    }
  }
  if (data.agreements?.length) {
    children.push(heading("Acuerdos", 2));
    data.agreements.forEach((a, i) => children.push(numberedItem(a, i)));
  }
  if (data.action_items?.length) {
    children.push(heading("Plan de acción", 2));
    children.push(buildTable({
      headers: ["Tarea", "Responsable", "Fecha"],
      rows: data.action_items.map((a) => [a.task, a.owner || "—", a.due_date || "—"]),
    }));
  }
  if (data.next_meeting) {
    children.push(new Paragraph({
      children: [
        textRun("Próxima reunión: ", { bold: true, color: BRAND_HEX }),
        ...splitInlineMarkdownSegments(data.next_meeting).map((s) =>
          textRun(s.text, { bold: s.bold, italics: s.italics })
        ),
      ],
      spacing: { before: 60, after: 120 },
      alignment: AlignmentType.JUSTIFIED,
    }));
  }

  return new Document({
    creator: "Kawiil AI",
    title,
    sections: [{
      headers: { default: buildHeader(brand, data.metadata?.code) },
      footers: { default: buildFooter(brand) },
      children,
    }],
  });
}

function totalsTable(currency: string, subtotal?: number, taxes?: number, total?: number): Table | null {
  const rows: TableRow[] = [];
  if (subtotal !== undefined) {
    rows.push(new TableRow({ children: [
      new TableCell({ children: [new Paragraph({ children: [textRun("Subtotal", { bold: true })] })] }),
      new TableCell({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [textRun(formatCurrency(subtotal, currency))] })] }),
    ]}));
  }
  if (taxes !== undefined) {
    rows.push(new TableRow({ children: [
      new TableCell({ children: [new Paragraph({ children: [textRun("Impuestos", { bold: true })] })] }),
      new TableCell({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [textRun(formatCurrency(taxes, currency))] })] }),
    ]}));
  }
  if (total !== undefined) {
    rows.push(new TableRow({ children: [
      new TableCell({ shading: { type: ShadingType.CLEAR, fill: TABLE_HEADER_HEX, color: "auto" }, children: [new Paragraph({ children: [textRun("Total", { bold: true, color: "FFFFFF" })] })] }),
      new TableCell({ shading: { type: ShadingType.CLEAR, fill: TABLE_HEADER_HEX, color: "auto" }, children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [textRun(formatCurrency(total, currency), { bold: true, color: "FFFFFF" })] })] }),
    ]}));
  }
  if (!rows.length) return null;
  return new Table({
    width: { size: 50, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.RIGHT,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
      left: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
      right: { style: BorderStyle.SINGLE, size: 4, color: BORDER_HEX },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: BORDER_HEX },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: BORDER_HEX },
    },
    rows,
  });
}

function buildProposal(title: string, data: ProposalData, brand: ReturnType<typeof resolveBranding>): Document {
  const children: (Paragraph | Table)[] = [];
  children.push(...coverBlock(title, "Propuesta comercial", data.metadata));

  if (data.client?.length) {
    children.push(heading("Cliente", 2));
    children.push(buildTable({ headers: [], rows: data.client.map((kv) => [kv.label, kv.value]) }));
  }
  if (data.summary) {
    children.push(heading("Resumen", 2));
    appendMarkdownToMixed(children, data.summary);
  }
  if (data.scope?.length) {
    children.push(heading("Alcance", 1));
    for (const s of data.scope) children.push(...renderSection(s, 2));
  }
  children.push(heading("Conceptos", 1));
  const currency = data.currency || "MXN";
  children.push(buildTable({
    headers: ["Descripción", "Cant.", "P. Unitario", "Importe"],
    rows: data.line_items.map((li) => [
      li.description + (li.notes ? `\n${li.notes}` : ""),
      li.quantity !== undefined ? String(li.quantity) : "—",
      li.unit_price !== undefined ? formatCurrency(li.unit_price, currency) : "—",
      li.amount !== undefined ? formatCurrency(li.amount, currency) : "—",
    ]),
  }));
  const totals = totalsTable(currency, data.subtotal, data.taxes, data.total);
  if (totals) children.push(totals);
  if (data.terms?.length) {
    children.push(heading("Términos y condiciones", 2));
    data.terms.forEach((t, i) => children.push(numberedItem(t, i)));
  }
  if (data.validity) {
    children.push(new Paragraph({
      children: [
        textRun("Vigencia: ", { bold: true, color: BRAND_HEX }),
        ...splitInlineMarkdownSegments(data.validity).map((s) =>
          textRun(s.text, { bold: s.bold, italics: s.italics })
        ),
      ],
      spacing: { before: 60, after: 120 },
      alignment: AlignmentType.JUSTIFIED,
    }));
  }

  return new Document({
    creator: "Kawiil AI",
    title,
    sections: [{
      headers: { default: buildHeader(brand, data.metadata?.code) },
      footers: { default: buildFooter(brand) },
      children,
    }],
  });
}

function buildInvoice(title: string, data: InvoiceData, brand: ReturnType<typeof resolveBranding>): Document {
  const children: (Paragraph | Table)[] = [];
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [textRun((data.folio ? `FOLIO ${data.folio}` : title).toUpperCase(), { bold: true, color: BRAND_HEX, size: 36 })],
    spacing: { before: 120, after: 120 },
  }));
  if (data.fecha) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [textRun(data.fecha, { color: KAWIIL_BRAND.textMuted.replace("#", ""), size: 22 })],
      spacing: { after: 240 },
    }));
  }

  children.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } },
    rows: [new TableRow({
      children: [
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          children: [
            new Paragraph({ children: [textRun("Emisor", { bold: true, color: BRAND_HEX, size: 22 })] }),
            ...data.emisor.map((kv) => new Paragraph({ children: [textRun(`${kv.label}: `, { bold: true }), textRun(kv.value)] })),
          ],
        }),
        new TableCell({
          width: { size: 50, type: WidthType.PERCENTAGE },
          children: [
            new Paragraph({ children: [textRun("Receptor", { bold: true, color: BRAND_HEX, size: 22 })] }),
            ...data.receptor.map((kv) => new Paragraph({ children: [textRun(`${kv.label}: `, { bold: true }), textRun(kv.value)] })),
          ],
        }),
      ],
    })],
  }));

  const currency = data.currency || "MXN";
  children.push(buildTable({
    headers: ["Concepto", "Cant.", "Unidad", "P. Unitario", "Importe"],
    rows: data.line_items.map((li) => [
      li.description,
      li.quantity !== undefined ? String(li.quantity) : "—",
      li.unit || "—",
      li.unit_price !== undefined ? formatCurrency(li.unit_price, currency) : "—",
      li.amount !== undefined ? formatCurrency(li.amount, currency) : "—",
    ]),
  }));
  const totals = totalsTable(currency, data.subtotal, data.taxes, data.total);
  if (totals) children.push(totals);
  if (data.legal_notes?.length) {
    children.push(heading("Notas legales", 3));
    for (const n of data.legal_notes) children.push(bulletItem(n));
  }

  return new Document({
    creator: "Kawiil AI",
    title,
    sections: [{
      headers: { default: buildHeader(brand, data.folio) },
      footers: { default: buildFooter(brand) },
      children,
    }],
  });
}

function buildFinancialReport(title: string, data: FinancialReportData, brand: ReturnType<typeof resolveBranding>): Document {
  const children: (Paragraph | Table)[] = [];
  children.push(...coverBlock(title, data.period ? `Reporte financiero · ${data.period}` : "Reporte financiero", data.metadata));

  if (data.summary) {
    children.push(heading("Resumen del periodo", 1));
    appendMarkdownToMixed(children, data.summary);
  }
  if (data.kpis?.length) {
    children.push(heading("Indicadores clave", 2));
    const kpis = data.kpis.slice(0, 6);
    children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }, insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" } },
      rows: [new TableRow({ children: kpis.map((kpi) => new TableCell({
        shading: { type: ShadingType.CLEAR, fill: ROW_ALT_HEX, color: "auto" },
        children: [
          new Paragraph({ children: [textRun(kpi.label.toUpperCase(), { bold: true, color: KAWIIL_BRAND.textMuted.replace("#", ""), size: 16 })] }),
          new Paragraph({ children: [textRun(kpi.value, { bold: true, color: BRAND_HEX, size: 32 })] }),
          kpi.delta ? new Paragraph({ children: [textRun(kpi.delta, { color: BRAND_PRIMARY_HEX, size: 18 })] }) : new Paragraph({ children: [textRun(" ", { size: 14 })] }),
        ],
      })) })],
    }));
  }
  for (const t of data.tables || []) children.push(buildTable(t));
  if (data.notes?.length) {
    children.push(heading("Notas", 2));
    data.notes.forEach((n, i) => children.push(numberedItem(n, i)));
  }

  return new Document({
    creator: "Kawiil AI",
    title,
    sections: [{
      headers: { default: buildHeader(brand, data.metadata?.code) },
      footers: { default: buildFooter(brand) },
      children,
    }],
  });
}

function buildGenericDoc(title: string, data: GenericDocumentData, brand: ReturnType<typeof resolveBranding>): Document {
  const children: (Paragraph | Table)[] = [];
  children.push(...coverBlock(title, "Documento", data.metadata));
  if (data.summary) appendMarkdownToMixed(children, data.summary);
  for (const s of data.sections) children.push(...renderSection(s, 1));

  return new Document({
    creator: "Kawiil AI",
    title,
    sections: [{
      headers: { default: buildHeader(brand, data.metadata?.code) },
      footers: { default: buildFooter(brand) },
      children,
    }],
  });
}

export async function renderKawiilDocx(input: {
  templateKey: KawiilTemplateKey;
  title: string;
  data: unknown;
  branding: ReturnType<typeof resolveBranding>;
}): Promise<Uint8Array> {
  const { templateKey, title, data, branding } = input;
  let doc: Document;
  switch (templateKey) {
    case "informe_ejecutivo":
      doc = buildExecutiveReport(title, data as ExecutiveReportData, branding);
      break;
    case "minuta_reunion":
      doc = buildMeetingMinutes(title, data as MeetingMinutesData, branding);
      break;
    case "propuesta_cotizacion":
      doc = buildProposal(title, data as ProposalData, branding);
      break;
    case "factura_remision":
      doc = buildInvoice(title, data as InvoiceData, branding);
      break;
    case "reporte_financiero":
      doc = buildFinancialReport(title, data as FinancialReportData, branding);
      break;
    case "generico":
    default:
      doc = buildGenericDoc(title, data as GenericDocumentData, branding);
  }
  const packed = await Packer.toBuffer(doc);
  return packed instanceof Uint8Array ? packed : new Uint8Array(packed);
}
