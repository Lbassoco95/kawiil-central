import PptxGenJS from "npm:pptxgenjs@3.12.0";
import {
  type ExecutiveReportData,
  type FinancialReportData,
  type GenericDocumentData,
  KAWIIL_BRAND,
  type KawiilTemplateKey,
  type MeetingMinutesData,
  type ProposalData,
  resolveBranding,
} from "../_shared/ai-templates/index.ts";
import { markdownToPlainDisplay } from "../_shared/markdown-inline.ts";

/**
 * PPTX con master slide Kawiil (franja superior azul, footer con nombre org).
 * Pensado principalmente para informe ejecutivo / reporte financiero.
 */

// deno-lint-ignore no-explicit-any
function addMaster(pptx: any, brand: { orgName: string }) {
  pptx.defineSlideMaster({
    title: "KAWIIL_MASTER",
    background: { color: "FFFFFF" },
    objects: [
      { rect: { x: 0, y: 0, w: "100%", h: 0.35, fill: { color: KAWIIL_BRAND.primaryDark.replace("#", "") } } },
      {
        text: {
          text: brand.orgName.toUpperCase(),
          options: {
            x: 0.4,
            y: 0.04,
            w: 6,
            h: 0.27,
            fontSize: 12,
            bold: true,
            color: "FFFFFF",
          },
        },
      },
      {
        text: {
          text: "KAWIIL AI",
          options: {
            x: 10.4,
            y: 0.04,
            w: 2.5,
            h: 0.27,
            fontSize: 11,
            bold: true,
            color: "FFFFFF",
            align: "right",
          },
        },
      },
    ],
    slideNumber: { x: 12.5, y: 7.2, fontSize: 9, color: "64748B" },
  });
}

// deno-lint-ignore no-explicit-any
function addTitleSlide(pptx: any, title: string, subtitle: string) {
  const slide = pptx.addSlide({ masterName: "KAWIIL_MASTER" });
  slide.addText(markdownToPlainDisplay(title), {
    x: 0.7,
    y: 2.5,
    w: 12,
    h: 1.2,
    fontSize: 36,
    bold: true,
    color: KAWIIL_BRAND.accent.replace("#", ""),
  });
  slide.addText(markdownToPlainDisplay(subtitle), {
    x: 0.7,
    y: 3.8,
    w: 12,
    h: 0.8,
    fontSize: 18,
    italic: true,
    color: KAWIIL_BRAND.textMuted.replace("#", ""),
  });
}

// deno-lint-ignore no-explicit-any
function addSectionSlide(pptx: any, title: string, bullets: string[] = [], notes?: string) {
  const slide = pptx.addSlide({ masterName: "KAWIIL_MASTER" });
  slide.addText(markdownToPlainDisplay(title), {
    x: 0.5,
    y: 0.55,
    w: 12.3,
    h: 0.7,
    fontSize: 24,
    bold: true,
    color: KAWIIL_BRAND.primaryDark.replace("#", ""),
  });
  if (bullets.length) {
    slide.addText(
      bullets.map((b) => ({
        text: markdownToPlainDisplay(b),
        options: { bullet: { indent: 18 }, color: KAWIIL_BRAND.textMain.replace("#", ""), fontSize: 16 },
      })),
      { x: 0.7, y: 1.4, w: 11.8, h: 5.2 },
    );
  }
  if (notes) slide.addNotes?.(markdownToPlainDisplay(notes));
  return slide;
}

// deno-lint-ignore no-explicit-any
function addTableSlide(pptx: any, title: string, headers: string[], rows: string[][]) {
  const slide = pptx.addSlide({ masterName: "KAWIIL_MASTER" });
  slide.addText(markdownToPlainDisplay(title), {
    x: 0.5,
    y: 0.55,
    w: 12.3,
    h: 0.7,
    fontSize: 24,
    bold: true,
    color: KAWIIL_BRAND.primaryDark.replace("#", ""),
  });
  const tableRows: Array<Array<{ text: string; options?: Record<string, unknown> }>> = [];
  if (headers.length) {
    tableRows.push(headers.map((h) => ({
      text: markdownToPlainDisplay(h),
      options: { bold: true, color: "FFFFFF", fill: { color: KAWIIL_BRAND.tableHeaderBg.replace("#", "") }, fontSize: 12 },
    })));
  }
  rows.forEach((row, idx) => {
    tableRows.push(row.map((c) => ({
      text: markdownToPlainDisplay(String(c ?? "")),
      options: {
        fontSize: 11,
        color: KAWIIL_BRAND.textMain.replace("#", ""),
        fill: idx % 2 === 1 ? { color: KAWIIL_BRAND.tableRowAlt.replace("#", "") } : undefined,
      },
    })));
  });
  slide.addTable(tableRows, {
    x: 0.5,
    y: 1.4,
    w: 12.3,
    h: 5.2,
    fontSize: 11,
    border: { pt: 1, color: KAWIIL_BRAND.borderSoft.replace("#", "") },
  });
}

// deno-lint-ignore no-explicit-any
function buildExec(pptx: any, title: string, data: ExecutiveReportData) {
  addTitleSlide(pptx, title, "Informe ejecutivo");
  if (data.summary) {
    const plain = markdownToPlainDisplay(data.summary);
    addSectionSlide(pptx, "Resumen ejecutivo", [plain.slice(0, 400)]);
  }
  for (const s of data.sections) {
    const bullets: string[] = [];
    if (s.paragraphs?.length) {
      bullets.push(...s.paragraphs.map((p) => markdownToPlainDisplay(p).slice(0, 220)));
    }
    if (s.bullets?.length) bullets.push(...s.bullets.map((b) => markdownToPlainDisplay(b)));
    addSectionSlide(pptx, markdownToPlainDisplay(s.heading || "Sección"), bullets.slice(0, 8));
    for (const t of s.tables || []) addTableSlide(pptx, t.caption || (s.heading || "Tabla"), t.headers, t.rows);
  }
  if (data.recommendations?.length) {
    addSectionSlide(pptx, "Recomendaciones", data.recommendations.map((r) => markdownToPlainDisplay(r)));
  }
}

// deno-lint-ignore no-explicit-any
function buildMinutes(pptx: any, title: string, data: MeetingMinutesData) {
  addTitleSlide(pptx, title, "Minuta de reunión");
  if (data.attendees?.length) {
    addSectionSlide(pptx, "Participantes", data.attendees.map((a) =>
      markdownToPlainDisplay(a.role ? `${a.name} — ${a.role}` : a.name)
    ));
  }
  if (data.agenda?.length) addSectionSlide(pptx, "Agenda", data.agenda.map((x) => markdownToPlainDisplay(x)));
  for (const t of data.topics || []) {
    const lines = t.discussion ? [markdownToPlainDisplay(t.discussion).slice(0, 400)] : [];
    addSectionSlide(pptx, markdownToPlainDisplay(t.title), lines);
  }
  if (data.agreements?.length) addSectionSlide(pptx, "Acuerdos", data.agreements.map((x) => markdownToPlainDisplay(x)));
  if (data.action_items?.length) {
    addTableSlide(pptx, "Plan de acción", ["Tarea", "Responsable", "Fecha"], data.action_items.map((a) => [
      markdownToPlainDisplay(a.task),
      markdownToPlainDisplay(a.owner || "—"),
      markdownToPlainDisplay(a.due_date || "—"),
    ]));
  }
}

// deno-lint-ignore no-explicit-any
function buildProposal(pptx: any, title: string, data: ProposalData) {
  addTitleSlide(pptx, title, "Propuesta comercial");
  if (data.summary) {
    const plain = markdownToPlainDisplay(data.summary);
    addSectionSlide(pptx, "Resumen", [plain.slice(0, 400)]);
  }
  if (data.scope?.length) {
    for (const s of data.scope) {
      const bullets = [...(s.paragraphs || []).map((p) => markdownToPlainDisplay(p)), ...(s.bullets || []).map((b) => markdownToPlainDisplay(b))].slice(0, 8);
      addSectionSlide(pptx, markdownToPlainDisplay(s.heading || "Alcance"), bullets);
    }
  }
  const currency = data.currency || "MXN";
  addTableSlide(pptx, "Conceptos", ["Descripción", "Cant.", "P. Unit.", "Importe"], data.line_items.map((li) => [
    markdownToPlainDisplay(li.description),
    li.quantity !== undefined ? String(li.quantity) : "—",
    li.unit_price !== undefined ? `$${li.unit_price.toLocaleString()} ${currency}` : "—",
    li.amount !== undefined ? `$${li.amount.toLocaleString()} ${currency}` : "—",
  ]));
}

// deno-lint-ignore no-explicit-any
function buildFinancial(pptx: any, title: string, data: FinancialReportData) {
  addTitleSlide(pptx, title, data.period ? markdownToPlainDisplay(`Reporte financiero · ${data.period}`) : "Reporte financiero");
  if (data.kpis?.length) {
    addTableSlide(pptx, "Indicadores clave", ["Indicador", "Valor", "Δ"], data.kpis.map((k) => [
      markdownToPlainDisplay(k.label),
      markdownToPlainDisplay(k.value),
      markdownToPlainDisplay(k.delta || ""),
    ]));
  }
  for (const t of data.tables || []) addTableSlide(pptx, t.caption || "Resultados", t.headers, t.rows);
  if (data.notes?.length) addSectionSlide(pptx, "Notas", data.notes.map((n) => markdownToPlainDisplay(n)));
}

// deno-lint-ignore no-explicit-any
function buildGeneric(pptx: any, title: string, data: GenericDocumentData) {
  addTitleSlide(pptx, title, "Documento");
  if (data.summary) {
    const plain = markdownToPlainDisplay(data.summary);
    addSectionSlide(pptx, "Resumen", [plain.slice(0, 400)]);
  }
  for (const s of data.sections) {
    const bullets = [...(s.paragraphs || []).map((p) => markdownToPlainDisplay(p)), ...(s.bullets || []).map((b) => markdownToPlainDisplay(b))].slice(0, 8);
    addSectionSlide(pptx, markdownToPlainDisplay(s.heading || "Sección"), bullets);
  }
}

export async function renderKawiilPptx(input: {
  templateKey: KawiilTemplateKey;
  title: string;
  data: unknown;
  branding: ReturnType<typeof resolveBranding>;
}): Promise<Uint8Array> {
  // deno-lint-ignore no-explicit-any
  const pptx: any = new (PptxGenJS as unknown as { new (): unknown })();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Kawiil AI";
  pptx.company = input.branding.orgName;
  addMaster(pptx, input.branding);

  switch (input.templateKey) {
    case "informe_ejecutivo":
      buildExec(pptx, input.title, input.data as ExecutiveReportData);
      break;
    case "minuta_reunion":
      buildMinutes(pptx, input.title, input.data as MeetingMinutesData);
      break;
    case "propuesta_cotizacion":
      buildProposal(pptx, input.title, input.data as ProposalData);
      break;
    case "reporte_financiero":
      buildFinancial(pptx, input.title, input.data as FinancialReportData);
      break;
    case "factura_remision":
      // Factura en PPTX es poco común; usamos genérico como fallback.
      buildGeneric(pptx, input.title, { sections: [{ heading: "Factura", paragraphs: ["Consulta el PDF o XLSX para ver el detalle."] }] });
      break;
    case "generico":
    default:
      buildGeneric(pptx, input.title, input.data as GenericDocumentData);
  }

  const buffer = await pptx.write({ outputType: "arraybuffer" });
  return new Uint8Array(buffer as ArrayBuffer);
}
