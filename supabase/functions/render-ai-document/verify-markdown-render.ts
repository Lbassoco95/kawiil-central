/**
 * Prueba manual del pipeline Markdown → DOCX/PDF/XLSX/PPTX (artefacto genérico).
 * Ejecutar:
 *   cd supabase/functions/render-ai-document && deno run -A verify-markdown-render.ts
 */
import { normalizeTemplateData, resolveBranding } from "../_shared/ai-templates/index.ts";
import { renderKawiilDocx } from "./docx.ts";
import { renderKawiilPdf } from "./pdf.ts";
import { renderKawiilXlsx } from "./xlsx.ts";
import { renderKawiilPptx } from "./pptx.ts";

const rawContent = {
  summary:
    "Este es el **resumen ejecutivo** con *énfasis*.\n\n## Subtítulo dentro del resumen\n\nMás texto normal.",
  sections: [
    {
      heading: "## Primera parte",
      paragraphs: [
        "La **RFC** del cliente es obligatoria y debe ir en _formato correcto_.",
      ],
      bullets: [
        "Punto con **negritas**",
        "Otro con *cursiva simple*",
      ],
      tables: [
        {
          headers: ["Etiqueta", "Contenido"],
          rows: [
            ["**Nombre legal**", "Empresa Demo SA"],
            ["RFC", "**XYZ987654321**"],
          ],
        },
      ],
      callout: {
        kind: "info" as const,
        title: "**Importante**",
        body: "Detalle con *observaciones* del modelo.",
      },
    },
  ],
};

async function readDocxMainXml(docxPath: string): Promise<string> {
  const cmd = new Deno.Command("unzip", {
    args: ["-p", docxPath, "word/document.xml"],
    stdout: "piped",
    stderr: "piped",
  });
  const out = await cmd.output();
  if (!out.success) {
    throw new Error(`unzip falló: ${new TextDecoder().decode(out.stderr)}`);
  }
  return new TextDecoder().decode(out.stdout);
}

function assertNoMarkdownLiteralsXml(xml: string, label: string) {
  const tw = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ");
  const badDouble = tw.includes("**");
  const badHash = /\s##\s/.test(tw) || tw.includes("## ");
  if (badDouble || badHash) {
    console.error(`[${label}] fragmento agregado de w:t (muestra):`, tw.slice(0, 400));
    throw new Error(
      `[${label}] Aún aparecen marcadores Markdown en DOCX (${badDouble ? "** " : ""}${badHash ? "## " : ""}).`,
    );
  }
}

function assertPdfNoObviousLiterals(pdfBytes: Uint8Array) {
  const raw = new TextDecoder("latin1", { fatal: false }).decode(pdfBytes);
  if (raw.includes("**")) {
    throw new Error("PDF binario contiene la secuencia '**' (posible Markdown literal).");
  }
}

async function unzipOfficeZip(zipPath: string, destDir: string): Promise<void> {
  await Deno.mkdir(destDir, { recursive: true });
  const cmd = new Deno.Command("unzip", {
    args: ["-q", "-o", zipPath, "-d", destDir],
    stderr: "piped",
  });
  const out = await cmd.output();
  if (!out.success) {
    throw new Error(`unzip ${zipPath}: ${new TextDecoder().decode(out.stderr)}`);
  }
}

async function collectXmlTexts(dir: string): Promise<string> {
  const parts: string[] = [];
  async function walk(d: string) {
    for await (const e of Deno.readDir(d)) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory) await walk(p);
      else if (e.name.endsWith(".xml")) {
        parts.push(await Deno.readTextFile(p));
      }
    }
  }
  await walk(dir);
  return parts.join("\n");
}

function assertOfficeXmlNoMarkdownStars(xmlConcat: string, label: string) {
  if (xmlConcat.includes("**")) {
    throw new Error(`${label}: XML OOXML aún contiene '**'.`);
  }
}

const data = normalizeTemplateData("generico", rawContent);
const branding = resolveBranding({ org_name: "Kawiil QA" });

const title = "Prueba Markdown genérico";
const input = {
  templateKey: "generico" as const,
  title,
  data,
  branding,
};

const outDir = await Deno.makeTempDir({ prefix: "kawiil-md-verify-" });
const docxPath = `${outDir}/prueba.docx`;
const pdfPath = `${outDir}/prueba.pdf`;
const xlsxPath = `${outDir}/prueba.xlsx`;
const pptxPath = `${outDir}/prueba.pptx`;

const docxBuf = await renderKawiilDocx(input);
await Deno.writeFile(docxPath, docxBuf);

const pdfBuf = await renderKawiilPdf(input);
await Deno.writeFile(pdfPath, pdfBuf);

const xlsxBuf = await renderKawiilXlsx(input);
await Deno.writeFile(xlsxPath, xlsxBuf);

const pptxBuf = await renderKawiilPptx(input);
await Deno.writeFile(pptxPath, pptxBuf);

const xml = await readDocxMainXml(docxPath);
assertNoMarkdownLiteralsXml(xml, "DOCX");
assertPdfNoObviousLiterals(pdfBuf);

const xlsxUnzip = `${outDir}/xlsx-xml`;
await unzipOfficeZip(xlsxPath, xlsxUnzip);
assertOfficeXmlNoMarkdownStars(await collectXmlTexts(xlsxUnzip), "XLSX");

const pptxUnzip = `${outDir}/pptx-xml`;
await unzipOfficeZip(pptxPath, pptxUnzip);
assertOfficeXmlNoMarkdownStars(await collectXmlTexts(pptxUnzip), "PPTX");

console.log("OK — Prueba Markdown render:");
console.log(`  DOCX: ${docxPath} (${docxBuf.byteLength} bytes)`);
console.log(`  PDF:  ${pdfPath} (${pdfBuf.byteLength} bytes)`);
console.log(`  XLSX: ${xlsxPath} (${xlsxBuf.byteLength} bytes)`);
console.log(`  PPTX: ${pptxPath} (${pptxBuf.byteLength} bytes)`);
console.log("Sin '**' en DOCX (w:t), PDF, ni XML de XLSX/PPTX.");
