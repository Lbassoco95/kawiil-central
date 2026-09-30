/**
 * Prueba manual: extracción de texto DOCX (mismo patrón que processAttachmentFile).
 *   cd supabase/functions/ai-chat && deno run -A verify-docx-extract.ts [ruta.docx]
 */

const XLSX_PROCESS_MAX_BYTES = 18 * 1024 * 1024;
const CHAT_TEXT_EXTRACT_MAX = 80_000;

function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n\n[…contenido truncado por tamaño…]";
}

function decodeXmlTextEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => {
      const cp = parseInt(h, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
    })
    .replace(/&#(\d+);/g, (_, n) => {
      const cp = Number(n);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : "";
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function docxBytesToText(bytes: Uint8Array): Promise<string> {
  if (bytes.length > XLSX_PROCESS_MAX_BYTES) {
    return `[Word demasiado grande]`;
  }
  const JSZip = (await import("npm:jszip@3.10.1")).default;
  const zip = await JSZip.loadAsync(bytes);
  const xmlPaths = Object.keys(zip.files).filter((n) =>
    /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/i.test(n)
  );
  xmlPaths.sort((a, b) => {
    if (/document\.xml$/i.test(a)) return -1;
    if (/document\.xml$/i.test(b)) return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
  const parts: string[] = [];
  for (const path of xmlPaths.slice(0, 40)) {
    const xml = await zip.file(path)?.async("string");
    if (!xml) continue;
    const text = decodeXmlTextEntities(
      xml
        .replace(/<\/w:p>/gi, "\n")
        .replace(/<w:tab[^>]*\/>/gi, "\t")
        .replace(/<w:br[^>]*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/^[ \t]+/gm, "")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim(),
    );
    if (!text.length) continue;
    if (/document\.xml$/i.test(path)) parts.push(text);
    else parts.push(`## ${path}\n${text}`);
  }
  if (parts.length === 0) return "[sin texto]";
  return truncateText(parts.join("\n\n"), CHAT_TEXT_EXTRACT_MAX);
}

async function buildSampleDocx(): Promise<Uint8Array> {
  const JSZip = (await import("npm:jszip@3.10.1")).default;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hola Leopoldo</w:t></w:r></w:p>
    <w:p><w:r><w:t>Convo Riesgo: párrafo con &amp; entidades.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Línea tres del documento de prueba.</w:t></w:r></w:p>
  </w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

const arg = Deno.args[0];
const bytes = arg ? await Deno.readFile(arg) : await buildSampleDocx();
const text = await docxBytesToText(bytes);
console.log("---EXTRACTED---");
console.log(text);
if (!arg) {
  if (!text.includes("Hola Leopoldo") || !text.includes("Convo Riesgo") || !text.includes("& entidades")) {
    console.error("FAIL: expected phrases missing");
    Deno.exit(1);
  }
  console.log("OK sample docx extraction");
}
