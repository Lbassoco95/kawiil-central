// =============================================================
// Markdown → Kawiil "generico" content parser.
//
// Convierte markdown libre (headings ##, bullets, tablas |col|col|) en la
// estructura que espera el template `generico` de `render-ai-document`.
//
// Se usa:
//   - en `ai-chat` durante el auto-upgrade de `create_artifact` para generar
//     PDF+DOCX (+ XLSX/PPTX heurísticos) a partir del markdown libre.
//   - en `reconcile-ai-artifact-formats` para rehidratar artefactos legacy
//     que solo tienen markdown y aún no tienen `output_formats`.
// =============================================================

export type KawiilOutputFormat = "pdf" | "docx" | "xlsx" | "pptx";

export interface GenericSection {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
  tables?: Array<{ headers: string[]; rows: string[][] }>;
}

export interface GenericContent {
  summary?: string;
  sections: GenericSection[];
}

function parseMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((c) => c.trim());
}

function isTableSeparator(line: string): boolean {
  const cells = parseMarkdownTableRow(line);
  if (!cells.length) return false;
  return cells.every((c) => /^:?-{2,}:?$/.test(c));
}

function isTableLine(line: string): boolean {
  const t = line.trim();
  if (!t.startsWith("|") || !t.endsWith("|")) return false;
  return t.length > 2;
}

export function markdownToGenericContent(markdown: string, _title: string): GenericContent {
  const raw = (markdown || "").replace(/\r\n/g, "\n");
  const lines = raw.split("\n");
  const sections: GenericSection[] = [];
  let summary: string | undefined;
  let current: GenericSection | null = null;

  let paraBuffer: string[] = [];
  let bulletBuffer: string[] = [];
  let tableBuffer: string[][] = [];
  let tableHeaders: string[] | null = null;
  let inTable = false;
  let inCodeFence = false;
  let codeBuffer: string[] = [];

  const getTarget = (): GenericSection => {
    if (!current) {
      current = {};
      sections.push(current);
    }
    return current;
  };

  const flushParagraph = () => {
    if (!paraBuffer.length) return;
    const text = paraBuffer.join(" ").replace(/\s+/g, " ").trim();
    paraBuffer = [];
    if (!text) return;
    if (!current && !sections.length && !summary) {
      summary = text;
      return;
    }
    const target = getTarget();
    target.paragraphs = target.paragraphs || [];
    target.paragraphs.push(text);
  };

  const flushBullets = () => {
    if (!bulletBuffer.length) return;
    const target = getTarget();
    target.bullets = target.bullets || [];
    target.bullets.push(...bulletBuffer);
    bulletBuffer = [];
  };

  const flushTable = () => {
    if (!inTable) return;
    inTable = false;
    const headers = tableHeaders || [];
    const rows = tableBuffer;
    tableHeaders = null;
    tableBuffer = [];
    if (!headers.length && !rows.length) return;
    const target = getTarget();
    target.tables = target.tables || [];
    target.tables.push({ headers, rows });
  };

  const flushCodeBlock = () => {
    if (!codeBuffer.length) return;
    const text = codeBuffer.join("\n").trim();
    codeBuffer = [];
    if (!text) return;
    const target = getTarget();
    target.paragraphs = target.paragraphs || [];
    target.paragraphs.push(text);
  };

  const flushAll = () => {
    flushParagraph();
    flushBullets();
    flushTable();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCodeFence) {
        inCodeFence = false;
        flushCodeBlock();
      } else {
        flushAll();
        inCodeFence = true;
      }
      continue;
    }
    if (inCodeFence) {
      codeBuffer.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushBullets();
      flushTable();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      flushAll();
      const heading = headingMatch[2].trim();
      if (headingMatch[1].length === 1 && !sections.length && !summary && !current) {
        continue;
      }
      current = { heading };
      sections.push(current);
      continue;
    }

    if (isTableLine(trimmed)) {
      flushParagraph();
      flushBullets();
      const cells = parseMarkdownTableRow(trimmed);
      if (!inTable) {
        const next = (lines[i + 1] || "").trim();
        if (isTableLine(next) && isTableSeparator(next)) {
          inTable = true;
          tableHeaders = cells;
          i += 1;
          continue;
        }
      } else {
        if (isTableSeparator(trimmed)) continue;
        tableBuffer.push(cells);
        continue;
      }
    } else if (inTable) {
      flushTable();
    }

    const bulletMatch = trimmed.match(/^(?:[-*+]|\d+\.)\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      bulletBuffer.push(bulletMatch[1].trim());
      continue;
    } else if (bulletBuffer.length) {
      flushBullets();
    }

    if (trimmed.startsWith(">")) {
      paraBuffer.push(trimmed.replace(/^>\s?/, ""));
      continue;
    }

    paraBuffer.push(trimmed);
  }

  flushAll();
  if (inCodeFence) flushCodeBlock();

  if (!sections.length) {
    sections.push({
      paragraphs: summary ? [summary] : ["(Sin contenido.)"],
    });
    if (summary) summary = undefined;
  }

  return { summary, sections };
}

/**
 * Heurística: decide si conviene incluir XLSX/PPTX además de PDF+DOCX a partir
 * del markdown + su representación genérica.
 *
 * - XLSX: hay ≥1 tabla con ≥3 columnas y ≥5 filas de datos.
 * - PPTX: el documento se estructura como slides (headings "Slide N:" /
 *   "Diapositiva N:" o ≥3 separadores `---`).
 */
export function detectExtraFormats(
  markdown: string,
  generic: GenericContent,
): KawiilOutputFormat[] {
  const extra = new Set<KawiilOutputFormat>();

  const bigTable = (generic.sections || []).some((s) =>
    (s.tables || []).some((t) => (t.headers?.length || 0) >= 3 && (t.rows?.length || 0) >= 5)
  );
  if (bigTable) extra.add("xlsx");

  const raw = markdown || "";
  const slideHeadings = /\b(?:slide|diapositiva)\s*\d+/i.test(raw);
  const hrCount = (raw.match(/^\s*---\s*$/gm) || []).length;
  const slideHeadingCount = (raw.match(/^#{1,6}\s+(?:slide|diapositiva)\b/gim) || []).length;
  if (slideHeadings || hrCount >= 3 || slideHeadingCount >= 3) extra.add("pptx");

  return Array.from(extra);
}
