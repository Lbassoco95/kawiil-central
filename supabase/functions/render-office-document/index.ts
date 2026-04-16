import * as XLSX from "npm:xlsx";
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "npm:docx";
import PptxGenJS from "npm:pptxgenjs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type OfficeKind = "spreadsheet" | "word_document" | "presentation";

type CellValue = string | number | boolean | null;

interface SpreadsheetPayload {
  sheets: Array<{
    name?: string;
    rows: Array<{
      cells: CellValue[];
    }>;
  }>;
}

interface WordPayload {
  sections: Array<{
    heading?: string;
    paragraphs?: string[];
    tables?: Array<{
      headers?: string[];
      rows: string[][];
    }>;
  }>;
}

interface PresentationPayload {
  slides: Array<{
    title?: string;
    bullets?: string[];
    notes?: string;
    table?: {
      headers?: string[];
      rows: string[][];
    };
  }>;
}

interface RenderRequest {
  title: string;
  requested_kind: OfficeKind;
  confidence: number;
  reason?: string;
  domain_subtype?: string;
  preview_markdown?: string;
  spreadsheet?: SpreadsheetPayload;
  word_document?: WordPayload;
  presentation?: PresentationPayload;
}

const MIME_BY_KIND: Record<OfficeKind, string> = {
  spreadsheet: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  word_document: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  presentation: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const EXT_BY_KIND: Record<OfficeKind, string> = {
  spreadsheet: "xlsx",
  word_document: "docx",
  presentation: "pptx",
};

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

function sanitizeTitle(input: string): string {
  return String(input || "documento")
    .trim()
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 120) || "documento";
}

function toStringCell(v: CellValue): string | number | boolean {
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (v === null || v === undefined) return "";
  return String(v);
}

function validateRequest(body: unknown): RenderRequest {
  if (!body || typeof body !== "object") throw new Error("Solicitud inválida.");
  const req = body as Partial<RenderRequest>;
  if (!req.title || typeof req.title !== "string") throw new Error("title es obligatorio.");
  if (!req.requested_kind || !["spreadsheet", "word_document", "presentation"].includes(req.requested_kind)) {
    throw new Error("requested_kind inválido.");
  }
  if (typeof req.confidence !== "number" || Number.isNaN(req.confidence) || req.confidence < 0 || req.confidence > 1) {
    throw new Error("confidence debe estar entre 0 y 1.");
  }
  return req as RenderRequest;
}

function buildPreview(req: RenderRequest): string {
  if (req.preview_markdown && req.preview_markdown.trim()) return req.preview_markdown.trim();
  if (req.requested_kind === "spreadsheet") {
    const sheetCount = req.spreadsheet?.sheets?.length || 0;
    return `# ${req.title}\n\nSe generó un archivo Excel con ${sheetCount} hoja(s).`;
  }
  if (req.requested_kind === "presentation") {
    const slideCount = req.presentation?.slides?.length || 0;
    return `# ${req.title}\n\nSe generó una presentación con ${slideCount} diapositiva(s).`;
  }
  return `# ${req.title}\n\nSe generó un documento Word con estructura de secciones.`;
}

function renderSpreadsheet(payload: SpreadsheetPayload | undefined): Uint8Array {
  const sheets = payload?.sheets || [];
  if (!sheets.length) throw new Error("spreadsheet.sheets debe incluir al menos una hoja.");
  const wb = XLSX.utils.book_new();

  sheets.slice(0, 12).forEach((sheet, idx) => {
    const rows = (sheet.rows || []).slice(0, 5000).map((r) => (r.cells || []).slice(0, 80).map(toStringCell));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const name = (sheet.name || `Hoja${idx + 1}`).slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, name);
  });

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new Uint8Array(out as ArrayBuffer);
}

function textParagraph(text: string): Paragraph {
  return new Paragraph({ children: [new TextRun(String(text || ""))] });
}

function renderWord(payload: WordPayload | undefined): Promise<Uint8Array> {
  const sections = payload?.sections || [];
  if (!sections.length) throw new Error("word_document.sections debe incluir al menos una sección.");

  const children: Array<Paragraph | Table> = [];
  for (const section of sections.slice(0, 120)) {
    if (section.heading) {
      children.push(new Paragraph({ text: section.heading, heading: HeadingLevel.HEADING_2 }));
    }
    for (const p of (section.paragraphs || []).slice(0, 40)) {
      children.push(textParagraph(p));
    }
    for (const table of (section.tables || []).slice(0, 15)) {
      const rows: TableRow[] = [];
      if (table.headers?.length) {
        rows.push(
          new TableRow({
            children: table.headers.slice(0, 12).map((h) => new TableCell({ children: [textParagraph(h)] })),
          }),
        );
      }
      for (const row of table.rows.slice(0, 200)) {
        rows.push(
          new TableRow({
            children: row.slice(0, 12).map((cell) => new TableCell({ children: [textParagraph(cell)] })),
          }),
        );
      }
      if (rows.length > 0) {
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows,
          }),
        );
      }
    }
  }

  const doc = new Document({
    sections: [{ children: children.length ? children : [textParagraph("Documento generado sin contenido.")] }],
  });
  return Packer.toUint8Array(doc);
}

async function renderPresentation(payload: PresentationPayload | undefined): Promise<Uint8Array> {
  const slides = payload?.slides || [];
  if (!slides.length) throw new Error("presentation.slides debe incluir al menos una diapositiva.");

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Kawiil AI";
  pptx.subject = "Documento generado por IA";

  for (const s of slides.slice(0, 80)) {
    const slide = pptx.addSlide();
    const title = s.title || "Diapositiva";
    slide.addText(title, {
      x: 0.5,
      y: 0.2,
      w: 12.3,
      h: 0.6,
      bold: true,
      fontSize: 24,
    });

    if (s.bullets?.length) {
      const bulletRuns = s.bullets.slice(0, 14).map((b) => ({ text: b, options: { bullet: { indent: 18 } } }));
      slide.addText(bulletRuns, { x: 0.7, y: 1.1, w: 11.8, h: 4.2, fontSize: 16 });
    }

    if (s.table?.rows?.length || s.table?.headers?.length) {
      const rows: string[][] = [];
      if (s.table.headers?.length) rows.push(s.table.headers.slice(0, 8));
      rows.push(...(s.table.rows || []).slice(0, 12).map((r) => r.slice(0, 8)));
      if (rows.length) {
        slide.addTable(rows, { x: 0.7, y: 3.3, w: 11.7, h: 2.8, fontSize: 11, border: { pt: 1, color: "C9CED6" } });
      }
    }

    if (s.notes) {
      (slide as unknown as { addNotes?: (notes: string) => void }).addNotes?.(s.notes);
    }
  }

  const arr = await pptx.write({ outputType: "arraybuffer" });
  return new Uint8Array(arr as ArrayBuffer);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = validateRequest(await req.json());
    let bytes: Uint8Array;
    if (payload.requested_kind === "spreadsheet") {
      bytes = renderSpreadsheet(payload.spreadsheet);
    } else if (payload.requested_kind === "word_document") {
      bytes = await renderWord(payload.word_document);
    } else {
      bytes = await renderPresentation(payload.presentation);
    }

    const ext = EXT_BY_KIND[payload.requested_kind];
    const mime = MIME_BY_KIND[payload.requested_kind];
    const safe = sanitizeTitle(payload.title);

    return new Response(
      JSON.stringify({
        success: true,
        requested_kind: payload.requested_kind,
        confidence: payload.confidence,
        file_name: `${safe}.${ext}`,
        file_ext: ext,
        mime_type: mime,
        content_base64: uint8ArrayToBase64(bytes),
        preview_markdown: buildPreview(payload),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
