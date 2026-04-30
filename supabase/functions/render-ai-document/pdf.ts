// @ts-ignore: npm:pdfmake ships its own types via Node types that may not resolve in Deno.
import PdfPrinter from "npm:pdfmake@0.2.10";
import {
  type ExecutiveReportData,
  type FinancialReportData,
  type GenericDocumentData,
  type InvoiceData,
  type KawiilSection,
  type KawiilTable,
  KAWIIL_BRAND,
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
import { deepSanitizeForPdf, formatCurrency, sanitizeForPdfText } from "./common.ts";

/**
 * Render PDF con pdfmake usando PdfPrinter + fuentes built-in Helvetica (Latin-1),
 * suficientes para español. Cada template define su propia docDefinition con
 * portada, header, footer, tablas con color y tipografía Kawiil.
 */

type DocDef = Record<string, unknown>;

// Alias de fuentes: mapeamos "Roboto" (default de pdfmake) a Helvetica built-in
// de PDFKit, evitando necesidad de cargar TTFs externos.
const HELVETICA_FONTS = {
  Roboto: {
    normal: "Helvetica",
    bold: "Helvetica-Bold",
    italics: "Helvetica-Oblique",
    bolditalics: "Helvetica-BoldOblique",
  },
};

const printer = new PdfPrinter(HELVETICA_FONTS);

const DEFAULT_STYLES: Record<string, Record<string, unknown>> = {
  coverCode: {
    fontSize: 9,
    color: KAWIIL_BRAND.footerText,
    bold: true,
  },
  coverBrand: {
    fontSize: 11,
    color: KAWIIL_BRAND.primaryDark,
    bold: true,
    alignment: "center",
    margin: [0, 0, 0, 4],
  },
  coverTitle: {
    fontSize: 26,
    color: KAWIIL_BRAND.accent,
    bold: true,
    alignment: "center",
    margin: [0, 40, 0, 8],
  },
  coverSubtitle: {
    fontSize: 13,
    color: KAWIIL_BRAND.textMuted,
    italics: true,
    alignment: "center",
    margin: [0, 0, 0, 24],
  },
  h1: {
    fontSize: 18,
    color: KAWIIL_BRAND.accent,
    bold: true,
    margin: [0, 18, 0, 10],
  },
  h2: {
    fontSize: 14,
    color: KAWIIL_BRAND.primaryDark,
    bold: true,
    margin: [0, 14, 0, 8],
  },
  h3: {
    fontSize: 12,
    color: KAWIIL_BRAND.accent,
    bold: true,
    margin: [0, 10, 0, 6],
  },
  bodyText: {
    fontSize: 10.5,
    color: KAWIIL_BRAND.textMain,
    lineHeight: 1.4,
    margin: [0, 0, 0, 6],
    alignment: "justify",
  },
  bodyBullet: {
    fontSize: 10.5,
    color: KAWIIL_BRAND.textMain,
    lineHeight: 1.35,
  },
  tableHeader: {
    bold: true,
    color: KAWIIL_BRAND.tableHeaderText,
    fillColor: KAWIIL_BRAND.tableHeaderBg,
    fontSize: 10,
  },
  tableCell: {
    fontSize: 9.5,
    color: KAWIIL_BRAND.textMain,
  },
  caption: {
    fontSize: 9,
    italics: true,
    color: KAWIIL_BRAND.textMuted,
    margin: [0, 2, 0, 8],
  },
  callout: {
    fontSize: 10.5,
    color: KAWIIL_BRAND.textMain,
    lineHeight: 1.35,
    alignment: "justify",
  },
  calloutTitle: {
    fontSize: 11,
    bold: true,
    color: KAWIIL_BRAND.accent,
    margin: [0, 0, 0, 2],
  },
  kpiLabel: {
    fontSize: 8.5,
    color: KAWIIL_BRAND.textMuted,
    bold: true,
  },
  kpiValue: {
    fontSize: 16,
    color: KAWIIL_BRAND.accent,
    bold: true,
  },
  kpiDelta: {
    fontSize: 9,
    color: KAWIIL_BRAND.primaryDark,
  },
  signatureLabel: {
    fontSize: 10,
    color: KAWIIL_BRAND.textMuted,
    alignment: "center",
    margin: [0, 2, 0, 0],
  },
  signatureName: {
    fontSize: 11,
    color: KAWIIL_BRAND.textMain,
    alignment: "center",
    bold: true,
  },
  footerText: {
    fontSize: 8.5,
    color: KAWIIL_BRAND.footerText,
  },
  sectionDivider: {
    margin: [0, 10, 0, 10],
  },
};

function headerFn(brand: { orgName: string; primary: string }, code?: string) {
  return (_currentPage: number, _pageCount: number) => {
    return {
      margin: [40, 18, 40, 0],
      columns: [
        {
          text: brand.orgName.toUpperCase(),
          fontSize: 10,
          bold: true,
          color: brand.primary,
        },
        {
          text: code ? `${code}  |  Confidencial` : "Confidencial",
          fontSize: 9,
          color: KAWIIL_BRAND.footerText,
          alignment: "right",
        },
      ],
    };
  };
}

function footerFn(brand: { orgName: string }) {
  return (currentPage: number, pageCount: number) => ({
    margin: [40, 0, 40, 18],
    columns: [
      { text: brand.orgName, style: "footerText" },
      {
        text: `Página ${currentPage} de ${pageCount}`,
        style: "footerText",
        alignment: "right",
      },
    ],
  });
}

/** Texto con estilo pdfmake + negritas/cursivas Markdown. */
function pdfStyledInline(text: string, style: string): DocDef {
  const segs = splitInlineMarkdownSegments(text);
  if (segs.length === 1 && !segs[0].bold && !segs[0].italics) {
    return { text: segs[0].text, style };
  }
  return {
    text: segs.map((s) => ({
      text: s.text,
      ...(s.bold ? { bold: true } : {}),
      ...(s.italics ? { italics: true } : {}),
    })),
    style,
  };
}

function pdfHeadingFromMarkdown(title: string, level: 1 | 2 | 3): DocDef {
  const trimmed = title.replace(/\r\n/g, "\n").trim();
  const singleLine = !trimmed.includes("\n");
  const parsed = singleLine ? parseMarkdownHeadingLine(trimmed) : null;
  const displayTitle = parsed ? parsed.title : trimmed;
  const effLevel = parsed ? capHeadingLevel(parsed.level) : level;
  const style = effLevel === 1 ? "h1" : effLevel === 2 ? "h2" : "h3";
  const segs = splitInlineMarkdownSegments(displayTitle);
  if (segs.length === 1 && !segs[0].bold && !segs[0].italics) {
    return { text: segs[0].text, style };
  }
  return {
    text: segs.map((s) => ({
      text: s.text,
      bold: true,
      ...(s.italics ? { italics: true } : {}),
    })),
    style,
  };
}

function pdfChunksFromMarkdownChunk(chunk: string): DocDef[] {
  const trimmed = chunk.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return [];
  const blocks = flattenMarkdownBodyChunk(trimmed);
  if (!blocks.length) return [pdfStyledInline(trimmed, "bodyText")];
  const out: DocDef[] = [];
  for (const b of blocks) {
    if (b.kind === "heading") {
      out.push(pdfHeadingFromMarkdown(b.title, capHeadingLevel(b.level)));
    } else {
      out.push(pdfStyledInline(b.text, "bodyText"));
    }
  }
  return out;
}

function coverMetadataTable(meta?: {
  code?: string;
  emisor?: string;
  destinatario?: string;
  fecha?: string;
  version?: string;
  clasificacion?: string;
}) {
  if (!meta) return null;
  const rows: Array<[string, string]> = [];
  if (meta.code) rows.push(["Código", meta.code]);
  if (meta.emisor) rows.push(["Área emisora", meta.emisor]);
  if (meta.destinatario) rows.push(["Dirigido a", meta.destinatario]);
  if (meta.fecha) rows.push(["Fecha de emisión", meta.fecha]);
  if (meta.version) rows.push(["Versión", meta.version]);
  if (meta.clasificacion) rows.push(["Clasificación", meta.clasificacion]);
  if (!rows.length) return null;

  return {
    table: {
      widths: [130, "*"],
      body: rows.map(([k, v]) => [
        {
          text: k,
          fillColor: KAWIIL_BRAND.accent,
          color: "#FFFFFF",
          bold: true,
          fontSize: 9.5,
          margin: [8, 6, 8, 6],
        },
        {
          text: v,
          fontSize: 10,
          color: KAWIIL_BRAND.textMain,
          margin: [8, 6, 8, 6],
        },
      ]),
    },
    layout: {
      hLineColor: () => KAWIIL_BRAND.border,
      vLineColor: () => KAWIIL_BRAND.border,
      hLineWidth: () => 0.5,
      vLineWidth: () => 0.5,
    },
    margin: [30, 20, 30, 20] as [number, number, number, number],
  };
}

function paragraphs(items: string[] | undefined): DocDef[] {
  return (items || []).flatMap((p) => pdfChunksFromMarkdownChunk(p));
}

function bullets(items: string[] | undefined): DocDef | null {
  if (!items?.length) return null;
  return {
    ul: items.map((b) => ({
      ...pdfStyledInline(b, "bodyBullet"),
      margin: [0, 2, 0, 2],
    })),
    margin: [0, 4, 0, 10],
  };
}

function tableBlock(t: KawiilTable): DocDef {
  const hasHeader = t.headers?.length;
  const cols = Math.max(t.headers?.length || 0, ...(t.rows || []).map((r) => r.length));
  const body: DocDef[][] = [];

  if (hasHeader) {
    body.push(
      t.headers.map((h) => ({
        ...pdfStyledInline(String(h), "tableHeader"),
        margin: [6, 6, 6, 6],
      })),
    );
  }

    (t.rows || []).forEach((row, idx) => {
      const rowCells: DocDef[] = [];
      for (let c = 0; c < cols; c++) {
        const val = row[c] ?? "";
        const cellInner = pdfStyledInline(String(val), "tableCell");
        rowCells.push({
          ...cellInner,
          margin: [6, 5, 6, 5],
          fillColor: idx % 2 === 1 ? KAWIIL_BRAND.tableRowAlt : undefined,
        });
      }
      body.push(rowCells);
    });

  const widths = Array.from({ length: cols }, () => "*");
  const blockParts: DocDef[] = [
    {
      table: { headerRows: hasHeader ? 1 : 0, widths, body },
      layout: {
        hLineColor: () => KAWIIL_BRAND.borderSoft,
        vLineColor: () => KAWIIL_BRAND.borderSoft,
        hLineWidth: () => 0.5,
        vLineWidth: () => 0.5,
        paddingLeft: () => 0,
        paddingRight: () => 0,
      },
      margin: [0, 4, 0, 8],
    },
  ];
  if (t.caption) blockParts.push({ text: t.caption, style: "caption" });
  return { stack: blockParts };
}

function callout(c: KawiilSection["callout"]): DocDef | null {
  if (!c) return null;
  const palette = c.kind === "warning"
    ? { bg: KAWIIL_BRAND.calloutWarningBg, bd: KAWIIL_BRAND.calloutWarningBorder }
    : c.kind === "success"
    ? { bg: KAWIIL_BRAND.calloutSuccessBg, bd: KAWIIL_BRAND.calloutSuccessBorder }
    : { bg: KAWIIL_BRAND.calloutInfoBg, bd: KAWIIL_BRAND.calloutInfoBorder };

  return {
    table: {
      widths: ["*"],
      body: [[
        {
          stack: [
            c.title ? pdfStyledInline(c.title, "calloutTitle") : null,
            pdfStyledInline(c.body, "callout"),
          ].filter(Boolean),
          fillColor: palette.bg,
          margin: [12, 10, 12, 10],
        },
      ]],
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: (i: number) => (i === 0 ? 3 : 0),
      vLineColor: () => palette.bd,
    },
    margin: [0, 4, 0, 10],
  };
}

function renderSection(s: KawiilSection, level: "h1" | "h2" = "h2"): DocDef[] {
  const out: DocDef[] = [];
  if (s.heading) out.push(pdfHeadingFromMarkdown(s.heading, level === "h1" ? 1 : 2));
  out.push(...paragraphs(s.paragraphs));
  const b = bullets(s.bullets);
  if (b) out.push(b);
  for (const t of s.tables || []) out.push(tableBlock(t));
  const c = callout(s.callout);
  if (c) out.push(c);
  return out;
}

function coverTitle(title: string, subtitle?: string): DocDef[] {
  return [
    { text: title, style: "coverTitle" },
    subtitle ? { text: subtitle, style: "coverSubtitle" } : { text: "", margin: [0, 0, 0, 0] },
  ];
}

// ─── Templates ───

function buildExecutiveReport(
  title: string,
  data: ExecutiveReportData,
  brand: ReturnType<typeof resolveBranding>,
): DocDef {
  const body: DocDef[] = [];

  body.push({ text: brand.orgName.toUpperCase(), style: "coverBrand" });
  body.push(...coverTitle(title, "Informe ejecutivo"));
  const metaTable = coverMetadataTable(data.metadata);
  if (metaTable) body.push(metaTable);
  body.push({ text: "", pageBreak: "after" } as DocDef);

  if (data.summary) {
    body.push({ text: "Resumen ejecutivo", style: "h1" });
    body.push(...pdfChunksFromMarkdownChunk(data.summary));
  }

  for (const section of data.sections || []) {
    body.push(...renderSection(section, "h1"));
  }

  if (data.recommendations?.length) {
    body.push({ text: "Recomendaciones", style: "h1" });
    body.push({
      ol: data.recommendations.map((r) => ({
        ...pdfStyledInline(r, "bodyBullet"),
        margin: [0, 3, 0, 3],
      })),
      margin: [0, 4, 0, 10],
    });
  }

  if (data.signatures?.length) {
    body.push({ text: "Firmas", style: "h1", pageBreak: "before" });
    const cols = data.signatures.map((s) => ({
      width: "*",
      stack: [
        { text: "_________________________", alignment: "center", margin: [0, 40, 0, 0] },
        { text: s.name || " ", style: "signatureName" },
        { text: s.role, style: "signatureLabel" },
      ],
    }));
    body.push({ columns: cols, columnGap: 20, margin: [0, 20, 0, 0] });
  }

  return {
    pageSize: "LETTER",
    pageMargins: [40, 70, 40, 60],
    header: headerFn(brand, data.metadata?.code),
    footer: footerFn(brand),
    styles: DEFAULT_STYLES,
    defaultStyle: { font: "Roboto", fontSize: 10.5, color: KAWIIL_BRAND.textMain },
    content: body,
  };
}

function buildMeetingMinutes(
  title: string,
  data: MeetingMinutesData,
  brand: ReturnType<typeof resolveBranding>,
): DocDef {
  const body: DocDef[] = [];
  body.push({ text: brand.orgName.toUpperCase(), style: "coverBrand" });
  body.push(...coverTitle(title, "Minuta de reunión"));
  const metaTable = coverMetadataTable(data.metadata);
  if (metaTable) body.push(metaTable);

  if (data.attendees?.length || data.absentees?.length) {
    body.push({ text: "Participantes", style: "h2" });
    if (data.attendees?.length) {
      body.push({
        ul: data.attendees.map((a) => ({
          text: a.role ? `${a.name} — ${a.role}` : a.name,
          style: "bodyBullet",
        })),
        margin: [0, 4, 0, 8],
      });
    }
    if (data.absentees?.length) {
      body.push({
        text: `Ausentes: ${data.absentees.join(", ")}`,
        style: "bodyText",
        italics: true,
      });
    }
  }

  if (data.agenda?.length) {
    body.push({ text: "Agenda", style: "h2" });
    body.push({
      ol: data.agenda.map((a) => ({
        ...pdfStyledInline(a, "bodyBullet"),
      })),
      margin: [0, 4, 0, 8],
    });
  }

  if (data.topics?.length) {
    body.push({ text: "Temas discutidos", style: "h1" });
    for (const t of data.topics) {
      body.push(pdfHeadingFromMarkdown(t.title, 3));
      if (t.discussion) body.push(...pdfChunksFromMarkdownChunk(t.discussion));
    }
  }

  if (data.agreements?.length) {
    body.push({ text: "Acuerdos", style: "h2" });
    body.push({
      ol: data.agreements.map((a) => ({
        ...pdfStyledInline(a, "bodyBullet"),
      })),
      margin: [0, 4, 0, 8],
    });
  }

  if (data.action_items?.length) {
    body.push({ text: "Plan de acción", style: "h2" });
    body.push(tableBlock({
      headers: ["Tarea", "Responsable", "Fecha"],
      rows: data.action_items.map((a) => [a.task, a.owner || "—", a.due_date || "—"]),
    }));
  }

  if (data.next_meeting) {
    body.push(callout({ kind: "info", title: "Próxima reunión", body: data.next_meeting })!);
  }

  return {
    pageSize: "LETTER",
    pageMargins: [40, 70, 40, 60],
    header: headerFn(brand, data.metadata?.code),
    footer: footerFn(brand),
    styles: DEFAULT_STYLES,
    defaultStyle: { font: "Roboto", fontSize: 10.5, color: KAWIIL_BRAND.textMain },
    content: body,
  };
}

function buildProposal(
  title: string,
  data: ProposalData,
  brand: ReturnType<typeof resolveBranding>,
): DocDef {
  const body: DocDef[] = [];
  body.push({ text: brand.orgName.toUpperCase(), style: "coverBrand" });
  body.push(...coverTitle(title, "Propuesta comercial"));
  const metaTable = coverMetadataTable(data.metadata);
  if (metaTable) body.push(metaTable);

  if (data.client?.length) {
    body.push({ text: "Cliente", style: "h2" });
    body.push(tableBlock({
      headers: [],
      rows: data.client.map((kv) => [kv.label, kv.value]),
    }));
  }

  if (data.summary) {
    body.push({ text: "Resumen", style: "h2" });
    body.push(...pdfChunksFromMarkdownChunk(data.summary));
  }

  if (data.scope?.length) {
    body.push({ text: "Alcance", style: "h1" });
    for (const s of data.scope) body.push(...renderSection(s, "h2"));
  }

  body.push({ text: "Conceptos", style: "h1" });
  const currency = data.currency || "MXN";
  body.push(tableBlock({
    headers: ["Descripción", "Cant.", "P. Unitario", "Importe"],
    rows: data.line_items.map((li) => [
      li.description + (li.notes ? `\n${li.notes}` : ""),
      li.quantity !== undefined ? String(li.quantity) : "—",
      li.unit_price !== undefined ? formatCurrency(li.unit_price, currency) : "—",
      li.amount !== undefined
        ? formatCurrency(li.amount, currency)
        : li.unit_price !== undefined && li.quantity !== undefined
        ? formatCurrency(li.unit_price * li.quantity, currency)
        : "—",
    ]),
  }));

  body.push({
    columns: [
      { width: "*", text: "" },
      {
        width: "auto",
        table: {
          body: [
            data.subtotal !== undefined ? ["Subtotal", formatCurrency(data.subtotal, currency)] : null,
            data.taxes !== undefined ? ["Impuestos", formatCurrency(data.taxes, currency)] : null,
            data.total !== undefined
              ? [
                { text: "Total", bold: true, fillColor: KAWIIL_BRAND.tableHeaderBg, color: "#FFFFFF", margin: [10, 6, 10, 6] },
                { text: formatCurrency(data.total, currency), bold: true, fillColor: KAWIIL_BRAND.tableHeaderBg, color: "#FFFFFF", margin: [10, 6, 10, 6] },
              ]
              : null,
          ].filter(Boolean) as DocDef[][],
        },
        layout: {
          hLineColor: () => KAWIIL_BRAND.borderSoft,
          vLineColor: () => KAWIIL_BRAND.borderSoft,
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
        },
        margin: [0, 10, 0, 10],
      },
    ],
  });

  if (data.terms?.length) {
    body.push({ text: "Términos y condiciones", style: "h2" });
    body.push({
      ol: data.terms.map((t) => ({
        ...pdfStyledInline(t, "bodyBullet"),
      })),
      margin: [0, 4, 0, 8],
    });
  }

  if (data.validity) {
    body.push(callout({ kind: "info", title: "Vigencia", body: data.validity })!);
  }

  return {
    pageSize: "LETTER",
    pageMargins: [40, 70, 40, 60],
    header: headerFn(brand, data.metadata?.code),
    footer: footerFn(brand),
    styles: DEFAULT_STYLES,
    defaultStyle: { font: "Roboto", fontSize: 10.5, color: KAWIIL_BRAND.textMain },
    content: body,
  };
}

function buildInvoice(
  title: string,
  data: InvoiceData,
  brand: ReturnType<typeof resolveBranding>,
): DocDef {
  const body: DocDef[] = [];
  body.push({
    columns: [
      { text: brand.orgName.toUpperCase(), style: "coverBrand", width: "*", alignment: "left" },
      {
        width: "auto",
        stack: [
          { text: (data.folio ? `FOLIO ${data.folio}` : title).toUpperCase(), bold: true, color: KAWIIL_BRAND.accent, fontSize: 14 },
          { text: data.fecha || "", color: KAWIIL_BRAND.textMuted, fontSize: 10, alignment: "right" },
        ],
        alignment: "right",
      },
    ],
    margin: [0, 0, 0, 20],
  });

  body.push({
    columns: [
      {
        width: "*",
        stack: [
          { text: "Emisor", style: "h3" },
          ...data.emisor.map((kv) => ({
            text: [{ text: `${kv.label}: `, bold: true }, kv.value],
            style: "bodyText",
          })),
        ],
      },
      {
        width: "*",
        stack: [
          { text: "Receptor", style: "h3" },
          ...data.receptor.map((kv) => ({
            text: [{ text: `${kv.label}: `, bold: true }, kv.value],
            style: "bodyText",
          })),
        ],
      },
    ],
    columnGap: 20,
  });

  const currency = data.currency || "MXN";
  body.push(tableBlock({
    headers: ["Concepto", "Cant.", "Unidad", "P. Unitario", "Importe"],
    rows: data.line_items.map((li) => [
      li.description,
      li.quantity !== undefined ? String(li.quantity) : "—",
      li.unit || "—",
      li.unit_price !== undefined ? formatCurrency(li.unit_price, currency) : "—",
      li.amount !== undefined
        ? formatCurrency(li.amount, currency)
        : li.unit_price !== undefined && li.quantity !== undefined
        ? formatCurrency(li.unit_price * li.quantity, currency)
        : "—",
    ]),
  }));

  body.push({
    columns: [
      { width: "*", text: "" },
      {
        width: "auto",
        table: {
          body: [
            data.subtotal !== undefined ? ["Subtotal", formatCurrency(data.subtotal, currency)] : null,
            data.taxes !== undefined ? ["IVA / Impuestos", formatCurrency(data.taxes, currency)] : null,
            data.total !== undefined
              ? [
                { text: "Total", bold: true, fillColor: KAWIIL_BRAND.tableHeaderBg, color: "#FFFFFF", margin: [10, 6, 10, 6] },
                { text: formatCurrency(data.total, currency), bold: true, fillColor: KAWIIL_BRAND.tableHeaderBg, color: "#FFFFFF", margin: [10, 6, 10, 6] },
              ]
              : null,
          ].filter(Boolean) as DocDef[][],
        },
        layout: {
          hLineColor: () => KAWIIL_BRAND.borderSoft,
          vLineColor: () => KAWIIL_BRAND.borderSoft,
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
        },
        margin: [0, 10, 0, 10],
      },
    ],
  });

  if (data.legal_notes?.length) {
    body.push({ text: "Notas legales", style: "h3" });
    body.push({
      ul: data.legal_notes.map((n) => ({
        ...pdfStyledInline(n, "bodyBullet"),
      })),
      margin: [0, 4, 0, 8],
    });
  }

  return {
    pageSize: "LETTER",
    pageMargins: [40, 60, 40, 60],
    header: headerFn(brand, data.folio),
    footer: footerFn(brand),
    styles: DEFAULT_STYLES,
    defaultStyle: { font: "Roboto", fontSize: 10.5, color: KAWIIL_BRAND.textMain },
    content: body,
  };
}

function buildFinancialReport(
  title: string,
  data: FinancialReportData,
  brand: ReturnType<typeof resolveBranding>,
): DocDef {
  const body: DocDef[] = [];
  body.push({ text: brand.orgName.toUpperCase(), style: "coverBrand" });
  body.push(...coverTitle(title, data.period ? `Reporte financiero · ${data.period}` : "Reporte financiero"));
  const metaTable = coverMetadataTable(data.metadata);
  if (metaTable) body.push(metaTable);

  if (data.summary) {
    body.push({ text: "Resumen del periodo", style: "h1" });
    body.push(...pdfChunksFromMarkdownChunk(data.summary));
  }

  if (data.kpis?.length) {
    body.push({ text: "Indicadores clave", style: "h2" });
    const kpiCols = data.kpis.slice(0, 4).map((kpi) => ({
      width: "*",
      stack: [
        { text: kpi.label.toUpperCase(), style: "kpiLabel" },
        { text: kpi.value, style: "kpiValue" },
        kpi.delta ? { text: kpi.delta, style: "kpiDelta" } : { text: "" },
      ],
      margin: [10, 10, 10, 10],
      fillColor: KAWIIL_BRAND.tableRowAlt,
    }));
    body.push({
      table: {
        widths: Array.from({ length: kpiCols.length }, () => "*"),
        body: [kpiCols],
      },
      layout: "noBorders",
      margin: [0, 4, 0, 14],
    });
  }

  for (const t of data.tables || []) body.push(tableBlock(t));

  if (data.notes?.length) {
    body.push({ text: "Notas", style: "h2" });
    body.push({
      ol: data.notes.map((n) => ({
        ...pdfStyledInline(n, "bodyBullet"),
      })),
      margin: [0, 4, 0, 8],
    });
  }

  return {
    pageSize: "LETTER",
    pageMargins: [40, 70, 40, 60],
    header: headerFn(brand, data.metadata?.code),
    footer: footerFn(brand),
    styles: DEFAULT_STYLES,
    defaultStyle: { font: "Roboto", fontSize: 10.5, color: KAWIIL_BRAND.textMain },
    content: body,
  };
}

function buildGenericDoc(
  title: string,
  data: GenericDocumentData,
  brand: ReturnType<typeof resolveBranding>,
): DocDef {
  const body: DocDef[] = [];
  body.push({ text: brand.orgName.toUpperCase(), style: "coverBrand" });
  body.push(...coverTitle(title, "Documento"));
  const metaTable = coverMetadataTable(data.metadata);
  if (metaTable) body.push(metaTable);
  if (data.summary) body.push(...pdfChunksFromMarkdownChunk(data.summary));
  for (const s of data.sections) body.push(...renderSection(s, "h1"));

  return {
    pageSize: "LETTER",
    pageMargins: [40, 70, 40, 60],
    header: headerFn(brand, data.metadata?.code),
    footer: footerFn(brand),
    styles: DEFAULT_STYLES,
    defaultStyle: { font: "Roboto", fontSize: 10.5, color: KAWIIL_BRAND.textMain },
    content: body,
  };
}

function buildDocDefinition(
  templateKey: KawiilTemplateKey,
  title: string,
  data: unknown,
  brand: ReturnType<typeof resolveBranding>,
): DocDef {
  switch (templateKey) {
    case "informe_ejecutivo":
      return buildExecutiveReport(title, data as ExecutiveReportData, brand);
    case "minuta_reunion":
      return buildMeetingMinutes(title, data as MeetingMinutesData, brand);
    case "propuesta_cotizacion":
      return buildProposal(title, data as ProposalData, brand);
    case "factura_remision":
      return buildInvoice(title, data as InvoiceData, brand);
    case "reporte_financiero":
      return buildFinancialReport(title, data as FinancialReportData, brand);
    case "generico":
    default:
      return buildGenericDoc(title, data as GenericDocumentData, brand);
  }
}

export async function renderKawiilPdf(input: {
  templateKey: KawiilTemplateKey;
  title: string;
  data: unknown;
  branding: ReturnType<typeof resolveBranding>;
}): Promise<Uint8Array> {
  // Saneamos el árbol de datos ANTES de construir la definición del PDF: pdfmake
  // usa la fuente built-in Helvetica (WinAnsiEncoding) y revienta si encuentra
  // emojis o cualquier codepoint fuera de Latin-1 extendido. Sin esto, toda
  // respuesta de la IA que traiga 🚀✅💰 (cosa muy común) rompe el render y el
  // artifact cae al fallback de markdown plano.
  const safeTitle = sanitizeForPdfText(input.title);
  const safeData = deepSanitizeForPdf(input.data);
  const safeBranding = {
    ...input.branding,
    orgName: sanitizeForPdfText(input.branding.orgName),
  } as ReturnType<typeof resolveBranding>;
  const docDef = buildDocDefinition(input.templateKey, safeTitle, safeData, safeBranding);
  // deno-lint-ignore no-explicit-any
  const pdfDoc: any = printer.createPdfKitDocument(docDef as any);
  const chunks: Uint8Array[] = [];
  return await new Promise<Uint8Array>((resolve, reject) => {
    pdfDoc.on("data", (chunk: Uint8Array | ArrayBuffer) => {
      if (chunk instanceof Uint8Array) chunks.push(chunk);
      else chunks.push(new Uint8Array(chunk));
    });
    pdfDoc.on("end", () => {
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const c of chunks) {
        result.set(c, offset);
        offset += c.length;
      }
      resolve(result);
    });
    pdfDoc.on("error", reject);
    pdfDoc.end();
  });
}
