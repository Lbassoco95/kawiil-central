/**
 * Markdown ligero para render DOCX/PDF: el modelo suele meter **negrita**, *cursiva*
 * y ## encabezados dentro de strings JSON aunque el esquema sea "estructurado".
 */

export type MarkdownTextSegment = {
  text: string;
  bold?: boolean;
  italics?: boolean;
};

export type MarkdownBodyBlock =
  | { kind: "heading"; level: number; title: string }
  | { kind: "paragraph"; text: string };

/** Una línea que es solo encabezado Markdown (# … ######). */
export function parseMarkdownHeadingLine(line: string): { level: number; title: string } | null {
  const t = line.trim();
  const m = t.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (!m) return null;
  return { level: Math.min(m[1].length, 6), title: m[2].trim() };
}

/**
 * Divide texto en segmentos planos / negrita / cursiva.
 * Orden: primero **…**, luego _…_, luego *…* (asterisco simple, sin **).
 */
export function splitInlineMarkdownSegments(raw: string): MarkdownTextSegment[] {
  const text = raw.replace(/\r\n/g, "\n");
  if (!text) return [{ text: "" }];

  const segments: MarkdownTextSegment[] = [];
  let i = 0;

  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        segments.push({ text: text.slice(i + 2, end), bold: true });
        i = end + 2;
        continue;
      }
      segments.push({ text: "*" });
      i += 1;
      continue;
    }

    if (text[i] === "_" && i + 1 < text.length && /[^\s_]/.test(text[i + 1])) {
      const end = text.indexOf("_", i + 1);
      if (end > i + 1) {
        segments.push({ text: text.slice(i + 1, end), italics: true });
        i = end + 1;
        continue;
      }
    }

    if (text[i] === "*" && text[i + 1] !== "*") {
      const end = text.indexOf("*", i + 1);
      if (end > i + 1 && text[end + 1] !== "*") {
        segments.push({ text: text.slice(i + 1, end), italics: true });
        i = end + 1;
        continue;
      }
    }

    let j = i;
    while (j < text.length) {
      if (text.startsWith("**", j)) break;
      if (text[j] === "_" && j + 1 < text.length && /[^\s_]/.test(text[j + 1])) break;
      if (text[j] === "*" && text[j + 1] !== "*") break;
      j++;
    }

    if (j > i) {
      segments.push({ text: text.slice(i, j) });
      i = j;
    } else {
      segments.push({ text: text[i] });
      i += 1;
    }
  }

  const merged = segments.filter((s) => s.text.length > 0);
  return merged.length ? merged : [{ text }];
}

/** Convierte saltos de línea en bloques: líneas ## son encabezados; líneas seguidas forman un párrafo. */
export function flattenMarkdownBodyChunk(chunk: string): MarkdownBodyBlock[] {
  const c = chunk.replace(/\r\n/g, "\n").trim();
  if (!c) return [];

  const lines = c.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (!lines.length) return [];

  const out: MarkdownBodyBlock[] = [];
  let bodyLines: string[] = [];

  const flushBody = () => {
    if (!bodyLines.length) return;
    out.push({ kind: "paragraph", text: bodyLines.join(" ") });
    bodyLines = [];
  };

  for (const line of lines) {
    const h = parseMarkdownHeadingLine(line);
    if (h) {
      flushBody();
      out.push({ kind: "heading", level: h.level, title: h.title });
    } else {
      bodyLines.push(line);
    }
  }
  flushBody();

  return out.length ? out : [{ kind: "paragraph", text: c }];
}

/** Nivel de encabezado para templates que solo usan H1–H3 en cuerpo. */
export function capHeadingLevel(level: number): 1 | 2 | 3 {
  if (level <= 1) return 1;
  if (level === 2) return 2;
  return 3;
}

/** Elimina marcadores Markdown para celdas Excel / texto plano en PPTX (sin formato enriquecido). */
export function markdownToPlainDisplay(raw: string): string {
  const c = raw.replace(/\r\n/g, "\n").trim();
  if (!c) return "";
  const blocks = flattenMarkdownBodyChunk(c);
  if (!blocks.length) {
    return splitInlineMarkdownSegments(c).map((s) => s.text).join("");
  }
  const lines = blocks.map((b) =>
    b.kind === "heading"
      ? splitInlineMarkdownSegments(b.title).map((s) => s.text).join("")
      : splitInlineMarkdownSegments(b.text).map((s) => s.text).join("")
  );
  return lines.join("\n\n");
}
