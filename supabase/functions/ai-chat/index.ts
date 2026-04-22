import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { DB } from "https://deno.land/x/sqlite@v3.7.1/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": '*',
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
/** Reintentos con backoff ante 429, 529 (overload) y 503 transitorios. */
const ANTHROPIC_RETRY_MAX_ATTEMPTS = 7;

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function anthropicErrorTypeFromBody(errText: string): string | undefined {
  try {
    const j = JSON.parse(errText) as { error?: { type?: string } };
    return j?.error?.type;
  } catch {
    return undefined;
  }
}

/** True si conviene reintentar el POST a /v1/messages. */
function anthropicResponseIsRetryable(status: number, errText: string): boolean {
  const t = anthropicErrorTypeFromBody(errText);
  if (t === "overloaded_error" || t === "rate_limit_error") return true;
  if (errText.includes("overloaded_error")) return true;
  return status === 429 || status === 529 || status === 503;
}

/** POST a /v1/messages con reintentos si Anthropic responde 429, 529 u overload en cuerpo. */
async function anthropicMessagesFetch(apiKey: string, body: Record<string, unknown>): Promise<Response> {
  let lastErrText = '{"error":{"type":"unknown"}}';
  let lastStatus = 500;

  for (let attempt = 0; attempt < ANTHROPIC_RETRY_MAX_ATTEMPTS; attempt++) {
    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) return resp;

    const errText = await resp.text();
    lastErrText = errText;
    lastStatus = resp.status;

    const retryable =
      attempt < ANTHROPIC_RETRY_MAX_ATTEMPTS - 1 && anthropicResponseIsRetryable(resp.status, errText);

    if (!retryable) {
      return new Response(errText, {
        status: resp.status,
        headers: { "content-type": resp.headers.get("content-type") || "application/json" },
      });
    }

    let waitMs = Math.min(90_000, 3000 * 2 ** attempt);
    if (resp.status === 529 || resp.status === 503 || anthropicErrorTypeFromBody(errText) === "overloaded_error") {
      waitMs = Math.min(120_000, Math.max(waitMs, 4000 * 2 ** attempt));
    }

    const retryHdr = resp.headers.get("retry-after");
    if (retryHdr) {
      const sec = parseInt(retryHdr, 10);
      if (!Number.isNaN(sec) && sec > 0) waitMs = Math.min(120_000, sec * 1000);
    }
    try {
      const j = JSON.parse(errText);
      const ra = j?.error?.retry_after ?? j?.retry_after;
      if (typeof ra === "number" && ra > 0) waitMs = Math.min(120_000, Math.max(waitMs, ra * 1000));
    } catch {
      /* ignore */
    }

    console.warn(
      `Anthropic ${resp.status} (${anthropicErrorTypeFromBody(errText) || "?"}), reintento ${attempt + 2}/${ANTHROPIC_RETRY_MAX_ATTEMPTS} en ${waitMs}ms`,
    );
    await sleepMs(waitMs);
  }

  return new Response(lastErrText, {
    status: lastStatus,
    headers: { "content-type": "application/json" },
  });
}

/** Se lanza desde handleClaudeChat y se traduce a HTTP 402 + JSON con code estable. */
const ANTHROPIC_BILLING_THROW = "ANTHROPIC_BILLING_LOW";
const CLIENT_CODE_ANTHROPIC_BILLING = "anthropic_billing";
const MSG_ANTHROPIC_BILLING_ES =
  "Los créditos de la cuenta de Anthropic (Claude) están agotados o son insuficientes. " +
  "Un administrador debe añadir créditos en https://console.anthropic.com (Plans & Billing) y comprobar el secreto ANTHROPIC_API_KEY en Supabase.";

function textLooksLikeAnthropicBilling(errText: string): boolean {
  const t = errText.toLowerCase();
  return (
    t.includes("credit balance is too low") ||
    t.includes("credit balance too low") ||
    (t.includes("purchase credits") && t.includes("billing"))
  );
}

function isAnthropicCreditBalanceLow(status: number, errText: string): boolean {
  return status === 400 && textLooksLikeAnthropicBilling(errText);
}

function responseAnthropicBilling(): Response {
  return new Response(
    JSON.stringify({
      error: MSG_ANTHROPIC_BILLING_ES,
      message: MSG_ANTHROPIC_BILLING_ES,
      code: CLIENT_CODE_ANTHROPIC_BILLING,
    }),
    { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

function escapePostgrestString(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_')
    .replace(/,/g, '\\,')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

const CHAT_ATTACH_MAX_FILES = 20;
const CHAT_ATTACH_MAX_BYTES = 20 * 1024 * 1024;
const CHAT_ATTACH_BATCH_MAX_BYTES = 100 * 1024 * 1024;
/** Texto máximo enviado al modelo por adjunto (menos RAM en Edge y cuerpos HTTP más livianos). */
const CHAT_TEXT_EXTRACT_MAX = 80_000;
/** Por encima: extracción por páginas (extractText mergePages completo solo en PDFs ≤ este umbral). */
const PDF_MEDIUM_USE_PAGE_EXTRACT_BYTES = 1.25 * 1024 * 1024;
/** Intentar texto por páginas hasta este tamaño de archivo. */
const PDF_PAGE_EXTRACT_MAX_BYTES = 20 * 1024 * 1024;
/** Máximo de páginas a recorrer (cada getPage consume memoria). */
const PDF_PAGE_EXTRACT_MAX_PAGES = 40;
/**
 * Imagen vía base64: ~4/3 expansión; un solo JPEG de 2MB puede superar el tope de 200k tokens de Claude.
 * Límite conservador para que imagen + historial + tools quepan.
 */
const IMAGE_MULTIMODAL_MAX_BYTES = 512 * 1024;
/** Excel: por encima se rechaza antes de XLSX.read (evita OOM). */
const XLSX_PROCESS_MAX_BYTES = 18 * 1024 * 1024;
const XLSX_LARGE_FILE_BYTES = 6 * 1024 * 1024;
const XLSX_HUGE_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Presupuesto por **tokens estimados** en `messages` (no caracteres: base64 de imágenes pesa ~1 token cada ~12 chars en la práctica).
 * System + definición de tools también consumen contexto; dejamos margen bajo 200k totales.
 */
const MAX_CLAUDE_MESSAGES_ESTIMATED_TOKENS = 130_000;
/** System + contexto proyecto/memorias: truncar para dejar margen a mensajes y tools. */
const MAX_SYSTEM_PROMPT_CHARS = 95_000;
/** Cada tool_result no debe exceder esto (JSON de tareas, búsquedas, etc.). */
const MAX_TOOL_RESULT_CHARS = 28_000;
/** Contenido devuelto por memory view (archivos muy grandes saturan el contexto). */
const MAX_MEMORY_VIEW_CHARS = 64_000;

function truncateForToolResult(payload: string, maxChars: number): string {
  if (payload.length <= maxChars) return payload;
  return payload.slice(0, maxChars) +
    `\n\n[…resultado truncado por tamaño (${payload.length} caracteres); pide menos filas o un rango más acotado…]`;
}

function clampSystemPromptForClaude(system: string): string {
  if (system.length <= MAX_SYSTEM_PROMPT_CHARS) return system;
  return truncateText(system, MAX_SYSTEM_PROMPT_CHARS);
}

/** Tokens aproximados por bloque; base64 (imagen/documento) usa ~1 token / 12 chars en la práctica hacia el tope de 200k. */
function estimateBlockTokens(block: Record<string, unknown>): number {
  const typ = block.type;
  if (typ === "text" && typeof block.text === "string") {
    return Math.max(1, Math.ceil(block.text.length / 4));
  }
  if (typ === "tool_result" && typeof block.content === "string") {
    return Math.max(1, Math.ceil(block.content.length / 4));
  }
  if (typ === "tool_use") {
    return Math.max(1, Math.ceil(JSON.stringify(block).length / 4));
  }
  if (typ === "image") {
    const data = (block.source as { data?: string } | undefined)?.data;
    if (typeof data === "string") return Math.max(1, Math.ceil(data.length / 12));
    return 500;
  }
  if (typ === "document") {
    const data = (block.source as { data?: string } | undefined)?.data;
    if (typeof data === "string") return Math.max(1, Math.ceil(data.length / 12));
    return 500;
  }
  try {
    return Math.max(1, Math.ceil(JSON.stringify(block).length / 4));
  } catch {
    return 100;
  }
}

function estimateContentTokensApprox(content: unknown): number {
  if (content === null || content === undefined) return 0;
  if (typeof content === "string") return Math.max(1, Math.ceil(content.length / 4));
  if (!Array.isArray(content)) return Math.max(1, Math.ceil(String(content).length / 4));
  let n = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    n += estimateBlockTokens(block as Record<string, unknown>);
  }
  return n;
}

function estimateMessagesTokens(msgs: { role: string; content: unknown }[]): number {
  return msgs.reduce((acc, m) => acc + estimateContentTokensApprox(m.content), 0);
}

function contentHasToolUse(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((b) => b && typeof b === "object" && (b as { type?: string }).type === "tool_use");
}

function contentIsOnlyToolResults(content: unknown): boolean {
  if (!Array.isArray(content) || content.length === 0) return false;
  return content.every((b) => b && typeof b === "object" && (b as { type?: string }).type === "tool_result");
}

/**
 * Elimina prefijos completos (user+assistant o trío tool_use/tool_result) desde el inicio
 * hasta quedar bajo el presupuesto en **tokens estimados**, sin dejar tool_result huérfanos.
 */
function pruneClaudeMessages(msgs: any[], maxEstTokens: number): any[] {
  if (msgs.length === 0) return msgs;
  const working = [...msgs];
  let guard = 0;
  while (working.length > 1 && estimateMessagesTokens(working) > maxEstTokens && guard < 400) {
    guard += 1;
    if (working[0].role !== "user") {
      working.shift();
      continue;
    }
    const u0 = working[0];
    const a1 = working[1];
    if (a1?.role === "assistant" && contentHasToolUse(a1.content)) {
      const u2 = working[2];
      if (u2?.role === "user" && contentIsOnlyToolResults(u2.content)) {
        working.splice(0, 3);
        continue;
      }
      break;
    }
    if (a1?.role === "assistant") {
      working.splice(0, 2);
      continue;
    }
    break;
  }
  while (estimateMessagesTokens(working) > maxEstTokens && working.length >= 3) {
    if (
      working[0].role === "user" &&
      working[1]?.role === "assistant" &&
      contentHasToolUse(working[1].content) &&
      working[2]?.role === "user" &&
      contentIsOnlyToolResults(working[2].content)
    ) {
      working.splice(0, 3);
      continue;
    }
    break;
  }
  while (
    estimateMessagesTokens(working) > maxEstTokens &&
    working.length >= 2 &&
    working[0].role === "user" &&
    working[1]?.role === "assistant" &&
    !contentHasToolUse(working[1].content)
  ) {
    working.splice(0, 2);
  }
  if (working.length === 0) {
    const last = msgs[msgs.length - 1];
    return last ? [last] : [];
  }
  while (working.length > 0 && working[0].role !== "user") {
    working.shift();
  }
  if (working.length === 0) {
    const last = msgs[msgs.length - 1];
    return last ? [last] : [];
  }
  if (estimateMessagesTokens(working) > maxEstTokens && working.length === 1 && working[0].role === "user") {
    const c = working[0].content;
    const charBudget = Math.min(Math.max((maxEstTokens - 1500) * 4, 8_000), 48_000);
    if (typeof c === "string") {
      working[0] = { ...working[0], content: truncateText(c, charBudget) };
    } else if (Array.isArray(c)) {
      const downgraded: any[] = [];
      for (const block of c) {
        if (block && typeof block === "object" && (block as { type?: string }).type === "image") {
          downgraded.push({
            type: "text",
            text:
              "[Imagen omitida por límite de contexto del modelo: adjunta una imagen ≤ 512 KB o descríbela en texto.]",
          });
          continue;
        }
        if (
          block && typeof block === "object" && (block as { type?: string }).type === "text" &&
          typeof (block as { text?: string }).text === "string"
        ) {
          const b = block as { text: string; type?: string };
          downgraded.push({ ...b, text: truncateText(b.text, charBudget) });
          continue;
        }
        downgraded.push(block);
      }
      working[0] = { ...working[0], content: downgraded };
    }
  }
  return working;
}

function isAnthropicPromptTooLongMessage(errText: string): boolean {
  const t = errText.toLowerCase();
  return t.includes("prompt is too long") || t.includes("too many tokens") || t.includes("context length");
}

/** Evita que un tool_use (p. ej. create_artifact con texto enorme) infle el contexto en rondas siguientes. */
const MAX_TOOL_USE_STRING_FIELD_CHARS = 24_000;

function clampToolUseInputsInAssistantBlocks(blocks: any[]): any[] {
  if (!Array.isArray(blocks)) return blocks;
  return blocks.map((b) => {
    if (!b || typeof b !== "object" || b.type !== "tool_use") return b;
    const input = b.input;
    if (!input || typeof input !== "object") return b;
    const next: Record<string, unknown> = { ...input };
    for (const k of Object.keys(next)) {
      const v = next[k];
      if (typeof v === "string" && v.length > MAX_TOOL_USE_STRING_FIELD_CHARS) {
        next[k] =
          v.slice(0, MAX_TOOL_USE_STRING_FIELD_CHARS) + "\n[…campo truncado por límite de contexto…]";
      }
    }
    return { ...b, input: next };
  });
}

async function assertAiProjectAccess(
  svc: ReturnType<typeof createClient>,
  aiProjectId: string | null | undefined,
  userId: string,
  orgId: string | null | undefined,
): Promise<{ ok: boolean; error?: string }> {
  if (!aiProjectId) return { ok: true };
  if (!orgId) return { ok: false, error: "Sin organización" };
  const { data: ap } = await svc.from("ai_projects")
    .select("id, organization_id, user_id")
    .eq("id", aiProjectId)
    .maybeSingle();
  if (!ap) return { ok: false, error: "Proyecto de IA no encontrado" };
  if (ap.organization_id !== orgId) return { ok: false, error: "Acceso denegado al proyecto" };
  if (ap.user_id === userId) return { ok: true };
  const { data: mem } = await svc.from("ai_project_members")
    .select("role")
    .eq("ai_project_id", aiProjectId)
    .eq("user_id", userId)
    .maybeSingle();
  if (mem) return { ok: true };
  return { ok: false, error: "No eres miembro de este proyecto de IA" };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}

function isLikelySqlite(bytes: Uint8Array): boolean {
  const sig = new TextDecoder().decode(bytes.subarray(0, 16));
  return sig.startsWith("SQLite format 3");
}

async function downloadStorageObject(
  svc: ReturnType<typeof createClient>,
  bucket: string,
  path: string,
): Promise<Uint8Array | null> {
  const { data, error } = await svc.storage.from(bucket).download(path);
  if (error || !data) {
    console.warn("storage download failed", bucket, path, error?.message);
    return null;
  }
  return new Uint8Array(await data.arrayBuffer());
}

function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "\n\n[…contenido truncado por tamaño…]";
}

async function pdfBytesExtractPageLimited(bytes: Uint8Array, name: string): Promise<string> {
  const fallback =
    `[PDF: ${name}] No se pudo extraer texto (archivo grande o dañado). Prueba un PDF más pequeño o exportado de nuevo.`;
  try {
    const { getDocumentProxy } = await import(
      "https://esm.sh/unpdf@0.12.1",
    ) as {
      getDocumentProxy: (data: Uint8Array) => Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }>;
      }>;
    };
    const pdf = await getDocumentProxy(bytes);
    const totalPages = pdf.numPages || 1;
    const maxPages = Math.min(totalPages, PDF_PAGE_EXTRACT_MAX_PAGES);
    const parts: string[] = [];
    let acc = 0;
    let pagesDone = 0;
    for (let p = 1; p <= maxPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      let pageText = "";
      for (const item of tc.items) {
        if (item && typeof item.str === "string") pageText += item.str;
      }
      parts.push(pageText);
      acc += pageText.length;
      pagesDone = p;
      if (acc >= CHAT_TEXT_EXTRACT_MAX - 500) break;
    }
    const truncatedByChars = acc >= CHAT_TEXT_EXTRACT_MAX - 500;
    const truncatedByPages = totalPages > pagesDone;
    const footer =
      (truncatedByChars || truncatedByPages)
        ? `\n\n[…PDF truncado: ${totalPages} páginas totales; procesadas ${pagesDone}${truncatedByChars ? "; límite de texto" : ""}…]`
        : "";
    const t = parts.join("\n\n").trim();
    if (!t) {
      return `[PDF: ${name}] No se extrajo texto legible (p. ej. escaneo sin OCR).`;
    }
    return `### ${name} (PDF, texto extraído parcial)\n${truncateText(t + footer, CHAT_TEXT_EXTRACT_MAX)}`;
  } catch (e) {
    console.warn("pdf page-limited extract", e);
    return fallback;
  }
}

async function pdfBytesToGatewayText(bytes: Uint8Array, name: string): Promise<string> {
  if (bytes.length > PDF_PAGE_EXTRACT_MAX_BYTES) {
    const mb = Math.round(bytes.length / (1024 * 1024));
    return `[PDF: ${name}] Archivo de ~${mb} MB: demasiado grande para procesar en el servidor (máx ~${Math.round(PDF_PAGE_EXTRACT_MAX_BYTES / (1024 * 1024))} MB). Divide el PDF o reduce el tamaño.`;
  }
  if (bytes.length > PDF_MEDIUM_USE_PAGE_EXTRACT_BYTES) {
    return pdfBytesExtractPageLimited(bytes, name);
  }
  const fallback =
    `[PDF: ${name}] No se pudo extraer texto automáticamente; si usas solo el gateway, prueba otro formato o activa Anthropic.`;
  try {
    const { extractText, getDocumentProxy } = await import(
      "https://esm.sh/unpdf@0.12.1",
    ) as {
      extractText: (pdf: unknown, opts?: { mergePages?: boolean }) => Promise<{ text?: string }>;
      getDocumentProxy: (data: Uint8Array) => Promise<unknown>;
    };
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    const t = (text || "").trim();
    if (!t) return fallback;
    return `### ${name} (PDF, texto extraído)\n${truncateText(t, CHAT_TEXT_EXTRACT_MAX)}`;
  } catch (e) {
    console.warn("pdf extract", e);
    return fallback;
  }
}

async function pptxBytesToText(bytes: Uint8Array, _name: string): Promise<string> {
  if (bytes.length > XLSX_PROCESS_MAX_BYTES) {
    const mb = Math.round(bytes.length / (1024 * 1024));
    return `[PowerPoint ~${mb} MB: demasiado grande para procesar en el servidor. Exporta PDF o reduce el archivo.]`;
  }
  try {
    const JSZip = (await import("npm:jszip@3.10.1")).default;
    const zip = await JSZip.loadAsync(bytes);
    const slidePaths = Object.keys(zip.files).filter((n) =>
      /^ppt\/slides\/slide\d+\.xml$/i.test(n)
    );
    slidePaths.sort((a, b) => {
      const na = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const nb = parseInt(b.replace(/\D/g, ""), 10) || 0;
      return na - nb;
    });
    const parts: string[] = [];
    for (const path of slidePaths.slice(0, 80)) {
      const xml = await zip.file(path)?.async("string");
      if (!xml) continue;
      const text = xml
        .replace(/<a:t>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length) parts.push(`## ${path}\n${text}`);
    }
    if (slidePaths.length > 80) {
      parts.push(`[…${slidePaths.length - 80} diapositiva(s) omitidas por límite.]`);
    }
    if (parts.length === 0) {
      return "[No se extrajo texto legible de las diapositivas.]";
    }
    return truncateText(parts.join("\n\n"), CHAT_TEXT_EXTRACT_MAX);
  } catch (e) {
    console.warn("pptx parse error", e);
    return "[No se pudo leer la presentación. Prueba exportar PDF o adjunta las diapositivas relevantes como imágenes.]";
  }
}

function xlsxBytesToText(bytes: Uint8Array): string {
  try {
    const huge = bytes.length > XLSX_HUGE_FILE_BYTES;
    const large = bytes.length > XLSX_LARGE_FILE_BYTES;
    const sheetRows = huge ? 80 : large ? 150 : 400;
    const wb = XLSX.read(bytes, { type: "array", sheetRows });
    const parts: string[] = [];
    const maxSheets = huge ? 2 : large ? 4 : 8;
    const maxRowsPerSheet = huge ? 40 : large ? 60 : 120;
    for (const sheetName of wb.SheetNames.slice(0, maxSheets)) {
      const sheet = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
      const lines = csv.split("\n");
      parts.push(`## Hoja: ${sheetName}\n${lines.slice(0, maxRowsPerSheet).join("\n")}`);
    }
    if (wb.SheetNames.length > maxSheets) {
      parts.push(
        `\n[…${wb.SheetNames.length - maxSheets} hoja(s) omitidas; archivo grande. Exporta a CSV o divide el libro si necesitas todo.]`,
      );
    }
    return truncateText(parts.join("\n\n"), CHAT_TEXT_EXTRACT_MAX);
  } catch (e) {
    console.warn("xlsx parse error", e);
    return "[No se pudo leer el Excel como tabla. Prueba exportar una sola hoja a CSV o un archivo más pequeño.]";
  }
}

const SQLITE_PROCESS_MAX_BYTES = 15 * 1024 * 1024;

async function sqliteBytesToSummary(bytes: Uint8Array): Promise<string> {
  if (bytes.length > SQLITE_PROCESS_MAX_BYTES) {
    return `[SQLite ~${Math.round(bytes.length / (1024 * 1024))} MB: demasiado grande para analizar en el servidor.]`;
  }
  const tmp = await Deno.makeTempFile();
  try {
    await Deno.writeFile(tmp, bytes);
    const db = new DB(tmp);
    const tables = [...db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
      .map((r) => String(r[0]));
    const parts: string[] = [`Tablas: ${tables.join(", ") || "(ninguna)"}`];
    for (const t of tables.slice(0, 8)) {
      try {
        const cnt = [...db.query(`SELECT COUNT(*) FROM "${t.replace(/"/g, '""')}"`)][0][0];
        const rows = [...db.query(`SELECT * FROM "${t.replace(/"/g, '""')}" LIMIT 12`)];
        parts.push(`\n## ${t} (${cnt} filas, muestra hasta 12)\n${JSON.stringify(rows, null, 2)}`);
      } catch { /* ignore */ }
    }
    db.close();
    return truncateText(parts.join("\n"), CHAT_TEXT_EXTRACT_MAX);
  } catch (e) {
    console.warn("sqlite read error", e);
    return "[No se pudo leer el archivo SQLite.]";
  } finally {
    try {
      await Deno.remove(tmp);
    } catch { /* ignore */ }
  }
}

async function processAttachmentFile(
  bytes: Uint8Array,
  mime: string,
  name: string,
): Promise<{ claude: any[]; gatewayText: string }> {
  const lower = name.toLowerCase();
  const mt = (mime || "").toLowerCase();

  if (mt.startsWith("image/")) {
    if (bytes.length > IMAGE_MULTIMODAL_MAX_BYTES) {
      const mb = (bytes.length / (1024 * 1024)).toFixed(1);
      return {
        claude: [{
          type: "text",
          text: `[Imagen demasiado grande (${mb} MB; máx ${IMAGE_MULTIMODAL_MAX_BYTES / (1024 * 1024)} MB en el servidor): ${name}]`,
        }],
        gatewayText: `[Imagen omitida por tamaño: ${name}]`,
      };
    }
    const media = mt === "image/png" || mt === "image/gif" || mt === "image/webp" || mt === "image/jpeg"
      ? mt
      : "image/jpeg";
    return {
      claude: [{ type: "image", source: { type: "base64", media_type: media, data: toBase64(bytes) } }],
      gatewayText: `[Imagen adjunta: ${name}]`,
    };
  }
  if (mt === "application/pdf" || lower.endsWith(".pdf")) {
    // Nunca enviar PDF como documento nativo base64: Anthropic cuenta tokens muy por encima del tamaño en bytes
    // y un solo PDF de ~1MB puede superar el límite de 200k tokens de contexto.
    const gatewayText = await pdfBytesToGatewayText(bytes, name);
    const inner = gatewayText.replace(/^###[^\n]*\n?/, "").trim() || gatewayText;
    return {
      claude: [{
        type: "text",
        text: truncateText(
          `PDF «${name}» (texto extraído en el servidor para ajustarse al límite de contexto del modelo; PDFs muy largos: usar búsqueda semántica tras indexar).\n\n${inner}`,
          CHAT_TEXT_EXTRACT_MAX,
        ),
      }],
      gatewayText,
    };
  }
  if (
    mt === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mt === "application/vnd.ms-excel" ||
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls")
  ) {
    if (bytes.length > XLSX_PROCESS_MAX_BYTES) {
      const mb = Math.round(bytes.length / (1024 * 1024));
      return {
        claude: [{
          type: "text",
          text: `[Excel ~${mb} MB: demasiado grande para procesar en el servidor. Exporta una hoja a CSV o reduce el archivo.]`,
        }],
        gatewayText: `[Excel omitido por tamaño: ${name}]`,
      };
    }
    const t = xlsxBytesToText(bytes);
    return { claude: [{ type: "text", text: `Contenido de ${name}:\n${t}` }], gatewayText: `### ${name}\n${t}` };
  }
  if (
    mt === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    mt === "application/vnd.ms-powerpoint" ||
    lower.endsWith(".pptx") ||
    lower.endsWith(".ppt")
  ) {
    if (bytes.length > XLSX_PROCESS_MAX_BYTES) {
      const mb = Math.round(bytes.length / (1024 * 1024));
      return {
        claude: [{
          type: "text",
          text: `[PowerPoint ~${mb} MB: demasiado grande para procesar en el servidor. Exporta PDF o reduce el archivo.]`,
        }],
        gatewayText: `[Presentación omitida por tamaño: ${name}]`,
      };
    }
    const t = await pptxBytesToText(bytes, name);
    return {
      claude: [{ type: "text", text: `Contenido extraído de ${name}:\n${t}` }],
      gatewayText: `### ${name}\n${t}`,
    };
  }
  if (lower.endsWith(".sqlite") || lower.endsWith(".db") || isLikelySqlite(bytes)) {
    const t = await sqliteBytesToSummary(bytes);
    return { claude: [{ type: "text", text: `Resumen SQLite ${name}:\n${t}` }], gatewayText: `### ${name}\n${t}` };
  }
  if (
    mt.startsWith("text/") ||
    mt === "application/json" ||
    mt === "application/csv" ||
    lower.endsWith(".csv") ||
    lower.endsWith(".md") ||
    lower.endsWith(".sql")
  ) {
    const dec = new TextDecoder("utf-8", { fatal: false });
    const t = truncateText(dec.decode(bytes), CHAT_TEXT_EXTRACT_MAX);
    return { claude: [{ type: "text", text: `Archivo ${name}:\n${t}` }], gatewayText: `### ${name}\n${t}` };
  }
  return {
    claude: [{ type: "text", text: `[Archivo binario no interpretado: ${name} (${mt || "sin tipo"})]` }],
    gatewayText: `[Adjunto sin vista previa de texto: ${name}]`,
  };
}

function findLastUserMessageIndex(messages: any[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") return i;
  }
  return -1;
}

async function resolveChatAttachments(
  svc: ReturnType<typeof createClient>,
  messages: any[],
  attachmentRefs: Array<{ bucket?: string; path: string; name?: string; mime_type?: string }> | undefined,
): Promise<{ forClaude: any[] }> {
  const refs = (attachmentRefs || []).slice(0, CHAT_ATTACH_MAX_FILES);
  const lastIdx = findLastUserMessageIndex(messages);
  if (lastIdx < 0 || refs.length === 0) {
    return { forClaude: messages };
  }

  const userText = typeof messages[lastIdx].content === "string" ? messages[lastIdx].content : "";
  const claudeBlocks: any[] = [];
  let batchBytes = 0;
  const maxMb = Math.round(CHAT_ATTACH_MAX_BYTES / (1024 * 1024));
  const maxBatchMb = Math.round(CHAT_ATTACH_BATCH_MAX_BYTES / (1024 * 1024));

  for (const ref of refs) {
    try {
      const bucket = ref.bucket || "chat-uploads";
      const bytes = await downloadStorageObject(svc, bucket, ref.path);
      if (!bytes) {
        claudeBlocks.push({
          type: "text",
          text: `[Adjunto: no se pudo leer el archivo «${ref.name || ref.path}».]`,
        });
        continue;
      }
      if (bytes.length > CHAT_ATTACH_MAX_BYTES) {
        claudeBlocks.push({
          type: "text",
          text: `[Adjunto «${ref.name}» demasiado grande (máx. ${maxMb} MB).]`,
        });
        continue;
      }
      if (batchBytes + bytes.length > CHAT_ATTACH_BATCH_MAX_BYTES) {
        claudeBlocks.push({
          type: "text",
          text: `[Adjunto «${ref.name}» omitido: supera ${maxBatchMb} MB total por mensaje.]`,
        });
        continue;
      }
      batchBytes += bytes.length;
      const proc = await processAttachmentFile(bytes, ref.mime_type || "", ref.name || "archivo");
      claudeBlocks.push(...proc.claude);
    } catch (e) {
      console.warn("resolveChatAttachments: fallo procesando adjunto", ref.name, e);
      claudeBlocks.push({
        type: "text",
        text: `[No se pudo procesar «${ref.name || ref.path}» en el servidor (memoria o tiempo). Prueba un archivo más liviano, menos páginas/hojas, o divide el documento.]`,
      });
    }
  }

  let claudeContent: any = userText;
  if (claudeBlocks.length) {
    const arr = [...claudeBlocks];
    if (userText.trim()) arr.push({ type: "text", text: userText.trim() });
    claudeContent = arr.length === 1 && arr[0].type === "text" ? arr[0].text : arr;
  }

  const forClaude = messages.map((m, i) => (i === lastIdx ? { ...m, content: claudeContent } : m));

  return { forClaude };
}

// ─── Anthropic tool definitions ───
const anthropicTools = [
  {
    name: "get_my_tasks",
    description: "Obtiene las tareas asignadas al usuario actual. Puede filtrar por estatus, prioridad o área.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pendiente", "en_progreso", "en_revision", "completada", "cancelada"] },
        priority: { type: "string", enum: ["urgente", "alta", "media", "baja"] },
        limit: { type: "number", description: "Máximo de resultados (default 20)" },
      },
    },
  },
  {
    name: "get_all_org_tasks",
    description: "Obtiene todas las tareas de la organización (no solo las del usuario). Útil para ver carga de trabajo del equipo.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pendiente", "en_progreso", "en_revision", "completada", "cancelada"] },
        area: { type: "string", enum: ["contabilidad", "legal", "softlanding", "pld_ft", "juicios", "gestoria", "constitucion_nacional", "cumplimiento"] },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_clients",
    description: "Busca clientes de la organización por nombre, RFC o servicio. Usa count_only=true para obtener conteos.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string", description: "Texto para buscar en nombre o RFC" },
        status: { type: "string", enum: ["activo", "inactivo", "prospecto"] },
        service: { type: "string", enum: ["contabilidad", "legal", "softlanding", "pld_ft", "juicios", "gestoria", "constitucion_nacional", "cumplimiento"] },
        count_only: { type: "boolean" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_projects",
    description: "Obtiene proyectos de la organización. Puede filtrar por estatus o área.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["activo", "pausado", "completado", "cancelado"] },
        area: { type: "string", enum: ["contabilidad", "legal", "softlanding", "pld_ft", "juicios", "gestoria", "constitucion_nacional", "cumplimiento"] },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "get_my_reminders",
    description: "Obtiene los recordatorios del usuario actual.",
    input_schema: {
      type: "object",
      properties: {
        include_completed: { type: "boolean" },
      },
    },
  },
  {
    name: "create_reminder",
    description: "Crea un recordatorio para el usuario actual.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        due_time: { type: "string", description: "HH:MM" },
        repeat_kind: {
          type: "string",
          enum: ["none", "hourly_digest", "daily_digest"],
          description:
            "none=solo lista; hourly_digest=aviso en resumen horario si el usuario lo activó; daily_digest=resumen diario por la mañana.",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "get_upcoming_deadlines",
    description: "Obtiene tareas con fecha de vencimiento próxima.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Días hacia adelante (default 7)" },
        only_mine: { type: "boolean", description: "Solo mis tareas (default true)" },
      },
    },
  },
  {
    name: "get_team_members",
    description: "Obtiene los miembros del equipo (Kawiilers).",
    input_schema: {
      type: "object",
      properties: {
        count_only: { type: "boolean" },
        area: { type: "string" },
        active_only: { type: "boolean" },
      },
    },
  },
  {
    name: "get_celulas",
    description: "Obtiene las células (áreas de trabajo) con sus responsables.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_hub_procedures",
    description: "Busca en los procedimientos y manuales internos del Hub.",
    input_schema: {
      type: "object",
      properties: {
        search: { type: "string" },
      },
    },
  },
  {
    name: "get_hub_comunicados",
    description: "Obtiene los comunicados internos más recientes.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number" },
      },
    },
  },
  // ─── Deep-context tools ───
  {
    name: "get_task_details",
    description: "Obtiene una tarea específica con su descripción completa, comentarios de equipo y archivos adjuntos.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "UUID de la tarea" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "get_project_details",
    description: "Obtiene un proyecto específico con descripción, pasos, miembros del equipo y tareas asociadas.",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "UUID del proyecto" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "get_recent_activity",
    description: "Obtiene la actividad reciente de la organización desde el log de actividad.",
    input_schema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Máximo de entradas (default 20)" },
        entity_type: { type: "string", description: "Filtrar por tipo: client, project, task, document" },
      },
    },
  },
  {
    name: "search_across",
    description: "Búsqueda unificada por texto libre en tareas, clientes, proyectos y oportunidades del pipeline (leads). Devuelve resultados con tipo, id, nombre y URL.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto de búsqueda" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_extracted_documents",
    description: "Consulta documentos procesados por IA (CFDIs, declaraciones, estados de cuenta). Contiene resúmenes, montos, RFCs y periodos fiscales.",
    input_schema: {
      type: "object",
      properties: {
        client_id: { type: "string", description: "Filtrar por cliente (UUID)" },
        project_id: { type: "string", description: "Filtrar por proyecto (UUID)" },
        limit: { type: "number", description: "Máximo de resultados (default 10)" },
      },
    },
  },
  {
    name: "search_past_conversations",
    description: "Busca en conversaciones pasadas de toda la organización (no solo del usuario actual). Útil para encontrar discusiones anteriores, decisiones tomadas, y contexto que se haya compartido en otros chats. Respeta la privacidad mencionando que la info viene de otra conversación sin revelar quién la tuvo.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Texto a buscar en mensajes pasados" },
        limit: { type: "number", description: "Máximo de resultados (default 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "semantic_search",
    description:
      "Búsqueda semántica con embeddings. Incluye documentos del repositorio, PDFs largos del chat indexados (chat_attachment), conversaciones, procedimientos y comunicados. ÚSALA ante preguntas sobre temas, leyes, clientes o el contenido de PDFs que el usuario acaba de adjuntar si fueron indexados. Más potente que search_across y search_past_conversations para contexto conceptual.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Pregunta o tema a buscar semánticamente" },
        client_id: { type: "string", description: "Filtrar por cliente específico (UUID)" },
        project_id: { type: "string", description: "Filtrar por proyecto específico (UUID)" },
        source_types: {
          type: "array",
          items: {
            type: "string",
            enum: [
              "document",
              "extracted_data",
              "chat_message",
              "procedure",
              "comunicado",
              "memory",
              "artifact",
              "shared_memory",
              "chat_attachment",
            ],
          },
          description:
            "Filtrar por tipos. Para solo fragmentos de PDFs indexados desde el chat usa [\"chat_attachment\"]. Omitir para buscar en todas las fuentes.",
        },
        limit: { type: "number", description: "Máximo de resultados (default 8)" },
      },
      required: ["query"],
    },
  },
  {
    name: "create_artifact",
    description:
      "FALLBACK: crea un documento entregable a partir de markdown libre. El backend lo convierte automáticamente al pipeline Kawiil (PDF + DOCX con portada, tipografía y tablas con color), así que SIEMPRE sale con diseño profesional (igual que los artifacts de Claude), nunca como markdown plano.\n\n" +
      "PREFIERE `create_ai_document` cuando el documento encaja en uno de los 6 templates (informe_ejecutivo, minuta_reunion, propuesta_cotizacion, factura_remision, reporte_financiero, generico): el resultado es más rico porque incluye portada con metadata/clasificación, callouts, tablas estructuradas, recomendaciones, firmas, totales, KPIs, etc.\n\n" +
      "Usa `create_artifact` SOLO para contenido muy libre / narrativo que no encaja en ningún template, o para snippets de código (content_type: \"code\").",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título del documento (aparecerá en la portada del PDF)." },
        content: {
          type: "string",
          description:
            "Contenido en Markdown. Usa títulos `##` para secciones, párrafos largos, bullets con `-`, y tablas markdown `| col | col |` (se convertirán a tablas profesionales en el PDF). Evita H1 al inicio: el título del documento se toma del campo `title`.",
        },
        content_type: { type: "string", enum: ["markdown", "code", "html", "csv"], description: "Tipo de contenido (default: markdown). Con `code` el artifact queda como snippet plano." },
      },
      required: ["title", "content"],
    },
  },
  {
    name: "create_ai_document",
    description:
      "Genera un documento PROFESIONAL con diseño Kawiil (portada, tipografía, tablas con color, paginación). ÚSALA para cualquier documento largo/formal: informes ejecutivos, minutas de reunión, propuestas/cotizaciones, facturas/remisiones, reportes financieros.\n\n" +
      "FORMATO DE SALIDA (MUY IMPORTANTE):\n" +
      "- Si el usuario pide Word / DOCX / editable → incluye 'docx' y 'pdf' y pon 'primary_format': 'docx'. Orden sugerido en requested_formats: primero docx, luego pdf (el primario es el que verá como principal en la app).\n" +
      "- Si pide solo PDF o no especifica y conviene entregar PDF de presentación → 'primary_format': 'pdf' y requested_formats puede ser ['pdf','docx'] o ['pdf'].\n" +
      "- Si el usuario NO ha indicado en qué formato quiere el entregable (PDF, Word, Excel, PowerPoint), NO llames a esta herramienta todavía: pregúntale en una frase qué formato prefiere (PDF para presentar, Word para editar, Excel para tablas, PowerPoint para diapositivas, o combinación).\n\n" +
      "REGLAS:\n" +
      "1) Elige 'template_key' según la intención del usuario:\n" +
      "   - 'informe_ejecutivo' → reporte formal con resumen ejecutivo, secciones y recomendaciones.\n" +
      "   - 'minuta_reunion' → acta con asistentes, temas, acuerdos y plan de acción.\n" +
      "   - 'propuesta_cotizacion' → propuesta comercial con alcance, conceptos y totales.\n" +
      "   - 'factura_remision' → documento fiscal con emisor, receptor, conceptos y totales.\n" +
      "   - 'reporte_financiero' → reporte con KPIs, tablas y notas del periodo.\n" +
      "   - 'generico' → fallback sin template específico.\n" +
      "2) Incluye 'pdf' en requested_formats salvo que el usuario pida explícitamente SOLO otro formato (p. ej. solo Excel). El backend puede añadir pdf al final si falta.\n" +
      "3) 'content' debe seguir EXACTAMENTE el shape del template elegido (ver descripción de cada template en este documento).\n" +
      "4) Si confidence < 0.55, pide aclaración al usuario en lugar de generar el archivo.\n\n" +
      "SHAPES DE CONTENT POR TEMPLATE (ejemplos abreviados):\n" +
      "• informe_ejecutivo: { metadata?, summary?, sections: [{ heading?, paragraphs?, bullets?, tables?: [{ headers, rows }], callout?: { kind?, title?, body } }], recommendations?: string[], signatures?: [{ role, name? }] }\n" +
      "• minuta_reunion: { metadata?, attendees?: [{ name, role? }], absentees?: string[], agenda?: string[], topics: [{ title, discussion? }], agreements?: string[], action_items?: [{ task, owner?, due_date? }], next_meeting? }\n" +
      "• propuesta_cotizacion: { metadata?, client?: [{ label, value }], summary?, scope?: [sections], line_items: [{ description, quantity?, unit?, unit_price?, amount?, notes? }], currency?, subtotal?, taxes?, total?, terms?: string[], validity? }\n" +
      "• factura_remision: { metadata?, emisor: [{ label, value }], receptor: [{ label, value }], folio?, fecha?, line_items: [...], currency?, subtotal?, taxes?, total?, legal_notes?: string[] }\n" +
      "• reporte_financiero: { metadata?, period?, kpis?: [{ label, value, delta? }], summary?, tables: [{ headers, rows, caption? }], notes?: string[] }\n" +
      "• generico: { metadata?, summary?, sections: [...] }\n\n" +
      "METADATA comun (opcional): { code?, emisor?, destinatario?, fecha?, version?, clasificacion? } — usa 'clasificacion' p. ej. 'Confidencial — Uso Interno'.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título del documento final." },
        template_key: {
          type: "string",
          enum: [
            "informe_ejecutivo",
            "minuta_reunion",
            "propuesta_cotizacion",
            "factura_remision",
            "reporte_financiero",
            "generico",
          ],
          description: "Template Kawiil que define el diseño y estructura del documento.",
        },
        requested_formats: {
          type: "array",
          items: { type: "string", enum: ["pdf", "docx", "xlsx", "pptx"] },
          description:
            "Formatos a generar. El orden importa junto con primary_format: el primario debe coincidir con primary_format (p. ej. Word: ['docx','pdf']). Incluye normalmente pdf+docx para informes editables.",
        },
        primary_format: {
          type: "string",
          enum: ["pdf", "docx", "xlsx", "pptx"],
          description:
            "Formato que el usuario verá como principal en la app (preview/badge). Debe estar incluido en requested_formats. Si pidió Word → docx. Si pidió PDF o no especificó → pdf. Si pidió Excel/PPT → xlsx o pptx.",
        },
        content: {
          type: "object",
          description:
            "Estructura del documento según el template elegido. Consulta los shapes documentados en el description del tool.",
        },
        confidence: {
          type: "number",
          description: "Confianza de clasificación entre 0 y 1. Si < 0.55 pide aclaración al usuario.",
        },
        reason: { type: "string", description: "Motivo breve de por qué se eligió ese template/formato." },
        preview_markdown: {
          type: "string",
          description: "Resumen corto en Markdown (1-3 párrafos) para mostrar como texto alterno del artifact.",
        },
      },
      required: ["title", "template_key", "content"],
    },
  },
  {
    name: "create_project",
    description: "Crea un nuevo proyecto en Kawiil. USA ESTA HERRAMIENTA cuando el usuario pida crear un proyecto, ya sea directamente o a partir de una minuta de reunión, un análisis o instrucciones. Puedes asociar el proyecto a un cliente existente y definir el área de servicio. Incluye fases si el proyecto lo requiere.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nombre del proyecto" },
        description: { type: "string", description: "Descripción del proyecto" },
        client_id: { type: "string", description: "UUID del cliente (opcional)" },
        area: { type: "string", enum: ["contabilidad", "legal", "softlanding", "pld_ft", "juicios", "gestoria", "constitucion_nacional", "cumplimiento"], description: "Área/célula de servicio" },
        service_tags: { type: "array", items: { type: "string" }, description: "Tags de servicio adicionales (ej: auditoria_interna, control_interno)" },
        phases: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              order: { type: "number" },
            },
            required: ["name"],
          },
          description: "Fases del proyecto (opcional)",
        },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              phase_name: { type: "string", description: "Nombre de la fase a la que pertenece esta tarea" },
              priority: { type: "string", enum: ["urgente", "alta", "media", "baja"] },
              due_date: { type: "string", description: "YYYY-MM-DD" },
            },
            required: ["title"],
          },
          description: "Tareas iniciales del proyecto",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "create_tasks",
    description: "Crea múltiples tareas de una sola vez. USA ESTA HERRAMIENTA cuando el usuario pida crear tareas para un proyecto, a partir de una minuta, o a partir de instrucciones. Puedes crear tareas con prioridad, área, fecha límite y asignarlas a un proyecto existente.",
    input_schema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "UUID del proyecto al que pertenecen (opcional)" },
        client_id: { type: "string", description: "UUID del cliente (opcional)" },
        area: { type: "string", description: "Área por defecto para las tareas" },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              description: { type: "string" },
              priority: { type: "string", enum: ["urgente", "alta", "media", "baja"] },
              due_date: { type: "string", description: "YYYY-MM-DD" },
              phase_key: { type: "string", description: "Key de la fase del proyecto" },
            },
            required: ["title"],
          },
          description: "Lista de tareas a crear",
        },
      },
      required: ["tasks"],
    },
  },
  {
    name: "suggest_template",
    description: "Sugiere una plantilla de proyecto basándose en el tipo de cliente, servicio y descripción. Busca plantillas existentes o genera una sugerencia adaptada.",
    input_schema: {
      type: "object",
      properties: {
        client_type: { type: "string", description: "Tipo de cliente (persona_moral, persona_fisica)" },
        service_area: { type: "string", description: "Área de servicio" },
        service_tags: { type: "array", items: { type: "string" }, description: "Tags de servicio" },
        description: { type: "string", description: "Descripción de lo que necesita el proyecto" },
      },
    },
  },
  {
    name: "update_task",
    description:
      "Actualiza una tarea existente: estatus, fecha límite, prioridad, título, descripción o responsable principal. " +
      "Úsala cuando el usuario pida marcar como completada, cambiar vencimiento, prioridad, etc. Los cambios quedan auditados como acción vía Kawiil AI.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "UUID de la tarea" },
        status: {
          type: "string",
          enum: ["pendiente", "en_progreso", "en_revision", "completada", "cancelada"],
        },
        due_date: { type: "string", description: "YYYY-MM-DD (opcional)" },
        clear_due_date: { type: "boolean", description: "Si true, quita la fecha límite" },
        priority: { type: "string", enum: ["urgente", "alta", "media", "baja"] },
        title: { type: "string" },
        description: { type: "string" },
        assigned_to: { type: "string", description: "UUID del responsable; cadena vacía para quitar asignación" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "update_tasks",
    description:
      "Actualiza varias tareas en un solo paso (mismo formato que update_task por ítem). Ideal para cambios masivos de fecha o estatus.",
    input_schema: {
      type: "object",
      properties: {
        updates: {
          type: "array",
          items: {
            type: "object",
            properties: {
              task_id: { type: "string" },
              status: {
                type: "string",
                enum: ["pendiente", "en_progreso", "en_revision", "completada", "cancelada"],
              },
              due_date: { type: "string", description: "YYYY-MM-DD" },
              clear_due_date: { type: "boolean", description: "Si true, quita la fecha límite" },
              priority: { type: "string", enum: ["urgente", "alta", "media", "baja"] },
              title: { type: "string" },
              description: { type: "string" },
              assigned_to: { type: "string", description: "UUID; vacío para quitar" },
            },
            required: ["task_id"],
          },
        },
      },
      required: ["updates"],
    },
  },
  {
    name: "add_task_comment",
    description:
      "Añade un comentario a una tarea existente (aparece en el hilo de la tarea). La auditoría registra que el comentario se añadió vía Kawiil AI.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string", description: "UUID de la tarea" },
        content: { type: "string", description: "Texto del comentario" },
      },
      required: ["task_id", "content"],
    },
  },
];

const TASK_STATUS_AI = ["pendiente", "en_progreso", "en_revision", "completada", "cancelada"] as const;
const TASK_PRIORITY_AI = ["urgente", "alta", "media", "baja"] as const;

/** Igual que en el cliente: no completar padre si checklist o subtareas enlazadas abiertas. */
async function assertCanCompleteParentTaskEdge(supabase: any, taskId: string): Promise<string | null> {
  const { data: row, error } = await supabase.from("tasks").select("checklist").eq("id", taskId).single();
  if (error || !row) return error?.message || "No se pudo verificar la tarea.";
  const checklist = (row.checklist as unknown as Record<string, unknown>[]) ?? [];
  const childIds: string[] = [];
  for (const raw of checklist) {
    const item = raw as { completed?: boolean; task_id?: string | null };
    if (item.task_id) {
      childIds.push(item.task_id);
      continue;
    }
    if (!item.completed) {
      return "No puedes marcar la tarea como completada mientras haya subtareas sin marcar en la lista.";
    }
  }
  if (childIds.length === 0) return null;
  const unique = [...new Set(childIds)];
  const { data: children, error: cErr } = await supabase.from("tasks").select("id, status").in("id", unique);
  if (cErr) return cErr.message;
  const byId = new Map((children ?? []).map((c: { id: string; status: string }) => [c.id, c.status]));
  for (const cid of unique) {
    const st = byId.get(cid);
    if (st !== "completada" && st !== "cancelada") {
      return "No puedes marcar la tarea como completada mientras haya subtareas abiertas. Complétalas o cancélalas antes.";
    }
  }
  return null;
}

async function logAiTaskActivity(
  supabase: any,
  opts: {
    userId: string;
    orgId: string;
    taskId: string;
    action: string;
    tool: string;
    conversationId: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const details: Record<string, unknown> = {
    source: "kawiil_ai",
    tool: opts.tool,
    ...(opts.conversationId ? { conversation_id: opts.conversationId } : {}),
    ...(opts.details ?? {}),
  };
  const { error } = await supabase.from("activity_log").insert({
    user_id: opts.userId,
    organization_id: opts.orgId,
    entity_type: "task",
    entity_id: opts.taskId,
    action: opts.action,
    details,
  });
  if (error) console.warn("[ai-chat] activity_log insert failed:", error.message);
}

type TaskUpdatePatch = {
  task_id: string;
  status?: string;
  due_date?: string | null;
  priority?: string;
  title?: string;
  description?: string;
  assigned_to?: string | null;
};

async function applyTaskPatchFromAi(
  supabase: any,
  userId: string,
  orgId: string,
  conversationId: string | null,
  tool: "update_task" | "update_tasks",
  patch: TaskUpdatePatch,
): Promise<Record<string, unknown>> {
  const taskId = patch.task_id;
  if (!taskId || typeof taskId !== "string") {
    return { task_id: taskId, error: "task_id inválido." };
  }

  const { data: row, error: fetchErr } = await supabase
    .from("tasks")
    .select("id, organization_id, started_at, status, due_date")
    .eq("id", taskId)
    .single();

  if (fetchErr || !row) return { task_id: taskId, error: fetchErr?.message || "Tarea no encontrada." };
  if (row.organization_id !== orgId) return { task_id: taskId, error: "No autorizado para esta tarea." };

  const updates: Record<string, unknown> = {};

  if (patch.status !== undefined && patch.status !== null) {
    if (!TASK_STATUS_AI.includes(patch.status as (typeof TASK_STATUS_AI)[number])) {
      return { task_id: taskId, error: `status inválido: ${patch.status}` };
    }
    updates.status = patch.status;
  }
  if (patch.priority !== undefined && patch.priority !== null) {
    if (!TASK_PRIORITY_AI.includes(patch.priority as (typeof TASK_PRIORITY_AI)[number])) {
      return { task_id: taskId, error: `priority inválida: ${patch.priority}` };
    }
    updates.priority = patch.priority;
  }
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.description !== undefined) updates.description = patch.description;
  if (patch.assigned_to !== undefined) {
    updates.assigned_to = patch.assigned_to === "" ? null : patch.assigned_to;
  }

  if (patch.due_date !== undefined) {
    if (patch.due_date === null || patch.due_date === "") updates.due_date = null;
    else updates.due_date = patch.due_date;
  }

  const changeKeys = Object.keys(updates);
  if (changeKeys.length === 0) return { task_id: taskId, error: "No hay campos para actualizar." };

  if (updates.status === "completada") {
    const block = await assertCanCompleteParentTaskEdge(supabase, taskId);
    if (block) return { task_id: taskId, error: block };
  }

  const newStatus = updates.status as string | undefined;
  if (newStatus && newStatus !== "pendiente" && newStatus !== "cancelada") {
    if (!row.started_at) updates.started_at = new Date().toISOString();
  }
  if (newStatus === "completada") {
    updates.completed_at = new Date().toISOString();
  }
  if (newStatus && newStatus !== "completada") {
    updates.completed_at = null;
  }

  const logDetails: Record<string, unknown> = {
    changes: changeKeys,
  };
  if (updates.status !== undefined) {
    logDetails.previous_status = row.status;
    logDetails.new_status = updates.status;
  }
  if (updates.due_date !== undefined) {
    logDetails.previous_due_date = row.due_date ?? null;
    logDetails.new_due_date = updates.due_date;
  }

  const { error: upErr } = await supabase.from("tasks").update(updates).eq("id", taskId);
  if (upErr) return { task_id: taskId, error: upErr.message };

  await logAiTaskActivity(supabase, {
    userId,
    orgId,
    taskId,
    action: "updated",
    tool,
    conversationId,
    details: logDetails,
  });

  return { task_id: taskId, success: true, updated: changeKeys };
}

// ─── Tool executor ───
async function executeTool(
  name: string,
  args: Record<string, any>,
  supabase: any,
  userId: string,
  orgId: string,
  conversationId: string | null = null,
) {
  switch (name) {
    case "get_my_tasks": {
      let q = supabase.from("tasks")
        .select("id, title, status, priority, due_date, area, description, clients(name)")
        .eq("assigned_to", userId);
      if (args.status) q = q.eq("status", args.status);
      else q = q.in("status", ["pendiente", "en_progreso", "en_revision"]);
      if (args.priority) q = q.eq("priority", args.priority);
      q = q.order("due_date", { ascending: true, nullsFirst: false }).limit(args.limit || 20);
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }
    case "get_all_org_tasks": {
      let q = supabase.from("tasks")
        .select("id, title, status, priority, due_date, area, assigned_to")
        .eq("organization_id", orgId);
      if (args.status) q = q.eq("status", args.status);
      else q = q.in("status", ["pendiente", "en_progreso", "en_revision"]);
      if (args.area) q = q.eq("area", args.area);
      q = q.order("due_date", { ascending: true, nullsFirst: false }).limit(args.limit || 30);
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }
    case "get_clients": {
      if (args.count_only) {
        const { data, error } = await supabase.from("clients")
          .select("name, status, services")
          .eq("organization_id", orgId);
        if (error) return { error: error.message };
        const total = data?.length || 0;
        const byStatus: Record<string, number> = {};
        const byService: Record<string, number> = {};
        for (const c of data || []) {
          byStatus[c.status] = (byStatus[c.status] || 0) + 1;
          if (c.services?.length) {
            for (const s of c.services) byService[s] = (byService[s] || 0) + 1;
          }
        }
        return { total, por_estatus: byStatus, por_servicio: byService };
      }
      let q = supabase.from("clients")
        .select("id, name, rfc, email, status, services, contact_name, phone, primary_area")
        .eq("organization_id", orgId);
      if (args.search) q = q.or(`name.ilike.%${escapePostgrestString(args.search)}%,rfc.ilike.%${escapePostgrestString(args.search)}%`);
      if (args.status) q = q.eq("status", args.status);
      if (args.service) q = q.contains("services", [args.service]);
      q = q.order("name").limit(args.limit || 100);
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }
    case "get_projects": {
      let q = supabase.from("projects")
        .select("id, name, status, area, start_date, end_date, description, clients(name)")
        .eq("organization_id", orgId);
      if (args.status) q = q.eq("status", args.status);
      if (args.area) q = q.eq("area", args.area);
      q = q.order("updated_at", { ascending: false }).limit(args.limit || 15);
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }
    case "get_my_reminders": {
      let q = supabase.from("reminders")
        .select("title, description, due_date, due_time, repeat_kind, is_completed")
        .eq("user_id", userId);
      if (!args.include_completed) q = q.eq("is_completed", false);
      q = q.order("due_date", { ascending: true, nullsFirst: false });
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }
    case "create_reminder": {
      const rk = ["none", "hourly_digest", "daily_digest"].includes(args.repeat_kind)
        ? args.repeat_kind
        : "hourly_digest";
      const { data, error } = await supabase.from("reminders").insert({
        user_id: userId,
        organization_id: orgId,
        title: args.title,
        description: args.description || null,
        due_date: args.due_date || null,
        due_time: args.due_time || null,
        repeat_kind: rk,
      }).select("id, title, due_date, repeat_kind").single();
      return error ? { error: error.message } : { success: true, reminder: data };
    }
    case "get_upcoming_deadlines": {
      const days = args.days || 7;
      const now = new Date();
      const future = new Date(now.getTime() + days * 86400000);
      let q = supabase.from("tasks")
        .select("title, status, priority, due_date, area")
        .eq("organization_id", orgId)
        .in("status", ["pendiente", "en_progreso", "en_revision"])
        .gte("due_date", now.toISOString().split("T")[0])
        .lte("due_date", future.toISOString().split("T")[0])
        .order("due_date", { ascending: true });
      if (args.only_mine !== false) q = q.eq("assigned_to", userId);
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }
    case "get_team_members": {
      const activeOnly = args.active_only !== false;
      let q = supabase.from("profiles")
        .select("user_id, full_name, email, area, is_active, phone")
        .eq("organization_id", orgId);
      if (activeOnly) q = q.eq("is_active", true);
      if (args.area) q = q.eq("area", args.area);
      q = q.order("full_name");
      const { data: profiles, error: profErr } = await q;
      if (profErr) return { error: profErr.message };
      const userIds = (profiles || []).map((p: any) => p.user_id);
      const { data: roles } = await supabase.from("user_roles").select("user_id, role").in("user_id", userIds);
      const roleMap: Record<string, string> = {};
      for (const r of roles || []) roleMap[r.user_id] = r.role;
      if (args.count_only) {
        const byArea: Record<string, number> = {};
        const byRole: Record<string, number> = {};
        for (const p of profiles || []) {
          byArea[p.area || "Sin área"] = (byArea[p.area || "Sin área"] || 0) + 1;
          byRole[roleMap[p.user_id] || "sin_rol"] = (byRole[roleMap[p.user_id] || "sin_rol"] || 0) + 1;
        }
        return { total_kawiilers: profiles?.length || 0, por_area: byArea, por_rol: byRole };
      }
      return (profiles || []).map((p: any) => ({
        nombre: p.full_name, email: p.email, area: p.area || "Sin área",
        rol: roleMap[p.user_id] || "sin_rol", activo: p.is_active, telefono: p.phone,
      }));
    }
    case "get_celulas": {
      const { data, error } = await supabase.from("celulas")
        .select("name, slug, description, color, is_active, responsible_user_id")
        .eq("organization_id", orgId).eq("is_active", true).order("name");
      if (error) return { error: error.message };
      const respIds = (data || []).filter((c: any) => c.responsible_user_id).map((c: any) => c.responsible_user_id);
      let nameMap: Record<string, string> = {};
      if (respIds.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("user_id, full_name").in("user_id", respIds);
        for (const p of profs || []) nameMap[p.user_id] = p.full_name;
      }
      return (data || []).map((c: any) => ({
        nombre: c.name, slug: c.slug, descripcion: c.description,
        responsable: nameMap[c.responsible_user_id] || null,
      }));
    }
    case "get_hub_procedures": {
      let q = supabase.from("internal_procedures")
        .select("title, description, file_path, current_version, updated_at")
        .eq("organization_id", orgId).order("updated_at", { ascending: false });
      if (args.search) q = q.or(`title.ilike.%${escapePostgrestString(args.search)}%,description.ilike.%${escapePostgrestString(args.search)}%`);
      q = q.limit(10);
      const { data, error } = await q;
      if (error) return { error: error.message };
      if (!data || data.length === 0) return { message: "No se encontraron procedimientos." };
      return data.map((p: any) => ({ titulo: p.title, descripcion: p.description, version: p.current_version, actualizado: p.updated_at }));
    }
    case "get_hub_comunicados": {
      const { data, error } = await supabase.from("internal_comunicados")
        .select("title, body, is_pinned, created_at")
        .eq("organization_id", orgId)
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(args.limit || 5);
      if (error) return { error: error.message };
      return data;
    }

    // ─── Deep-context tools ───
    case "get_task_details": {
      const { data: task, error: tErr } = await supabase.from("tasks")
        .select("id, title, description, status, priority, due_date, area, created_at, completed_at, time_spent_seconds, criticality_level, delay_category, delay_notes, checklist, tags, clients(name), projects(name)")
        .eq("id", args.task_id).single();
      if (tErr) return { error: tErr.message };

      const { data: comments } = await supabase.from("task_comments")
        .select("content, created_at, user_id")
        .eq("task_id", args.task_id)
        .order("created_at", { ascending: true })
        .limit(30);

      let commentData: any[] = [];
      if (comments?.length) {
        const cUserIds = [...new Set(comments.map((c: any) => c.user_id))];
        const { data: profs } = await supabase.from("profiles").select("user_id, full_name").in("user_id", cUserIds);
        const nameMap: Record<string, string> = {};
        for (const p of profs || []) nameMap[p.user_id] = p.full_name;
        commentData = comments.map((c: any) => ({
          autor: nameMap[c.user_id] || "Desconocido",
          contenido: c.content,
          fecha: c.created_at,
        }));
      }

      const { data: assignees } = await supabase.from("task_assignees")
        .select("user_id").eq("task_id", args.task_id);
      let assigneeNames: string[] = [];
      if (assignees?.length) {
        const { data: profs } = await supabase.from("profiles").select("user_id, full_name").in("user_id", assignees.map((a: any) => a.user_id));
        assigneeNames = (profs || []).map((p: any) => p.full_name);
      }

      return { ...task, comentarios: commentData, asignados: assigneeNames };
    }

    case "get_project_details": {
      const { data: project, error: pErr } = await supabase.from("projects")
        .select("id, name, description, status, area, start_date, end_date, criticality_level, delay_category, delay_notes, constitution_details, lawsuit_details, tax_obligations, clients(name, rfc)")
        .eq("id", args.project_id).single();
      if (pErr) return { error: pErr.message };

      const { data: members } = await supabase.from("project_members")
        .select("user_id").eq("project_id", args.project_id);
      let memberNames: string[] = [];
      if (members?.length) {
        const { data: profs } = await supabase.from("profiles").select("user_id, full_name").in("user_id", members.map((m: any) => m.user_id));
        memberNames = (profs || []).map((p: any) => p.full_name);
      }

      const { data: tasks } = await supabase.from("tasks")
        .select("id, title, status, priority, due_date, assigned_to")
        .eq("project_id", args.project_id)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(30);

      return { ...project, miembros: memberNames, tareas: tasks || [] };
    }

    case "get_recent_activity": {
      let q = supabase.from("activity_log")
        .select("entity_type, entity_id, action, details, created_at, user_id")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(args.limit || 20);
      if (args.entity_type) q = q.eq("entity_type", args.entity_type);
      const { data, error } = await q;
      if (error) return { error: error.message };

      const userIds = [...new Set((data || []).filter((a: any) => a.user_id).map((a: any) => a.user_id))];
      let nameMap: Record<string, string> = {};
      if (userIds.length) {
        const { data: profs } = await supabase.from("profiles").select("user_id, full_name").in("user_id", userIds);
        for (const p of profs || []) nameMap[p.user_id] = p.full_name;
      }

      return (data || []).map((a: any) => ({
        tipo: a.entity_type, accion: a.action, fecha: a.created_at,
        usuario: nameMap[a.user_id] || "Sistema", detalles: a.details,
      }));
    }

    case "search_across": {
      const q = args.query;
      const results: any[] = [];

      const { data: tasks } = await supabase.from("tasks")
        .select("id, title, status, area")
        .eq("organization_id", orgId)
        .ilike("title", `%${escapePostgrestString(q)}%`)
        .limit(5);
      for (const t of tasks || []) {
        results.push({ type: "task", id: t.id, name: t.title, extra: `${t.status} · ${t.area || ""}`, url: `/tareas` });
      }

      const { data: clients } = await supabase.from("clients")
        .select("id, name, rfc, status")
        .eq("organization_id", orgId)
        .or(`name.ilike.%${escapePostgrestString(q)}%,rfc.ilike.%${escapePostgrestString(q)}%`)
        .limit(5);
      for (const c of clients || []) {
        results.push({ type: "client", id: c.id, name: c.name, extra: c.rfc || c.status, url: `/clientes/${c.id}` });
      }

      const { data: projects } = await supabase.from("projects")
        .select("id, name, status, area")
        .eq("organization_id", orgId)
        .ilike("name", `%${escapePostgrestString(q)}%`)
        .limit(5);
      for (const p of projects || []) {
        results.push({ type: "project", id: p.id, name: p.name, extra: `${p.status} · ${p.area || ""}`, url: `/proyectos/${p.id}` });
      }

      const esc = escapePostgrestString(q);
      const { data: pipelineLeads } = await supabase.from("leads")
        .select("id, full_name, company_name, email, priority, is_active")
        .eq("organization_id", orgId)
        .or(`full_name.ilike.%${esc}%,company_name.ilike.%${esc}%,email.ilike.%${esc}%,phone.ilike.%${esc}%`)
        .limit(5);
      for (const pl of pipelineLeads || []) {
        const extraParts = [pl.company_name, pl.email].filter(Boolean);
        const statusPart = pl.is_active === false ? "inactivo" : "activo";
        results.push({
          type: "pipeline_lead",
          id: pl.id,
          name: pl.full_name,
          extra: [...extraParts, `${pl.priority} · ${statusPart}`].filter(Boolean).join(" · "),
          url: `/pipeline/leads/${pl.id}`,
        });
      }

      return results;
    }

    case "get_extracted_documents": {
      let q = supabase.from("extracted_documents")
        .select("id, document_type, extraction_status, ai_summary, ai_observations, total_amount, tax_amount, isr_amount, iva_amount, rfc_emisor, rfc_receptor, fiscal_period, document_date, cfdi_type, declaration_type, currency, confidence_score")
        .eq("organization_id", orgId)
        .eq("extraction_status", "completed")
        .order("created_at", { ascending: false });
      if (args.client_id) q = q.eq("client_id", args.client_id);
      if (args.project_id) q = q.eq("project_id", args.project_id);
      q = q.limit(args.limit || 10);
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }

    case "search_past_conversations": {
      const searchQuery = args.query;
      const limit = args.limit || 10;

      // SECURITY: Uses service role client, bypassing RLS to search across all org conversations.
      // TODO: Review if a scoped RLS policy per org would be safer than a full service-role bypass.
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const serviceClient = createClient(supabaseUrl, serviceKey);

      // Get all conversation IDs in the org
      const { data: orgConvos } = await serviceClient.from("chat_conversations")
        .select("id, user_id, title")
        .eq("organization_id", orgId)
        .order("updated_at", { ascending: false })
        .limit(100);

      if (!orgConvos?.length) return { results: [], message: "No hay conversaciones previas." };

      const convoIds = orgConvos.map((c: any) => c.id);

      // Search messages across those conversations
      const { data: messages } = await serviceClient.from("chat_messages")
        .select("content, role, conversation_id, created_at")
        .in("conversation_id", convoIds)
        .ilike("content", `%${escapePostgrestString(searchQuery)}%`)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!messages?.length) return { results: [], message: "No se encontraron mensajes relacionados." };

      // Map conversation info
      const convoMap: Record<string, any> = {};
      for (const c of orgConvos) convoMap[c.id] = c;

      // Get user names for conversation owners
      const ownerIds = [...new Set(orgConvos.map((c: any) => c.user_id))];
      let nameMap: Record<string, string> = {};
      if (ownerIds.length) {
        const { data: profs } = await serviceClient.from("profiles").select("user_id, full_name").in("user_id", ownerIds);
        for (const p of profs || []) nameMap[p.user_id] = p.full_name;
      }

      return {
        results: messages.map((m: any) => {
          const convo = convoMap[m.conversation_id];
          const isCurrentUser = convo?.user_id === userId;
          return {
            fragmento: m.content.length > 300 ? m.content.substring(0, 300) + "..." : m.content,
            rol: m.role,
            fecha: m.created_at,
            conversacion: convo?.title || "Sin título",
            es_del_usuario_actual: isCurrentUser,
            autor: isCurrentUser ? "Tú" : (nameMap[convo?.user_id] || "Otro Kawiiler"),
          };
        }),
      };
    }

    case "semantic_search": {
      const openaiKey = Deno.env.get("OPENAI_API_KEY");
      if (!openaiKey) return { error: "Búsqueda semántica no disponible: OPENAI_API_KEY no configurada" };

      const queryText = args.query;
      const limit = args.limit || 8;

      // Generate embedding for the query
      const embResp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: queryText.replace(/\n+/g, " ").trim(),
          model: "text-embedding-3-small",
          dimensions: 1536,
        }),
      });

      if (!embResp.ok) {
        const err = await embResp.text();
        console.error("OpenAI embedding error:", err);
        return { error: "No se pudo generar el embedding para la búsqueda" };
      }

      const embData = await embResp.json();
      const queryEmbedding = embData.data[0].embedding;

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const serviceClient = createClient(supabaseUrl, serviceKey);

      const { data: results, error: rpcError } = await serviceClient.rpc("match_document_chunks", {
        query_embedding: JSON.stringify(queryEmbedding),
        match_count: limit,
        filter_org_id: orgId,
        filter_client_id: args.client_id || null,
        filter_project_id: args.project_id || null,
        filter_source_types: args.source_types || null,
        similarity_threshold: 0.35,
      });

      if (rpcError) {
        console.error("match_document_chunks RPC error:", rpcError);
        return { error: rpcError.message };
      }

      if (!results?.length) {
        return { results: [], message: "No se encontraron resultados semánticos relevantes." };
      }

      return {
        results: results.map((r: any) => {
          const md = r.metadata && typeof r.metadata === "object" ? r.metadata as Record<string, unknown> : {};
          return {
            contenido: r.content.length > 450 ? r.content.substring(0, 450) + "..." : r.content,
            tipo_fuente: r.source_type,
            similitud: Math.round(r.similarity * 100) + "%",
            metadata: {
              page_from: md.page_from,
              page_to: md.page_to,
              filename: md.filename,
              chunk_index: md.chunk_index,
            },
            client_id: r.client_id,
            project_id: r.project_id,
          };
        }),
        total: results.length,
        query: queryText,
      };
    }

    case "create_project": {
      const projectPhases = (args.phases || []).map((p: any, i: number) => ({
        key: `phase_${Date.now()}_${i}`,
        name: p.name,
        order: p.order ?? i,
      }));

      const { data: project, error } = await supabase.from("projects").insert({
        name: args.name,
        description: args.description || null,
        client_id: args.client_id || null,
        area: args.area || null,
        organization_id: orgId,
        created_by: userId,
        responsible_user_id: userId,
        tax_obligations: [],
        phases: projectPhases,
        service_tags: args.service_tags || [],
      }).select("id, name, area, status").single();
      if (error) return { error: error.message };

      // Create tasks if provided inline
      const taskResults: any[] = [];
      for (const task of args.tasks || []) {
        let phaseKey: string | null = null;
        if (task.phase_name) {
          const matched = projectPhases.find((p: any) => p.name.toLowerCase() === task.phase_name.toLowerCase());
          if (matched) phaseKey = matched.key;
        }
        const { data: td, error: te } = await supabase.from("tasks").insert({
          title: task.title,
          project_id: project.id,
          client_id: args.client_id || null,
          organization_id: orgId,
          created_by: userId,
          assigned_to: userId,
          area: args.area || null,
          priority: task.priority || "media",
          due_date: task.due_date || null,
          phase_key: phaseKey,
          status: "pendiente",
        }).select("id, title").single();
        taskResults.push(td || { title: task.title, error: te?.message });
      }

      // Save as template for future AI suggestions
      const svcUrlT = Deno.env.get("SUPABASE_URL")!;
      const svcKeyT = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const svcT = createClient(svcUrlT, svcKeyT);
      await svcT.from("project_templates").insert({
        name: args.name,
        description: args.description || null,
        area: args.area || null,
        phases: projectPhases,
        suggested_tasks: (args.tasks || []).map((t: any) => ({ title: t.title, phase_name: t.phase_name })),
        is_ai_generated: true,
        organization_id: orgId,
        created_by: userId,
        service_tags: args.service_tags || [],
      });

      return {
        success: true,
        project,
        phases: projectPhases,
        tasks_created: taskResults.filter((r) => !r.error).length,
        tasks: taskResults,
        url: `/proyectos/${project.id}`,
      };
    }

    case "create_tasks": {
      const results: any[] = [];
      for (const task of args.tasks || []) {
        const { data, error } = await supabase.from("tasks").insert({
          title: task.title,
          description: task.description || null,
          project_id: args.project_id || null,
          client_id: args.client_id || null,
          organization_id: orgId,
          created_by: userId,
          assigned_to: userId,
          area: args.area || null,
          priority: task.priority || "media",
          due_date: task.due_date || null,
          phase_key: task.phase_key || null,
          status: "pendiente",
        }).select("id, title, priority, status").single();
        if (error) {
          results.push({ title: task.title, error: error.message });
        } else {
          results.push(data);
        }
      }
      return { success: true, created: results.filter((r) => !r.error).length, tasks: results };
    }

    case "update_task": {
      let due_date: string | null | undefined = args.due_date;
      if (args.clear_due_date === true) due_date = null;
      const r = await applyTaskPatchFromAi(supabase, userId, orgId, conversationId, "update_task", {
        task_id: args.task_id,
        status: args.status,
        due_date,
        priority: args.priority,
        title: args.title,
        description: args.description,
        assigned_to: args.assigned_to,
      });
      return r.error ? r : { success: true, ...r };
    }

    case "update_tasks": {
      const list = Array.isArray(args.updates) ? args.updates.slice(0, 80) : [];
      if (list.length === 0) return { error: "updates vacío o inválido." };
      const results: Record<string, unknown>[] = [];
      let ok = 0;
      for (const p of list) {
        let due_date: string | null | undefined = p.due_date;
        if (p.clear_due_date === true) due_date = null;
        const r = await applyTaskPatchFromAi(supabase, userId, orgId, conversationId, "update_tasks", {
          task_id: p.task_id,
          status: p.status,
          due_date,
          priority: p.priority,
          title: p.title,
          description: p.description,
          assigned_to: p.assigned_to,
        });
        results.push(r);
        if (!r.error) ok++;
      }
      return { success: true, updated_count: ok, results };
    }

    case "add_task_comment": {
      const taskId = args.task_id;
      const content = typeof args.content === "string" ? args.content.trim() : "";
      if (!taskId || !content) return { error: "task_id y content son obligatorios." };
      if (content.length > 12_000) {
        return { error: "El comentario es demasiado largo (máx. 12000 caracteres)." };
      }

      const { data: trow, error: tErr } = await supabase
        .from("tasks")
        .select("id, organization_id")
        .eq("id", taskId)
        .single();
      if (tErr || !trow) return { error: tErr?.message || "Tarea no encontrada." };
      if (trow.organization_id !== orgId) return { error: "No autorizado para esta tarea." };

      const { error: cErr } = await supabase.from("task_comments").insert({
        task_id: taskId,
        user_id: userId,
        content,
        mentions: [],
      });
      if (cErr) return { error: cErr.message };

      await logAiTaskActivity(supabase, {
        userId,
        orgId,
        taskId,
        action: "commented",
        tool: "add_task_comment",
        conversationId,
        details: {
          comment_preview: content.length > 240 ? content.slice(0, 240) + "…" : content,
        },
      });

      return { success: true, task_id: taskId };
    }

    case "suggest_template": {
      let q = supabase.from("project_templates").select("id, name, description, area, phases, suggested_tasks, service_tags, client_type, avg_duration_days, usage_count").eq("organization_id", orgId);
      if (args.service_area) q = q.eq("area", args.service_area);
      const { data: tpls } = await q.order("usage_count", { ascending: false }).limit(10);
      if (!tpls || tpls.length === 0) {
        return { templates: [], suggestion: "No se encontraron plantillas. Se puede crear el proyecto desde cero y guardar como plantilla al finalizar." };
      }
      const filtered = tpls.filter((t: any) => {
        if (args.client_type && t.client_type && t.client_type !== args.client_type) return false;
        if (args.service_tags?.length) {
          const overlap = (t.service_tags || []).some((st: string) => args.service_tags.includes(st));
          if (!overlap && t.service_tags?.length) return false;
        }
        return true;
      });
      return {
        templates: (filtered.length > 0 ? filtered : tpls).slice(0, 5).map((t: any) => ({
          id: t.id, name: t.name, description: t.description, area: t.area,
          phases_count: (t.phases || []).length, tasks_count: (t.suggested_tasks || []).length,
          usage_count: t.usage_count || 0, service_tags: t.service_tags || [],
        })),
        suggestion: filtered.length > 0
          ? `Encontré ${filtered.length} plantilla(s) relevantes. La más usada es "${filtered[0].name}".`
          : `No hay plantillas exactas pero estas ${Math.min(tpls.length, 5)} podrían adaptarse.`,
      };
    }

    default:
      return { error: `Herramienta desconocida: ${name}` };
  }
}

async function fetchUserWorkSnapshot(
  svc: ReturnType<typeof createClient>,
  userId: string,
  orgId: string,
): Promise<string> {
  const todayYmd = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const { count: pending } = await svc.from("tasks").select("id", { count: "exact", head: true })
    .eq("assigned_to", userId)
    .eq("organization_id", orgId)
    .in("status", ["pendiente", "en_progreso", "en_revision"]);

  const { count: urgent } = await svc.from("tasks").select("id", { count: "exact", head: true })
    .eq("assigned_to", userId)
    .eq("organization_id", orgId)
    .in("status", ["pendiente", "en_progreso", "en_revision"])
    .in("priority", ["urgente", "alta"]);

  const { data: dueRows } = await svc.from("tasks").select("due_date")
    .eq("assigned_to", userId)
    .eq("organization_id", orgId)
    .in("status", ["pendiente", "en_progreso", "en_revision"])
    .not("due_date", "is", null);

  let overdue = 0;
  for (const t of dueRows ?? []) {
    if (String(t.due_date).slice(0, 10) < todayYmd) overdue++;
  }

  const { data: projs } = await svc.from("projects").select("name")
    .eq("organization_id", orgId)
    .eq("status", "activo")
    .order("updated_at", { ascending: false })
    .limit(8);

  const names = (projs ?? []).map((p: { name: string }) => p.name).filter(Boolean);

  const { data: lastT } = await svc.from("tasks").select("title, updated_at")
    .eq("assigned_to", userId)
    .order("updated_at", { ascending: false })
    .limit(1);

  const lastTitle = lastT?.[0]?.title;

  return `## Resumen operativo del usuario (al abrir el chat)
- Tareas pendientes asignadas a esta persona: ${pending ?? 0}
- Prioridad alta o urgente: ${urgent ?? 0}
- Con fecha límite ya vencida: ${overdue}
- Proyectos activos recientes (nombres): ${names.length ? names.join(", ") : "—"}
- Última tarea tocada: ${lastTitle ? `"${lastTitle}"` : "—"}
Hoy es ${todayYmd} (zona Ciudad de México). Personaliza saludos y priorización con esto; confirma detalle con herramientas si hace falta.`;
}

// ─── Build system prompt ───
function buildSystemPrompt(profile: any) {
  return `Eres **Kawiil AI**, el asistente inteligente INTERNO de Kawiil — un despacho contable y legal en México que opera como un equipo unido de profesionales llamados "Kawiilers".

## IDENTIDAD Y VOZ
Hablas como un compañero de equipo más: cercano, profesional, motivador y directo. Usas un tono cálido pero eficiente. Tuteas al usuario. Cuando das información, no solo listas datos: **explicas qué significan y qué acción tomar**.

## ESTILO DE RESPUESTA EN EL CHAT (prioridad; aplica a TODA respuesta visible)
La regla principal: **el usuario debe leer prosa conectada, no un inventario**. Los apartados siguientes son operativos para ti (no copies este formato de viñetas al usuario salvo excepciones indicadas abajo).

**Cómo redactar:** párrafos que encadenen ideas (por tanto, además, lo que esto implica es…, te sugiero…). Explica el «por qué» y guía el siguiente paso en frases, no en renglones sueltos con guiones.

**Prohibido como cuerpo principal de la respuesta:** bloques dominados por líneas que empiecen con guion (-), asterisco (*), bullet (•) o numeración (1.), salvo que el usuario haya pedido explícitamente «lista», «enumerar», «checklist», «pasos» o «desglose». Si dudas, **no listes**: escribe dos o tres párrafos.

**Herramientas y RAG:** integra resultados en narrativa; nunca entregues al usuario un catálogo de documentos o fragmentos uno por renglón.

**Excepción breve:** como máximo **una** lista corta al final (3 a 5 ítems) solo si son pasos ejecutables muy concretos; el resto de la respuesta debe ser párrafos.

**Artifacts:** el contenido largo va en herramientas de documento; en el chat solo **párrafos** de resumen (qué es y para qué sirve).

**Ejemplos (así debe verse tu salida al usuario, en prosa):** «Tienes cinco pendientes esta semana; el que más presiona es [X] porque vence mañana. Yo empezaría por ese y luego bajaría a [Y].» «El proyecto de [Cliente] va bien: ya cerraron los tres primeros hitos. Lo que toca ahora es [siguiente paso], sobre todo porque [razón breve].»

## CAPACIDADES PRINCIPALES

### 1. Resumen y priorización de trabajo
- Cuando pregunten "¿qué tengo pendiente?" o "¿por dónde empiezo?", consulta las tareas y organízalas por urgencia.
- Prioriza: vencimientos próximos > prioridad urgente/alta > tareas en progreso sin avance.
- Siempre sugiere un orden de acción claro.

### 2. Visión de equipo y motivación
- Muestra la carga de trabajo con contexto positivo y empático.
- Sugiere apoyo cuando detectes sobrecarga.

### 3. Conocimiento profundo de la plataforma
- Tienes acceso a comentarios de tareas, detalles de proyectos, actividad reciente y documentos procesados.
- **USA get_task_details** cuando necesites entender el contexto de una tarea específica, incluyendo las discusiones del equipo en los comentarios.
- **USA get_project_details** para dar un panorama completo de un proyecto con sus miembros y tareas.
- **USA get_recent_activity** para saber qué ha pasado recientemente en la organización.
- **USA get_extracted_documents** para consultar información fiscal extraída de documentos (CFDIs, declaraciones, etc.).
- **USA search_across** cuando necesites encontrar cualquier entidad por nombre.

### 4. Memoria y base de conocimiento (RAG)
- Tienes acceso a una **base de conocimiento vectorial** con documentos, conversaciones previas, procedimientos, comunicados y **memorias persistentes**.
- **USA semantic_search PRIMERO** cuando el usuario pregunte sobre un tema, ley, procedimiento, cliente o concepto. Es tu herramienta más potente: encuentra información relevante incluso si las palabras exactas no coinciden.
- Cuando busques sobre un cliente específico, pasa el client_id como filtro para resultados más precisos.
- Si semantic_search no encuentra suficiente info, complementa con search_past_conversations (búsqueda exacta en conversaciones) y search_across (búsqueda en tareas/clientes/proyectos/pipeline).
- Tras semantic_search, **sintetiza en párrafos** lo relevante para la pregunta; no devuelvas al usuario un inventario de fragmentos o documentos salvo que pida un índice o un listado explícito.
- Al responder, SIEMPRE cruza la información de múltiples fuentes: conocimiento base + memorias + comentarios + descripción + actividad.
- Si el usuario pregunta sobre una persona, consulta sus tareas Y la actividad reciente para dar un panorama completo.
- Si pregunta sobre un cliente, consulta sus proyectos, tareas, documentos extraídos Y memorias guardadas.
- Si encuentras información de la base de conocimiento o memorias, cítala: "Según mis notas..." o "En un análisis anterior guardé que..."
- **GUARDA en memoria** todo insight valioso: conclusiones de análisis, datos clave de clientes, estrategias discutidas, decisiones tomadas. Esto construye conocimiento real que perdura entre conversaciones.

### 5. Generación de documentos (Artifacts)
**NUNCA escribas en tu respuesta bloques como \`[artifact:UUID|…|…]\`.** Esos marcadores los añade el servidor al final cuando la herramienta crea el archivo; si los inventas, el usuario verá un error "artefacto no existe".

**TODO artifact que generes sale con diseño Kawiil profesional (PDF + DOCX con portada, tipografía, tablas con color y paginación), igual que los artifacts de Claude.** Ya no existe la salida "markdown plano": incluso si llamas \`create_artifact\`, el backend convierte automáticamente el markdown a documento genérico (template \`generico\`) y genera PDF+DOCX. Por eso:

- **PREFIERE SIEMPRE \`create_ai_document\`** con el \`template_key\` adecuado. El resultado es más rico (portada con metadata, callouts, tablas estructuradas, recomendaciones, firmas, totales, KPIs, etc.).
- **Usa \`create_artifact\` solo como fallback** cuando el contenido es tan libre / narrativo que no encaja en ningún template. Igualmente saldrá con diseño Kawiil, pero **pierdes estructura rica** (sin portada con clasificación, sin callouts, sin tablas profesionales con colores por columna).
- **NUNCA** respondas con un bloque largo de markdown en el chat pensando "es un entregable": lo correcto es llamar a \`create_ai_document\`.

**Elección de \`template_key\` en \`create_ai_document\`** (reglas por intención):
- **Estudios fiscales / precios de transferencia / papeles de trabajo / dictámenes / análisis jurídicos / opinión contable / informe de hallazgos** → \`informe_ejecutivo\` con \`metadata.clasificacion\` (p. ej. "Confidencial — Uso Fiscal") y secciones con \`paragraphs\`, \`tables\` (obligatorias si hay cifras) y \`recommendations\` (conclusiones del estudio).
- Reporte / análisis ejecutivo / informe de clientes → \`informe_ejecutivo\`.
- Acta / minuta / notas de reunión → \`minuta_reunion\`.
- Propuesta comercial / cotización / oferta → \`propuesta_cotizacion\`.
- Factura / remisión / nota fiscal → \`factura_remision\`.
- Reporte financiero / KPIs / estado de resultados / flujo → \`reporte_financiero\`.
- Cualquier otro documento formal sin encaje claro → \`generico\` (fallback).

**requested_formats** y **primary_format**:
- Incluye normalmente \`pdf\` y \`docx\` para informes largos (PDF para leer, Word para editar).
- **Si el usuario pide Word / editable / DOCX** → \`primary_format\` debe ser \`"docx"\` y el orden en \`requested_formats\` debe poner \`docx\` **antes** que \`pdf\` (ej. \`["docx","pdf"]\`). Así la app muestra Word como formato principal.
- **Si el usuario pide PDF o no especifica formato de entrega** → \`primary_format\`: \`"pdf"\` y puedes usar \`["pdf","docx"]\` o \`["pdf"]\`.
- **Si el usuario NO ha dicho si quiere PDF, Word, Excel o PowerPoint** para un documento de entrega, **pregunta primero** (una pregunta corta con opciones) y **no** llames a \`create_ai_document\` hasta que responda o quede claro por contexto.
- Propuestas / facturas / reportes financieros → agrega \`"xlsx"\` si necesitan editar montos en Excel; fija \`primary_format\` al formato que el usuario priorice.
- Presentaciones → \`"pptx"\` y \`primary_format\` acorde.

**content** debe seguir el shape del template elegido (ver descripción del tool). **Siempre incluye \`metadata\`** (code / emisor / destinatario / fecha / clasificacion / version) cuando tengas datos; mejora mucho la portada del PDF. Para estudios fiscales usa \`clasificacion\` tipo "Confidencial — Uso Fiscal" o "Confidencial — Uso Interno".

**Ejemplo: Estudio de Precios de Transferencia** cuando el usuario quiere **Word como entrega principal** (→ \`informe_ejecutivo\` + \`requested_formats: ["docx","pdf"]\` + \`primary_format: "docx"\`):
\`\`\`json
{
  "title": "Estudio de Precios de Transferencia - Empathy Design S.A.P.I. 2024-2025",
  "template_key": "informe_ejecutivo",
  "requested_formats": ["docx", "pdf"],
  "primary_format": "docx",
  "content": {
    "metadata": { "emisor": "Kawiil - Servicios Profesionales", "fecha": "21 de abril de 2026", "clasificacion": "Confidencial — Uso Fiscal" },
    "summary": "El presente estudio documenta y analiza las operaciones controladas de Empathy Design…",
    "sections": [
      { "heading": "Operaciones analizadas", "paragraphs": ["Se analizaron operaciones por USD 38,109.37…"], "tables": [{ "headers": ["Contraparte", "Monto USD", "Margen"], "rows": [["Bold Moves Argentina", "25,000.00", "33.77%"], ["Viernes Peru SAC", "13,109.37", "33.77%"]] }] },
      { "heading": "Metodología TNMM", "paragraphs": ["Se aplicó el método TNMM…"] }
    ],
    "recommendations": ["Mantener documentación contemporánea", "Actualizar análisis anualmente"]
  },
  "confidence": 0.95
}
\`\`\`

Si \`confidence < 0.55\`, pide aclaración al usuario antes de generar el archivo.
Los artifacts aparecen en un panel lateral con preview real del PDF y descargas multi-formato.

### 5b. Creación de proyectos y tareas
- **USA create_project** cuando el usuario pida crear un proyecto nuevo, ya sea directamente ("crea un proyecto de..."), analizando una minuta de reunión, o cuando del contexto se deduzca que hay que crear un nuevo proyecto. Puedes incluir fases y tareas directamente en la herramienta.
- **USA create_tasks** cuando el usuario pida crear tareas, ya sea a partir de instrucciones directas, una minuta, un análisis, o fases de un proyecto. Puedes crear múltiples tareas de una vez.
- **USA suggest_template** para buscar plantillas relevantes cuando el usuario quiera crear un proyecto similar a uno anterior.
- Cuando el usuario comparta una minuta o notas de reunión, analiza el contenido y propón la creación del proyecto y tareas correspondientes. Confirma con el usuario antes de crearlos, a menos que el usuario diga explícitamente "crea las tareas".
- Al crear proyectos, intenta identificar el cliente y área correctos basándote en el contexto.
- Al crear tareas, asigna prioridades inteligentemente según la urgencia y la naturaleza de la tarea.
- **IMPORTANTE:** Cuando crees un proyecto exitosamente, SIEMPRE incluye en tu respuesta el marcador [project:UUID_DEL_PROYECTO|NOMBRE_DEL_PROYECTO|AREA] para que aparezca una tarjeta visual del proyecto en el chat. Ejemplo: [project:abc-123|Contabilidad Grupo Dazon|contabilidad]

### 5c. Actualización de tareas existentes (no digas que no puedes)
- **USA update_task** para cambiar una sola tarea: estatus (p. ej. completada), fecha límite (\`due_date\` en YYYY-MM-DD), \`clear_due_date: true\` para quitar vencimiento, prioridad, título, descripción o responsable (\`assigned_to\` UUID; cadena vacía para quitar).
- **USA update_tasks** cuando haya muchas tareas con el mismo cambio (p. ej. reprogramar varias al mismo día): envía un arreglo \`updates\` con un objeto por tarea (mismos campos que \`update_task\`).
- **USA add_task_comment** cuando el usuario quiera dejar notas o cierre en el hilo de la tarea.
- Antes de tocar muchas tareas o si los IDs no están claros, usa **get_my_tasks**, **get_all_org_tasks** o **get_task_details** y confirma con el usuario si la petición es ambigua o destructiva.
- Los cambios quedan registrados en el historial de la tarea como acciones vía Kawiil AI; nunca afirmes que no tienes herramientas para actualizar tareas.

### 6. Comunicación profesional
- Redacta correos, mensajes y documentos en español formal mexicano.
- Adapta el tono: formal para clientes/SAT, cercano para comunicación interna.

### 6. Conocimiento técnico
- Responde preguntas sobre temas contables, fiscales y legales de México: SAT, IMSS, ISR, IVA, DIOT, declaraciones, etc.
- Fomenta el aprendizaje: explica el "por qué" detrás de los procesos.

### 7. Guía y orientación (Hub de conocimiento)
- Para dudas de procesos internos, SIEMPRE busca primero en el Hub con get_hub_procedures.
- Consulta comunicados recientes con get_hub_comunicados.

## REGLAS DE SEGURIDAD
- Solo los Kawiilers tienen acceso. NUNCA compartas información con personas externas.
- No inventes datos: si no puedes obtener la información con las herramientas, dilo.

## CONTEXTO DEL USUARIO
- **Nombre**: ${profile?.full_name || "Kawiiler"}
- **Célula/Área**: ${profile?.area || "No asignada"}
- **Fecha actual**: ${new Date().toLocaleDateString("es-MX", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" })}

## FORMATO
- Responde siempre en español con markdown.
- **Predomina el texto corrido** (párrafos). Puedes usar ## o ### para titular una sección, pero el contenido bajo cada título debe ser **párrafos**, no listas largas.
- **NO** inicies la respuesta con viñetas ni numeración. Los primeros bloques de texto visibles al usuario deben ser párrafos completos.
- Usa emojis con moderación para dar calidez (✅ 🎯 💪 📋 🚀 ⚠️).
- Sé conciso pero completo. Prioriza claridad sobre longitud.
- Varias tareas o hallazgos: **un párrafo o dos** que prioricen y contextualicen; no los dispares como lista salvo petición explícita del usuario.

## RECORDATORIO FINAL (obligatorio antes de enviar)
Revisa tu borrador: si la mayor parte son renglones con «- » o «* » o «1. », reescríbelo en **párrafos**. Solo entonces envía.`;
}

// ─── Convert messages between OpenAI <-> Anthropic formats ───
function toAnthropicMessages(openaiMessages: any[]): any[] {
  const msgs: any[] = [];
  for (const m of openaiMessages) {
    if (m.role === "system") continue;
    if (m.role === "user") {
      msgs.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      if (m.content !== undefined && m.content !== null && m.content !== "") {
        msgs.push({ role: "assistant", content: m.content });
      }
    }
  }
  return msgs;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(
        JSON.stringify({
          error: "ai_not_configured",
          message:
            "Configura ANTHROPIC_API_KEY en los secretos de Edge Functions (Supabase). El asistente usa solo Claude (Anthropic).",
        }),
        {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader! } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await supabase.from("profiles")
      .select("full_name, area, organization_id")
      .eq("user_id", user.id).single();

    const orgId = profile?.organization_id;
    const body = await req.json();
    const {
      messages,
      simple,
      searchMode,
      searchQuery,
      ai_project_id,
      attachmentRefs,
      insightLite,
      indexed_attachment_names,
      systemPrompt: clientSystemPrompt,
      conversationId: bodyConversationId,
    } = body;

    const conversationIdForTools =
      typeof bodyConversationId === "string" && bodyConversationId.trim().length > 0
        ? bodyConversationId.trim()
        : null;

    const svcUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(svcUrl, serviceKey);

    const access = await assertAiProjectAccess(svc, ai_project_id, user.id, orgId ?? null);
    if (!access.ok) {
      return new Response(JSON.stringify({ error: access.error }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { forClaude } = await resolveChatAttachments(svc, messages || [], attachmentRefs);

    const LITE_SYSTEM_PROMPT =
      `Eres el asistente de Kawiil, un despacho de contabilidad, fiscal y legal en México.\n` +
      `Responde en español mexicano, profesional y claro.\n` +
      `El mensaje del usuario incluye datos reales del sistema: no inventes cifras.\n` +
      `Obligatorio: la respuesta debe ser principalmente párrafos conectados. NO abras con viñetas (-, *) ni numeración salvo que el usuario pida lista o pasos numerados.\n` +
      `Si pide Markdown concreto, usa **negritas** y la estructura pedida; emojis con moderación.\n` +
      `Antes de enviar: si dominan las listas, reescribe en prosa.`;

    // Load AI Project context + memories (omitido en simple+insightLite para menos tokens y menos carga)
    let projectContext = "";

    if (!(simple && insightLite)) {
      if (ai_project_id) {
        const { data: aiProject } = await svc.from("ai_projects")
          .select("name, description, instructions, client_id, project_id")
          .eq("id", ai_project_id)
          .single();

        if (aiProject) {
          projectContext = `\n\n## PROYECTO DE IA ACTIVO: ${aiProject.name}`;
          if (aiProject.description) projectContext += `\nDescripción: ${aiProject.description}`;
          if (aiProject.instructions) projectContext += `\n\n### Instrucciones del proyecto:\n${aiProject.instructions}`;
          if (aiProject.client_id) projectContext += `\n- Filtrar búsquedas semánticas por client_id: ${aiProject.client_id}`;
          if (aiProject.project_id) projectContext += `\n- Filtrar búsquedas semánticas por project_id: ${aiProject.project_id}`;

          const { data: projDocs } = await svc.from("ai_project_documents")
            .select("name, source, dropbox_path")
            .eq("ai_project_id", ai_project_id);

          if (projDocs?.length) {
            projectContext += `\n\n### Documentos vinculados al proyecto (${projDocs.length}):`;
            for (const d of projDocs) {
              projectContext += `\n- ${d.name} (${d.source})`;
            }
            projectContext += `\nUsa semantic_search para buscar en estos documentos cuando sea relevante.`;
          }
        }
      }

      // Load existing memories for this context
      let memQuery = svc.from("ai_project_memories")
        .select("path, content, updated_at")
        .eq("user_id", user.id)
        .eq("organization_id", orgId);
      if (ai_project_id) memQuery = memQuery.eq("ai_project_id", ai_project_id);
      else memQuery = memQuery.is("ai_project_id", null);
      const { data: memories } = await memQuery.order("path");

      let sharedMemories: { path: string; content: string; updated_at: string }[] = [];
      if (ai_project_id) {
        const { data: sm } = await svc.from("ai_project_shared_memories")
          .select("path, content, updated_at")
          .eq("ai_project_id", ai_project_id)
          .order("path");
        sharedMemories = sm || [];
      }

      projectContext += `\n\n### Memoria persistente (Memory Tool)
- **Personal** (solo el usuario): rutas bajo \`/memories/\` — notas privadas del Kawiiler.
- **Equipo** (proyecto de IA compartido): rutas bajo \`/team/\` — visibles para todos los miembros del proyecto. Requiere proyecto de IA activo.
- COMANDOS: 'view', 'create', 'str_replace', 'insert', 'delete', 'rename'.
- Usa \`/team/\` para decisiones y contexto que deban ver colegas en el mismo proyecto de IA.`;

      if (memories?.length) {
        projectContext += `\n\n**Memorias personales (${memories.length}):**`;
        for (const m of memories) {
          const preview = m.content.substring(0, 120).replace(/\n/g, " ");
          projectContext += `\n- \`${m.path}\` — ${preview}…`;
        }
      } else {
        projectContext += `\n\nSin memorias personales en /memories/ todavía.`;
      }

      if (sharedMemories.length) {
        projectContext += `\n\n**Memoria de equipo /team/ (${sharedMemories.length} archivos):**`;
        for (const m of sharedMemories) {
          const preview = m.content.substring(0, 120).replace(/\n/g, " ");
          projectContext += `\n- \`${m.path}\` — ${preview}…`;
        }
      } else if (ai_project_id) {
        projectContext += `\n\nAún no hay memorias de equipo (/team/). Crea con memory create en rutas /team/archivo.md cuando el conocimiento deba compartirse.`;
      }
    }

    let workSnapshot = "";
    if (!(simple && insightLite) && orgId) {
      try {
        workSnapshot = "\n\n" + await fetchUserWorkSnapshot(svc, user.id, orgId);
      } catch (e) {
        console.warn("fetchUserWorkSnapshot:", e);
      }
    }

    let userMemoriesBlock = "";
    if (!(simple && insightLite) && orgId) {
      const { data: userMems } = await svc
        .from("ai_user_memories")
        .select("memory_type, content")
        .eq("user_id", user.id)
        .eq("organization_id", orgId)
        .eq("enabled", true)
        .order("created_at", { ascending: false })
        .limit(24);
      if (userMems?.length) {
        userMemoriesBlock = "\n\n## Notas automáticas sobre este usuario (memoria conversacional)\n";
        userMemoriesBlock +=
          "Úsalas como contexto; no contradigas herramientas ni datos frescos. Si el usuario cambia de idea, prioriza lo actual.\n";
        for (const um of userMems) {
          userMemoriesBlock += `\n- [${um.memory_type}] ${String(um.content || "").replace(/\n/g, " ").slice(0, 280)}`;
        }
      }
    }

    let systemPrompt = simple && insightLite
      ? LITE_SYSTEM_PROMPT
      : buildSystemPrompt(profile) + workSnapshot + userMemoriesBlock + projectContext;

    const indexedNames = Array.isArray(indexed_attachment_names)
      ? indexed_attachment_names.filter((n: unknown) => typeof n === "string" && n.trim().length > 0)
      : [];
    if (indexedNames.length > 0 && !(simple && insightLite)) {
      systemPrompt +=
        `\n\n## PDF(s) del usuario indexados para búsqueda semántica\n` +
        `Estos archivos ya fueron fragmentados y están en la base vectorial de la organización: **${indexedNames.join(", ")}**.\n` +
        `Para responder sobre su contenido debes usar la herramienta **semantic_search** con una consulta en lenguaje natural (reformula la pregunta del usuario si hace falta). ` +
        `Los fragmentos recuperados incluyen metadatos con rangos de página aproximados (page_from / page_to) cuando apliquen.\n` +
        `No digas que "leíste el PDF completo" sin haber llamado a semantic_search.\n` +
        `Al integrar lo encontrado, responde en **párrafos** al usuario, no como inventario de fragmentos.\n`;
    }

    if (
      typeof clientSystemPrompt === "string" &&
      clientSystemPrompt.trim().length > 0 &&
      !(simple && insightLite)
    ) {
      systemPrompt += `\n\n## Instrucciones adicionales del cliente\n${clientSystemPrompt.trim()}`;
    }

    systemPrompt = clampSystemPromptForClaude(systemPrompt);

    const sseProgressPreamble: { phase: string; message: string }[] = [];
    const nAtt = Array.isArray(attachmentRefs) ? attachmentRefs.length : 0;
    if (indexedNames.length > 0) {
      sseProgressPreamble.push({
        phase: "indexed_pdfs",
        message: `${indexedNames.length} PDF(s) disponibles vía búsqueda semántica: ${indexedNames.join(", ")}`,
      });
    }
    if (nAtt > 0) {
      sseProgressPreamble.push({
        phase: "attachments",
        message: `Integrando ${nAtt} adjunto(s) en el mensaje (extracción según tipo de archivo)…`,
      });
    }
    sseProgressPreamble.push({
      phase: "context",
      message: ai_project_id
        ? "Cargando instrucciones, proyecto de IA, memorias y herramientas…"
        : "Cargando instrucciones del asistente y herramientas de Kawiil…",
    });

    // ─── Direct search mode (structured results + optional AI summary) ───
    if (searchMode && searchQuery) {
      const results = await executeTool("search_across", { query: searchQuery }, supabase, user.id, orgId, null);

      // Try to generate a brief AI summary of the results
      let summary = "";
      if (Array.isArray(results) && results.length > 0) {
        try {
          const summaryPrompt = `El usuario buscó "${searchQuery}" en la plataforma. Estos son los resultados encontrados:\n${JSON.stringify(results, null, 2)}\n\nGenera un resumen breve (2-3 oraciones) en español que contextualice qué encontramos relacionado con "${searchQuery}". No listes los resultados, solo da contexto. Sé conciso y útil.`;

          const summaryResp = await anthropicMessagesFetch(ANTHROPIC_API_KEY, {
            model: "claude-sonnet-4-20250514",
            max_tokens: 256,
            messages: [{ role: "user", content: summaryPrompt }],
          });

          if (summaryResp.ok) {
            const sData = await summaryResp.json();
            summary = sData.content?.find?.((b: any) => b.type === "text")?.text || "";
          }
        } catch (e) {
          console.warn("Search summary generation failed (non-critical):", e);
        }
      }

      return new Response(JSON.stringify({ results, summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── Simple mode (no tools, no streaming) ───
    if (simple) {
      const simpleMsgs = pruneClaudeMessages(
        toAnthropicMessages(forClaude),
        MAX_CLAUDE_MESSAGES_ESTIMATED_TOKENS,
      );
      const resp = await anthropicMessagesFetch(ANTHROPIC_API_KEY, {
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: systemPrompt,
        messages: simpleMsgs,
      });
      if (resp.ok) {
        const data = await resp.json();
        const text = data.content?.find((b: any) => b.type === "text")?.text || "";
        return new Response(JSON.stringify({ content: text }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const errText = await resp.text();
      let retryAfter: number | undefined;
      try {
        const j = JSON.parse(errText);
        retryAfter = j?.error?.retry_after ?? j?.retry_after;
      } catch {
        /* ignore */
      }

      if (resp.status === 429) {
        const msg = "Demasiadas solicitudes. Intenta de nuevo en unos segundos.";
        const payload: Record<string, unknown> = {
          error: msg,
          message: msg,
        };
        if (typeof retryAfter === "number") payload.retry_after = retryAfter;
        else payload.retry_after = 8;
        return new Response(JSON.stringify(payload), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (
        resp.status === 529 ||
        resp.status === 503 ||
        errText.includes("overloaded_error") ||
        anthropicErrorTypeFromBody(errText) === "overloaded_error"
      ) {
        const msg =
          "Claude está temporalmente saturado (muchas peticiones en Anthropic). Espera unos segundos e inténtalo de nuevo.";
        return new Response(
          JSON.stringify({
            error: msg,
            message: msg,
            code: "claude_overloaded",
            retry_after: 15,
          }),
          {
            status: 503,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (resp.status === 400 && isAnthropicPromptTooLongMessage(errText)) {
        const msg =
          "La conversación o los adjuntos superan el límite de contexto del modelo. Inicia un chat nuevo o reduce el historial.";
        return new Response(
          JSON.stringify({ error: msg, message: msg, code: "context_too_long" }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (isAnthropicCreditBalanceLow(resp.status, errText)) {
        return responseAnthropicBilling();
      }

      console.warn("Claude simple failed:", resp.status, errText.slice(0, 200));
      return new Response(
        JSON.stringify({ error: "Error del servicio de IA (Claude)", detail: errText.slice(0, 500) }),
        {
          status: resp.status >= 400 && resp.status < 600 ? resp.status : 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // ─── Main chat with tools (Claude / Anthropic) ───
    // IMPORTANTE: abrimos el SSE inmediatamente para mantener viva la conexión
    // (el runtime de Supabase corta la request si no hay actividad durante 150 s).
    // A partir de aquí toda la respuesta se entrega por el stream, incluyendo errores
    // del pipeline (ya no podemos cambiar el status HTTP).
    const sseWriter = openLiveSseStream(sseProgressPreamble);

    (async () => {
      try {
        await handleClaudeChat(
          ANTHROPIC_API_KEY,
          systemPrompt,
          forClaude,
          supabase,
          user.id,
          orgId!,
          ai_project_id || null,
          sseWriter,
          authHeader!,
          conversationIdForTools,
        );
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn("Claude chat failed:", errMsg);
        if (errMsg.includes("RATE_LIMIT_429")) {
          sseWriter.fail(
            "**Demasiadas solicitudes al proveedor de IA.** Espera unos segundos e intenta de nuevo.",
          );
        } else if (errMsg.includes("CLAUDE_OVERLOADED")) {
          sseWriter.fail(
            "**Claude está temporalmente saturado** (muchas peticiones en Anthropic). Es un fallo temporal; reintenta en unos minutos.",
          );
        } else if (errMsg.includes(ANTHROPIC_BILLING_THROW) || textLooksLikeAnthropicBilling(errMsg)) {
          sseWriter.fail(`**Créditos del proveedor de IA insuficientes.**\n\n${MSG_ANTHROPIC_BILLING_ES}`);
        } else if (
          errMsg.includes("CLAUDE_CONTEXT_TOO_LONG") ||
          errMsg.toLowerCase().includes("prompt is too long")
        ) {
          sseWriter.fail(
            "**El contexto supera el límite del modelo (200k tokens).** " +
              "Inicia un chat nuevo, acorta el historial o evita varios PDFs enormes en el mismo hilo.",
          );
        } else {
          sseWriter.fail(`**Error del servicio de IA.** ${errMsg}`);
        }
      } finally {
        if (!sseWriter.isClosed()) sseWriter.close();
      }
    })().catch((e) => {
      console.error("ai-chat background pipeline error:", e);
      try {
        sseWriter.fail("**Error interno del pipeline de IA.** Reintenta en unos segundos.");
      } catch {
        /* ignore */
      }
    });

    return sseWriter.response;
  } catch (e) {
    console.error("ai-chat error:", e);
    const outerMsg = e instanceof Error ? e.message : "Error desconocido";
    const low = outerMsg.toLowerCase();
    if (outerMsg.includes("CLAUDE_OVERLOADED") || low.includes("overloaded_error")) {
      const msg =
        "Claude está temporalmente saturado (muchas peticiones en Anthropic). Espera unos segundos e inténtalo de nuevo.";
      return new Response(
        JSON.stringify({
          error: msg,
          message: msg,
          code: "claude_overloaded",
          retry_after: 15,
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (
      low.includes("prompt is too long") ||
      outerMsg.includes("CLAUDE_CONTEXT_TOO_LONG") ||
      low.includes("context length") ||
      low.includes("too many tokens")
    ) {
      const msg =
        "La conversación o los adjuntos superan el límite de contexto del modelo (200k tokens). " +
        "Inicia un chat nuevo, reduce el historial, imágenes ≤ 512 KB o usa búsqueda semántica en PDFs indexados.";
      return new Response(
        JSON.stringify({ error: msg, message: msg, code: "context_too_long" }),
        { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    return new Response(JSON.stringify({ error: outerMsg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Artifact Tool handler ───
async function handleCreateArtifact(
  input: any,
  userId: string,
  orgId: string,
  aiProjectId: string | null,
  opts?: { renderStatus?: "ready" | "pending" | "failed"; renderError?: string | null },
): Promise<string> {
  const svcUrlA = Deno.env.get("SUPABASE_URL")!;
  const serviceKeyA = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(svcUrlA, serviceKeyA);

  const { title, content, content_type } = input;
  if (!title || !content) return JSON.stringify({ error: "title and content are required" });
  const normalizedContentType = typeof content_type === "string" ? content_type : "markdown";
  if (!["markdown", "code", "html", "csv"].includes(normalizedContentType)) {
    return JSON.stringify({ error: "content_type inválido para create_artifact" });
  }

  // Cuando este handler es invocado como fallback del auto-upgrade a Kawiil,
  // marcamos render_status='pending' para que el reconciliador lo procese después
  // (y el UI pueda mostrar un badge "Generando…" sin bloquear la conversación).
  const renderStatus = opts?.renderStatus || "ready";
  const renderError = opts?.renderError ?? null;

  const { data: artifact, error } = await svc.from("ai_artifacts").insert({
    ai_project_id: aiProjectId || null,
    user_id: userId,
    organization_id: orgId,
    title,
    content,
    content_type: normalizedContentType,
    render_status: renderStatus,
    render_error: renderError,
  }).select("id").single();

  if (error) {
    console.error("Artifact insert error:", error);
    return JSON.stringify({ error: error.message });
  }

  // Auto-embed the artifact content
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (openaiKey && content.length > 30) {
    try {
      const textToEmbed = `[Artifact: ${title}] ${content}`.replace(/\n+/g, " ").trim().substring(0, 8000);
      const embResp = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: textToEmbed, model: "text-embedding-3-small", dimensions: 1536 }),
      });
      if (embResp.ok) {
        const embData = await embResp.json();
        await svc.from("document_chunks").insert({
          organization_id: orgId,
          source_type: "artifact",
          source_id: artifact.id,
          content: `[Artifact: ${title}] ${content}`.substring(0, 4000),
          metadata: { title, ai_project_id: aiProjectId, content_type: normalizedContentType },
          embedding: JSON.stringify(embData.data[0].embedding),
          token_count: Math.ceil(textToEmbed.length / 3.5),
        });
      }
    } catch (e) {
      console.error("Artifact embedding failed (non-blocking):", e);
    }
  }

  return JSON.stringify({
    artifact_id: artifact.id,
    title,
    content_type: normalizedContentType,
    render_status: renderStatus,
    message: renderStatus === "pending"
      ? `Artifact "${title}" guardado como markdown; reintentando generación profesional en segundo plano.`
      : `Artifact "${title}" creado exitosamente.`,
  });
}

type KawiilTemplateKey =
  | "informe_ejecutivo"
  | "minuta_reunion"
  | "propuesta_cotizacion"
  | "factura_remision"
  | "reporte_financiero"
  | "generico";
type KawiilOutputFormat = "pdf" | "docx" | "xlsx" | "pptx";

const KAWIIL_TEMPLATE_KEYS: KawiilTemplateKey[] = [
  "informe_ejecutivo",
  "minuta_reunion",
  "propuesta_cotizacion",
  "factura_remision",
  "reporte_financiero",
  "generico",
];

const KAWIIL_FORMAT_MIME: Record<KawiilOutputFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

const KAWIIL_FORMAT_EXT: Record<KawiilOutputFormat, string> = {
  pdf: "pdf",
  docx: "docx",
  xlsx: "xlsx",
  pptx: "pptx",
};

// Back-compat: mapear office_kind histórico → template key genérico.
const LEGACY_OFFICE_KIND_TO_TEMPLATE: Record<string, KawiilTemplateKey> = {
  spreadsheet: "generico",
  word_document: "generico",
  presentation: "generico",
};

const LEGACY_OFFICE_KIND_TO_FORMAT: Record<string, KawiilOutputFormat> = {
  spreadsheet: "xlsx",
  word_document: "docx",
  presentation: "pptx",
};

function isKawiilTemplateKey(value: unknown): value is KawiilTemplateKey {
  return typeof value === "string" && (KAWIIL_TEMPLATE_KEYS as string[]).includes(value);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ─── Markdown → generico content parser ───
// Convierte markdown libre (headings ##, bullets, tablas |col|col|) en la
// estructura que espera el template `generico` de `render-ai-document`.
// Se usa como auto-upgrade cuando la IA llama `create_artifact`: así cualquier
// artifact termina con diseño Kawiil (PDF + DOCX) en vez de markdown plano.
interface GenericSection {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
  tables?: Array<{ headers: string[]; rows: string[][] }>;
}

interface GenericContent {
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

function markdownToGenericContent(markdown: string, _title: string): GenericContent {
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

    // Heading
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      flushAll();
      const heading = headingMatch[2].trim();
      // Titulo H1 al inicio: si coincide aproximadamente con title o es la primera línea, ignóralo.
      if (headingMatch[1].length === 1 && !sections.length && !summary && !current) {
        // Skip the top-level document title; handler will pass `title` separately.
        continue;
      }
      current = { heading };
      sections.push(current);
      continue;
    }

    // Table line
    if (isTableLine(trimmed)) {
      flushParagraph();
      flushBullets();
      const cells = parseMarkdownTableRow(trimmed);
      if (!inTable) {
        const next = (lines[i + 1] || "").trim();
        if (isTableLine(next) && isTableSeparator(next)) {
          inTable = true;
          tableHeaders = cells;
          i += 1; // skip separator row
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

    // Bullet list item
    const bulletMatch = trimmed.match(/^(?:[-*+]|\d+\.)\s+(.+)$/);
    if (bulletMatch) {
      flushParagraph();
      bulletBuffer.push(bulletMatch[1].trim());
      continue;
    } else if (bulletBuffer.length) {
      flushBullets();
    }

    // Callout / blockquote → párrafo normal (el template genérico no tiene callouts).
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
 * Heurística: a partir del markdown original decide si conviene incluir XLSX
 * y/o PPTX además de PDF+DOCX en los `requested_formats`.
 *
 * - XLSX: hay ≥1 tabla con ≥3 columnas y ≥5 filas de datos (señal fuerte de
 *   que el usuario querrá manipularla en Excel).
 * - PPTX: el documento se estructura como slides (headings "Slide N:", "Diapositiva N:",
 *   o ≥3 separadores horizontales `---` que particionan el doc).
 */
function detectExtraFormats(markdown: string, generic: GenericContent): KawiilOutputFormat[] {
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

async function handleCreateAiDocument(
  input: Record<string, unknown>,
  userId: string,
  orgId: string,
  aiProjectId: string | null,
  authHeader: string,
): Promise<string> {
  // Back-compat: si la IA sigue llamando con shape viejo (requested_kind + word_document / spreadsheet / presentation),
  // lo normalizamos a template_key + content antes de seguir.
  const legacyKind = typeof input?.requested_kind === "string" ? input.requested_kind : undefined;
  if (legacyKind && !input.template_key) {
    input.template_key = LEGACY_OFFICE_KIND_TO_TEMPLATE[legacyKind] || "generico";
    input.requested_formats = ["pdf", LEGACY_OFFICE_KIND_TO_FORMAT[legacyKind] || "docx"];
    // Convertir data legacy a `generico.sections`.
    const legacySections: Array<{ heading?: string; paragraphs?: string[]; tables?: unknown[] }> = [];
    if (input.word_document && typeof input.word_document === "object") {
      const wd = input.word_document as { sections?: Array<{ heading?: string; paragraphs?: string[]; tables?: Array<{ headers?: string[]; rows: string[][] }> }> };
      for (const s of wd.sections || []) legacySections.push(s);
    }
    if (input.spreadsheet && typeof input.spreadsheet === "object") {
      const sp = input.spreadsheet as { sheets?: Array<{ name?: string; rows?: Array<{ cells?: unknown[] }> }> };
      for (const sh of sp.sheets || []) {
        legacySections.push({
          heading: sh.name || "Hoja",
          tables: [{
            headers: [],
            rows: (sh.rows || []).map((r) => (r.cells || []).map((c) => String(c ?? ""))),
          }],
        });
      }
    }
    if (input.presentation && typeof input.presentation === "object") {
      const pr = input.presentation as { slides?: Array<{ title?: string; bullets?: string[]; notes?: string }> };
      for (const sl of pr.slides || []) {
        legacySections.push({ heading: sl.title || "Diapositiva", paragraphs: sl.bullets });
      }
    }
    input.content = { sections: legacySections.length ? legacySections : [{ heading: "Documento", paragraphs: ["Sin contenido."] }] };
  }

  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const templateKey = input?.template_key;
  const confidenceRaw = typeof input?.confidence === "number" ? input.confidence : 0.9;
  const reason = typeof input?.reason === "string" ? input.reason : "";
  const previewMarkdown = typeof input?.preview_markdown === "string" ? input.preview_markdown.trim() : "";

  if (!title) return JSON.stringify({ error: "title es obligatorio" });
  if (!isKawiilTemplateKey(templateKey)) {
    return JSON.stringify({ error: "template_key inválido. Opciones: " + KAWIIL_TEMPLATE_KEYS.join(", ") });
  }
  if (!input.content || typeof input.content !== "object") {
    return JSON.stringify({ error: "content (objeto con la estructura del template) es obligatorio" });
  }
  if (!Number.isFinite(confidenceRaw) || confidenceRaw < 0 || confidenceRaw > 1) {
    return JSON.stringify({ error: "confidence debe estar entre 0 y 1" });
  }
  if (confidenceRaw < 0.55) {
    return JSON.stringify({
      error: "confidence baja para generar documento; pide aclaración al usuario antes de crearlo.",
      code: "low_confidence",
      confidence: confidenceRaw,
    });
  }

  const rawFormats = Array.isArray(input.requested_formats) ? input.requested_formats : ["pdf"];
  const formats: KawiilOutputFormat[] = (rawFormats as string[])
    .filter((f): f is KawiilOutputFormat => (["pdf", "docx", "xlsx", "pptx"] as string[]).includes(f));
  let requestedFormats: KawiilOutputFormat[] = formats.length ? formats : ["pdf"];

  const primaryFmtRaw = typeof (input as Record<string, unknown>).primary_format === "string"
    ? (input as Record<string, unknown>).primary_format as string
    : "";
  const isValidPrimary = (f: string): f is KawiilOutputFormat =>
    (["pdf", "docx", "xlsx", "pptx"] as const).includes(f as KawiilOutputFormat);

  // Si el modelo envió primary_format pero olvidó incluirlo en la lista, lo añadimos.
  if (primaryFmtRaw && isValidPrimary(primaryFmtRaw) && !requestedFormats.includes(primaryFmtRaw)) {
    requestedFormats.unshift(primaryFmtRaw);
  }

  // PDF como lectura/archivo: si falta, se añade al final para no adelantar el formato
  // que el usuario pidió como primario (p. ej. Word → docx primero, pdf segundo).
  if (!requestedFormats.includes("pdf")) requestedFormats.push("pdf");

  if (primaryFmtRaw && isValidPrimary(primaryFmtRaw) && requestedFormats.includes(primaryFmtRaw)) {
    const pf = primaryFmtRaw as KawiilOutputFormat;
    requestedFormats = [pf, ...requestedFormats.filter((f) => f !== pf)];
  } else if (!primaryFmtRaw && requestedFormats.includes("docx") && requestedFormats.includes("pdf")) {
    // El modelo a menudo manda ["pdf","docx"] sin primary_format: priorizar Word
    // (orden típico pedido por usuarios para revisar/editar).
    const idxDocx = requestedFormats.indexOf("docx");
    const idxPdf = requestedFormats.indexOf("pdf");
    if (idxDocx > idxPdf) {
      requestedFormats = [
        "docx",
        "pdf",
        ...requestedFormats.filter((f) => f !== "pdf" && f !== "docx"),
      ];
    }
  }

  const renderPayload = {
    title,
    template_key: templateKey,
    requested_formats: requestedFormats,
    /** Tras normalizar orden (p. ej. Word antes que PDF), fijamos el primario explícito para render-ai-document. */
    primary_format: requestedFormats[0],
    content: input.content,
    confidence: confidenceRaw,
    reason,
    preview_markdown: previewMarkdown,
  };

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const renderResp = await fetch(`${supabaseUrl}/functions/v1/render-ai-document`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      apikey: anonKey,
    },
    body: JSON.stringify(renderPayload),
  });
  const renderJson = await renderResp.json().catch(() => null);
  if (!renderResp.ok || !renderJson?.success) {
    const reasonMsg = renderJson?.error || `render-ai-document error ${renderResp.status}`;
    return JSON.stringify({ error: reasonMsg, code: "document_render_failed" });
  }

  const renderedFormats: Array<{ format: KawiilOutputFormat; file_name: string; file_ext: string; mime_type: string; content_base64: string }>
    = Array.isArray(renderJson.formats) ? renderJson.formats : [];
  if (!renderedFormats.length) {
    return JSON.stringify({ error: "render-ai-document no devolvió archivos." });
  }

  const primaryFormat: KawiilOutputFormat = (renderJson.primary_format as KawiilOutputFormat) || renderedFormats[0].format;
  const artifactId = crypto.randomUUID();
  const safeTitle = title.replace(/[^\w\- ]+/g, "_").trim().replace(/\s+/g, "_").slice(0, 80) || "documento";
  const storageBucket = "documents";

  const svcUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(svcUrl, serviceKey);

  const outputFormats: Array<{ format: string; storage_bucket: string; storage_path: string; file_name: string; mime_type: string; is_primary: boolean }> = [];
  let primaryPath: string | null = null;
  let primaryMime: string | null = null;
  let primaryExt: string | null = null;

  for (const fmt of renderedFormats) {
    const fileBytes = base64ToUint8Array(fmt.content_base64);
    const storagePath = `ai-artifacts/${orgId}/${userId}/${artifactId}_${safeTitle}.${fmt.file_ext}`;
    const { error: uploadErr } = await svc.storage.from(storageBucket).upload(storagePath, fileBytes, {
      contentType: fmt.mime_type,
      upsert: false,
    });
    if (uploadErr) {
      console.error(`Kawiil doc upload error (${fmt.format}):`, uploadErr);
      return JSON.stringify({ error: uploadErr.message, code: "document_upload_failed" });
    }
    const isPrimary = fmt.format === primaryFormat;
    outputFormats.push({
      format: fmt.format,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      file_name: `${safeTitle}.${fmt.file_ext}`,
      mime_type: fmt.mime_type,
      is_primary: isPrimary,
    });
    if (isPrimary) {
      primaryPath = storagePath;
      primaryMime = fmt.mime_type;
      primaryExt = fmt.file_ext;
    }
  }

  const contentType = primaryFormat === "pdf" ? "pdf" : "office";
  const previewBody = typeof renderJson.preview_markdown === "string" && renderJson.preview_markdown.trim()
    ? renderJson.preview_markdown
    : previewMarkdown || `# ${title}\n\n_Documento generado con template **${templateKey}** (Kawiil AI)._`;

  const { error: insertErr } = await svc.from("ai_artifacts").insert({
    id: artifactId,
    ai_project_id: aiProjectId || null,
    user_id: userId,
    organization_id: orgId,
    title,
    content: previewBody,
    content_type: contentType,
    template_key: templateKey,
    template_data: input.content,
    output_formats: outputFormats,
    primary_format: primaryFormat,
    // Rellenamos los campos "legacy" para que UI vieja siga funcionando.
    office_kind: primaryFormat === "docx"
      ? "word_document"
      : primaryFormat === "xlsx"
      ? "spreadsheet"
      : primaryFormat === "pptx"
      ? "presentation"
      : null,
    file_ext: primaryExt,
    mime_type: primaryMime,
    storage_bucket: primaryPath ? storageBucket : null,
    storage_path: primaryPath,
  });
  if (insertErr) {
    console.error("AI document artifact insert error:", insertErr);
    return JSON.stringify({ error: insertErr.message, code: "document_artifact_insert_failed" });
  }

  return JSON.stringify({
    artifact_id: artifactId,
    title,
    content_type: contentType,
    template_key: templateKey,
    primary_format: primaryFormat,
    formats: outputFormats.map((o) => o.format),
    message: `Documento "${title}" (${templateKey}) generado en ${outputFormats.length} formato(s).`,
  });
}

function normalizeTeamMemoryPath(memPath: string): string {
  if (memPath.startsWith("/team/")) return memPath;
  if (memPath.startsWith("team/")) return `/${memPath}`;
  return `/team/${memPath.replace(/^\/+/, "")}`;
}

function isTeamMemoryPath(memPath: string | undefined): boolean {
  return !!memPath && (memPath.startsWith("/team") || memPath.startsWith("team/"));
}

// ─── Memory Tool handler (backed by Supabase) ───
async function handleMemoryToolCall(
  input: any, userId: string, orgId: string, aiProjectId: string | null,
): Promise<string> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(supabaseUrl, serviceKey);

  const { command, path: memPath, content, old_str, new_str, view_range } = input;

  switch (command) {
    case "view": {
      if (memPath === "/team" || memPath === "/team/") {
        if (!aiProjectId) return "No hay proyecto de IA activo para listar /team/.";
        const { data: teamFiles } = await svc.from("ai_project_shared_memories")
          .select("path, updated_at, content")
          .eq("ai_project_id", aiProjectId)
          .order("path");
        if (!teamFiles?.length) return "El directorio /team/ está vacío.";
        const listing = teamFiles.map((f) => {
          const sizeKB = (new TextEncoder().encode(f.content).length / 1024).toFixed(1);
          return `${sizeKB}K\t${f.path}`;
        }).join("\n");
        return `Archivos en /team/ (memoria compartida del proyecto):\n${listing}`;
      }

      if (!memPath || memPath === "/memories" || memPath === "/memories/") {
        let query = svc.from("ai_project_memories")
          .select("path, updated_at, content")
          .eq("user_id", userId)
          .eq("organization_id", orgId);
        if (aiProjectId) query = query.eq("ai_project_id", aiProjectId);
        else query = query.is("ai_project_id", null);
        const { data: files } = await query.order("path");

        let out = "";
        if (files?.length) {
          const listing = files.map((f) => {
            const sizeKB = (new TextEncoder().encode(f.content).length / 1024).toFixed(1);
            return `${sizeKB}K\t${f.path}`;
          }).join("\n");
          out = `Archivos en /memories/ (personales):\n${listing}`;
        } else {
          out = "/memories/ está vacío para este contexto.";
        }
        if (aiProjectId) {
          const { data: teamFiles } = await svc.from("ai_project_shared_memories")
            .select("path, updated_at, content")
            .eq("ai_project_id", aiProjectId)
            .order("path");
          if (teamFiles?.length) {
            const tl = teamFiles.map((f) => {
              const sizeKB = (new TextEncoder().encode(f.content).length / 1024).toFixed(1);
              return `${sizeKB}K\t${f.path}`;
            }).join("\n");
            out += `\n\nArchivos en /team/ (equipo):\n${tl}`;
          }
        }
        return out;
      }

      if (isTeamMemoryPath(memPath)) {
        if (!aiProjectId) return "Rutas /team/ requieren un proyecto de IA activo.";
        const tp = normalizeTeamMemoryPath(memPath);
        const { data: file } = await svc.from("ai_project_shared_memories")
          .select("content")
          .eq("ai_project_id", aiProjectId)
          .eq("path", tp)
          .maybeSingle();
        if (!file) return `The path ${tp} does not exist.`;
        let lines = file.content.split("\n");
        if (view_range && Array.isArray(view_range) && view_range.length === 2) {
          const [start, end] = view_range;
          lines = lines.slice(Math.max(0, start - 1), end);
        }
        const numbered = lines.map((l: string, i: number) => `${String(i + 1).padStart(6)} \t${l}`).join("\n");
        return truncateForToolResult(
          `Here's the content of ${tp} with line numbers:\n${numbered}`,
          MAX_MEMORY_VIEW_CHARS,
        );
      }

      let query = svc.from("ai_project_memories")
        .select("content")
        .eq("user_id", userId)
        .eq("path", memPath);
      if (aiProjectId) query = query.eq("ai_project_id", aiProjectId);
      else query = query.is("ai_project_id", null);
      const { data: file } = await query.single();

      if (!file) return `The path ${memPath} does not exist. Please provide a valid path.`;

      let lines = file.content.split("\n");
      if (view_range && Array.isArray(view_range) && view_range.length === 2) {
        const [start, end] = view_range;
        lines = lines.slice(Math.max(0, start - 1), end);
      }
      const numbered = lines.map((l: string, i: number) => `${String(i + 1).padStart(6)} \t${l}`).join("\n");
      return truncateForToolResult(
        `Here's the content of ${memPath} with line numbers:\n${numbered}`,
        MAX_MEMORY_VIEW_CHARS,
      );
    }

    case "create": {
      if (!memPath || !content) return "Error: path and content are required for create.";
      if (isTeamMemoryPath(memPath)) {
        if (!aiProjectId) return "Las rutas /team/ requieren proyecto de IA activo.";
        const tp = normalizeTeamMemoryPath(memPath);
        const { data: ap } = await svc.from("ai_projects").select("organization_id").eq("id", aiProjectId).single();
        if (!ap) return "Proyecto no encontrado.";
        const { data: existing } = await svc.from("ai_project_shared_memories")
          .select("id")
          .eq("ai_project_id", aiProjectId)
          .eq("path", tp)
          .maybeSingle();
        let rowId: string;
        if (existing) {
          await svc.from("ai_project_shared_memories")
            .update({ content, updated_at: new Date().toISOString(), updated_by: userId })
            .eq("id", existing.id);
          rowId = existing.id;
        } else {
          const { data: ins } = await svc.from("ai_project_shared_memories").insert({
            ai_project_id: aiProjectId,
            organization_id: ap.organization_id,
            path: tp,
            content,
            updated_by: userId,
          }).select("id").single();
          rowId = ins!.id;
        }
        await embedSharedMemory(svc, tp, content, ap.organization_id, aiProjectId, rowId);
        return `Successfully wrote team memory to ${tp} (${content.split("\n").length} lines)`;
      }

      const normalizedPath = memPath.startsWith("/memories/") ? memPath : `/memories/${memPath}`;
      const { data: existing } = await svc.from("ai_project_memories")
        .select("id")
        .eq("user_id", userId)
        .eq("path", normalizedPath)
        .maybeSingle();

      if (existing) {
        await svc.from("ai_project_memories")
          .update({ content, updated_at: new Date().toISOString() })
          .eq("id", existing.id);
      } else {
        await svc.from("ai_project_memories").insert({
          ai_project_id: aiProjectId || null,
          user_id: userId,
          organization_id: orgId,
          path: normalizedPath,
          content,
        });
      }

      await embedMemory(svc, normalizedPath, content, userId, orgId, aiProjectId);
      return `Successfully wrote to ${normalizedPath} (${content.split("\n").length} lines)`;
    }

    case "str_replace": {
      if (!memPath || !old_str || !new_str) return "Error: path, old_str, and new_str are required.";
      if (isTeamMemoryPath(memPath)) {
        if (!aiProjectId) return "Rutas /team/ requieren proyecto de IA activo.";
        const tp = normalizeTeamMemoryPath(memPath);
        const { data: file } = await svc.from("ai_project_shared_memories")
          .select("id, content")
          .eq("ai_project_id", aiProjectId)
          .eq("path", tp)
          .single();
        if (!file) return `The path ${tp} does not exist.`;
        if (!file.content.includes(old_str)) return `old_str not found in ${tp}.`;
        const updated = file.content.replace(old_str, new_str);
        await svc.from("ai_project_shared_memories")
          .update({ content: updated, updated_at: new Date().toISOString(), updated_by: userId })
          .eq("id", file.id);
        const { data: ap } = await svc.from("ai_projects").select("organization_id").eq("id", aiProjectId).single();
        if (ap) await embedSharedMemory(svc, tp, updated, ap.organization_id, aiProjectId, file.id);
        return `Successfully replaced text in ${tp}`;
      }

      let query = svc.from("ai_project_memories")
        .select("id, content")
        .eq("user_id", userId)
        .eq("path", memPath);
      if (aiProjectId) query = query.eq("ai_project_id", aiProjectId);
      else query = query.is("ai_project_id", null);
      const { data: file } = await query.single();

      if (!file) return `The path ${memPath} does not exist.`;
      if (!file.content.includes(old_str)) return `old_str not found in ${memPath}.`;

      const updated = file.content.replace(old_str, new_str);
      await svc.from("ai_project_memories")
        .update({ content: updated, updated_at: new Date().toISOString() })
        .eq("id", file.id);

      await embedMemory(svc, memPath, updated, userId, orgId, aiProjectId);
      return `Successfully replaced text in ${memPath}`;
    }

    case "insert": {
      if (!memPath || !content) return "Error: path and content are required for insert.";
      const insertLine = input.insert_line ?? 0;
      if (isTeamMemoryPath(memPath)) {
        if (!aiProjectId) return "Rutas /team/ requieren proyecto de IA activo.";
        const tp = normalizeTeamMemoryPath(memPath);
        const { data: file } = await svc.from("ai_project_shared_memories")
          .select("id, content")
          .eq("ai_project_id", aiProjectId)
          .eq("path", tp)
          .single();
        if (!file) return `The path ${tp} does not exist.`;
        const lines = file.content.split("\n");
        lines.splice(insertLine, 0, content);
        const updated = lines.join("\n");
        await svc.from("ai_project_shared_memories")
          .update({ content: updated, updated_at: new Date().toISOString(), updated_by: userId })
          .eq("id", file.id);
        const { data: ap } = await svc.from("ai_projects").select("organization_id").eq("id", aiProjectId).single();
        if (ap) await embedSharedMemory(svc, tp, updated, ap.organization_id, aiProjectId, file.id);
        return `Successfully inserted text at line ${insertLine} in ${tp}`;
      }

      let query = svc.from("ai_project_memories")
        .select("id, content")
        .eq("user_id", userId)
        .eq("path", memPath);
      if (aiProjectId) query = query.eq("ai_project_id", aiProjectId);
      else query = query.is("ai_project_id", null);
      const { data: file } = await query.single();

      if (!file) return `The path ${memPath} does not exist.`;
      const lines = file.content.split("\n");
      lines.splice(insertLine, 0, content);
      const updated = lines.join("\n");
      await svc.from("ai_project_memories")
        .update({ content: updated, updated_at: new Date().toISOString() })
        .eq("id", file.id);

      await embedMemory(svc, memPath, updated, userId, orgId, aiProjectId);
      return `Successfully inserted text at line ${insertLine} in ${memPath}`;
    }

    case "delete": {
      if (!memPath) return "Error: path is required for delete.";
      if (isTeamMemoryPath(memPath)) {
        if (!aiProjectId) return "Rutas /team/ requieren proyecto de IA activo.";
        const tp = normalizeTeamMemoryPath(memPath);
        const { data: file } = await svc.from("ai_project_shared_memories")
          .select("id")
          .eq("ai_project_id", aiProjectId)
          .eq("path", tp)
          .single();
        if (!file) return `The path ${tp} does not exist.`;
        await svc.from("ai_project_shared_memories").delete().eq("id", file.id);
        await svc.from("document_chunks")
          .delete()
          .eq("source_type", "shared_memory")
          .eq("source_id", file.id);
        return `Successfully deleted ${tp}`;
      }

      let query = svc.from("ai_project_memories")
        .select("id")
        .eq("user_id", userId)
        .eq("path", memPath);
      if (aiProjectId) query = query.eq("ai_project_id", aiProjectId);
      else query = query.is("ai_project_id", null);
      const { data: file } = await query.single();

      if (!file) return `The path ${memPath} does not exist.`;

      await svc.from("ai_project_memories").delete().eq("id", file.id);
      await svc.from("document_chunks")
        .delete()
        .eq("source_type", "memory")
        .eq("source_id", file.id);
      return `Successfully deleted ${memPath}`;
    }

    case "rename": {
      if (!memPath || !input.new_path) return "Error: path and new_path are required.";
      if (isTeamMemoryPath(memPath) || isTeamMemoryPath(input.new_path)) {
        if (!aiProjectId) return "Rutas /team/ requieren proyecto de IA activo.";
        const tp = normalizeTeamMemoryPath(memPath);
        const newNorm = normalizeTeamMemoryPath(input.new_path);
        const { data: file } = await svc.from("ai_project_shared_memories")
          .select("id")
          .eq("ai_project_id", aiProjectId)
          .eq("path", tp)
          .single();
        if (!file) return `The path ${tp} does not exist.`;
        await svc.from("ai_project_shared_memories")
          .update({ path: newNorm, updated_at: new Date().toISOString(), updated_by: userId })
          .eq("id", file.id);
        return `Successfully renamed ${tp} to ${newNorm}`;
      }

      const newNorm = input.new_path.startsWith("/memories/") ? input.new_path : `/memories/${input.new_path}`;
      let query = svc.from("ai_project_memories")
        .select("id")
        .eq("user_id", userId)
        .eq("path", memPath);
      if (aiProjectId) query = query.eq("ai_project_id", aiProjectId);
      else query = query.is("ai_project_id", null);
      const { data: file } = await query.single();

      if (!file) return `The path ${memPath} does not exist.`;
      await svc.from("ai_project_memories")
        .update({ path: newNorm, updated_at: new Date().toISOString() })
        .eq("id", file.id);
      return `Successfully renamed ${memPath} to ${newNorm}`;
    }

    default:
      return `Unknown memory command: ${command}`;
  }
}

async function embedMemory(
  svc: any, path: string, content: string,
  userId: string, orgId: string, aiProjectId: string | null,
): Promise<void> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey || content.length < 20) return;

  try {
    const { data: mem } = await svc.from("ai_project_memories")
      .select("id")
      .eq("user_id", userId)
      .eq("path", path)
      .single();
    if (!mem) return;

    // Delete old chunks for this memory
    await svc.from("document_chunks")
      .delete()
      .eq("source_type", "memory")
      .eq("source_id", mem.id);

    const textToEmbed = `[Memoria: ${path}] ${content}`;
    const embResp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: textToEmbed.replace(/\n+/g, " ").trim().substring(0, 8000), model: "text-embedding-3-small", dimensions: 1536 }),
    });

    if (!embResp.ok) return;
    const embData = await embResp.json();
    const embedding = embData.data[0].embedding;

    await svc.from("document_chunks").insert({
      organization_id: orgId,
      client_id: null,
      project_id: null,
      source_type: "memory",
      source_id: mem.id,
      content: textToEmbed.substring(0, 4000),
      metadata: { path, ai_project_id: aiProjectId, user_id: userId },
      embedding: JSON.stringify(embedding),
      token_count: Math.ceil(textToEmbed.length / 3.5),
    });
    console.log(`Embedded memory: ${path}`);
  } catch (e) {
    console.error("Memory embedding failed (non-blocking):", e);
  }
}

async function embedSharedMemory(
  svc: any, path: string, content: string,
  orgId: string, aiProjectId: string, rowId: string,
): Promise<void> {
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey || content.length < 20) return;

  try {
    await svc.from("document_chunks")
      .delete()
      .eq("source_type", "shared_memory")
      .eq("source_id", rowId);

    const textToEmbed = `[Memoria equipo: ${path}] ${content}`;
    const embResp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: textToEmbed.replace(/\n+/g, " ").trim().substring(0, 8000), model: "text-embedding-3-small", dimensions: 1536 }),
    });

    if (!embResp.ok) return;
    const embData = await embResp.json();
    const embedding = embData.data[0].embedding;

    await svc.from("document_chunks").insert({
      organization_id: orgId,
      client_id: null,
      project_id: null,
      source_type: "shared_memory",
      source_id: rowId,
      content: textToEmbed.substring(0, 4000),
      metadata: { path, ai_project_id: aiProjectId },
      embedding: JSON.stringify(embedding),
      token_count: Math.ceil(textToEmbed.length / 3.5),
    });
    console.log(`Embedded shared memory: ${path}`);
  } catch (e) {
    console.error("Shared memory embedding failed (non-blocking):", e);
  }
}

/** Acumula resultados de herramientas de mutación de tareas para un mensaje de respaldo si el modelo cierra en end_turn sin texto. */
type TaskMutationTally = { updateSingles: number; updateBatchOk: number; comments: number; errors: number };

function tallyTaskMutationTool(toolName: string, result: Record<string, unknown> | null | undefined, t: TaskMutationTally): void {
  if (toolName === "update_task") {
    if (result?.error) t.errors++;
    else if (result?.success === true) t.updateSingles++;
    return;
  }
  if (toolName === "update_tasks") {
    if (result?.error) {
      t.errors++;
      return;
    }
    const n = typeof result?.updated_count === "number" ? result.updated_count : 0;
    t.updateBatchOk += n;
    const rows = result?.results;
    if (Array.isArray(rows)) {
      for (const row of rows) {
        if (row && typeof row === "object" && "error" in row && (row as { error?: unknown }).error) t.errors++;
      }
    }
    return;
  }
  if (toolName === "add_task_comment") {
    if (result?.error) t.errors++;
    else if (result?.success === true) t.comments++;
  }
}

function buildTaskMutationFallbackMessage(t: TaskMutationTally): string {
  const taskEdits = t.updateSingles + t.updateBatchOk;
  const parts: string[] = [];
  if (taskEdits > 0) parts.push(`actualicé **${taskEdits}** tarea(s)`);
  if (t.comments > 0) parts.push(`añadí **${t.comments}** comentario(s) en el hilo`);
  let msg =
    "**Listo.** " +
    (parts.length ? parts.join(" y ") + ". " : "") +
    "Los cambios ya están guardados en Kawiil; en cada tarea verás el historial **vía Kawiil AI** cuando aplique.";
  if (t.errors > 0) {
    msg +=
      ` Hubo **${t.errors}** operación(es) con error (p. ej. ID incorrecto o regla de negocio); revisa esa tarea o dime cuál falló.`;
  }
  msg += "\n\nSi quieres otro ajuste, dímelo en una frase.";
  return msg;
}

// ─── Claude (Anthropic) handler ───
async function handleClaudeChat(
  apiKey: string, systemPrompt: string, userMessages: any[],
  supabase: any, userId: string, orgId: string, aiProjectId: string | null,
  sseWriter: LiveSseWriter,
  authHeader: string,
  conversationId: string | null,
): Promise<void> {
  let anthropicMsgs = pruneClaudeMessages(
    toAnthropicMessages(userMessages),
    MAX_CLAUDE_MESSAGES_ESTIMATED_TOKENS,
  );
  const MAX_ROUNDS = 8;
  const taskMutationTally: TaskMutationTally = { updateSingles: 0, updateBatchOk: 0, comments: 0, errors: 0 };
  const createdArtifacts: { id: string; title: string; content_type: string; office_kind?: string; template_key?: string; primary_format?: string }[] = [];

  // Build tools array: custom tools + memory tool (as custom tool definition for compatibility)
  const memoryToolDef = {
    name: "memory",
    description: "Memoria persistente: /memories/... (personal del usuario) y /team/... (compartida con el proyecto de IA, requiere proyecto activo). COMANDOS: view, create, str_replace, insert, delete, rename.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", enum: ["view", "create", "str_replace", "insert", "delete", "rename"], description: "Comando a ejecutar" },
        path: { type: "string", description: "Ruta: /memories/archivo.md (personal) o /team/archivo.md (equipo)" },
        content: { type: "string", description: "Contenido del archivo (para create/insert)" },
        old_str: { type: "string", description: "Texto a reemplazar (para str_replace)" },
        new_str: { type: "string", description: "Nuevo texto (para str_replace)" },
        new_path: { type: "string", description: "Nueva ruta (para rename)" },
        insert_line: { type: "number", description: "Numero de linea donde insertar (para insert)" },
        view_range: { type: "array", items: { type: "number" }, description: "Rango de lineas [inicio, fin] (para view)" },
      },
      required: ["command"],
    },
  };
  const allTools: any[] = [
    ...anthropicTools,
    memoryToolDef,
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const isLastChance = round === MAX_ROUNDS - 1;

    anthropicMsgs = pruneClaudeMessages(anthropicMsgs, MAX_CLAUDE_MESSAGES_ESTIMATED_TOKENS);

    sseWriter.writeProgress(
      "claude_round",
      round === 0
        ? "Consultando a Kawiil AI (Claude)…"
        : `Procesando pasos intermedios con Kawiil AI (${round + 1}/${MAX_ROUNDS})…`,
    );

    const resp = await anthropicMessagesFetch(apiKey, {
      model: "claude-sonnet-4-20250514",
      // 8192 da margen para respuestas largas (p. ej. documentos extensos vía
      // create_ai_document) sin que Claude termine con stop_reason="max_tokens"
      // y un bloque de texto vacío.
      max_tokens: 8192,
      system: systemPrompt,
      messages: anthropicMsgs,
      tools: isLastChance ? undefined : allTools,
      stream: false,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      if (resp.status === 429) {
        console.warn("Claude 429 tras reintentos en handleClaudeChat");
        throw new Error("RATE_LIMIT_429");
      }
      if (
        resp.status === 529 ||
        resp.status === 503 ||
        errText.includes("overloaded_error") ||
        anthropicErrorTypeFromBody(errText) === "overloaded_error"
      ) {
        console.warn("Claude overload tras reintentos:", errText.slice(0, 220));
        throw new Error("CLAUDE_OVERLOADED");
      }
      if (isAnthropicCreditBalanceLow(resp.status, errText)) {
        throw new Error(ANTHROPIC_BILLING_THROW);
      }
      if (resp.status === 400 && isAnthropicPromptTooLongMessage(errText)) {
        throw new Error("CLAUDE_CONTEXT_TOO_LONG");
      }
      throw new Error(`Claude error ${resp.status}: ${errText.substring(0, 1200)}`);
    }

    const data = await resp.json();
    const stopReason = data.stop_reason;
    const contentBlocks = data.content || [];

    const toolUseBlocks = contentBlocks.filter((b: any) => b.type === "tool_use");

    if (toolUseBlocks.length > 0 && isLastChance) {
      console.warn("Claude devolvió tool_use en la última ronda (sin herramientas en el request); no se pueden ejecutar.");
      sseWriter.fail(
        "**La IA intentó usar una herramienta en el último paso** y ya no hay ronda disponible. " +
          "Reintenta con una instrucción más corta o abre un chat nuevo.",
      );
      return;
    }

    // Ejecutar tool_use siempre que vengan bloques, aunque stop_reason sea "end_turn".
    // Anthropic a veces devuelve end_turn con tool_use en content; si exigíamos solo
    // stop_reason==="tool_use", las herramientas no corrían y el usuario veía "sin texto".
    if (toolUseBlocks.length > 0) {
      anthropicMsgs.push({ role: "assistant", content: clampToolUseInputsInAssistantBlocks(contentBlocks) });

      const toolResults: any[] = [];
      for (const tu of toolUseBlocks) {
        let result: any;

        if (tu.name === "memory") {
          console.log(`Memory Tool: ${tu.input?.command} ${tu.input?.path || ""}`);
          sseWriter.writeProgress(
            "tool",
            `Memoria persistente: ${tu.input?.command || "acción"}${tu.input?.path ? ` ${tu.input.path}` : ""}`,
          );
          const memResult = await handleMemoryToolCall(tu.input || {}, userId, orgId, aiProjectId);
          result = memResult;
        } else if (tu.name === "create_artifact") {
          // Auto-upgrade: toda llamada a create_artifact se re-rutea al pipeline Kawiil
          // (render-ai-document con template `generico`), de forma que el artifact
          // resultante siempre salga con diseño profesional (PDF + DOCX) en vez de
          // markdown plano. Si la conversión falla, hacemos fallback al handler legacy
          // para no romper la conversación.
          const inputTitle = typeof tu.input?.title === "string" ? tu.input.title : "Documento";
          const mdContent = typeof tu.input?.content === "string" ? tu.input.content : "";
          const rawContentType = typeof tu.input?.content_type === "string" ? tu.input.content_type : "markdown";
          console.log(`Artifact Tool (auto-upgrade → create_ai_document): ${inputTitle}`);
          sseWriter.writeProgress(
            "tool",
            `Generando documento: ${inputTitle} (Word + PDF con diseño Kawiil)…`,
          );
          // Solo tiene sentido auto-upgrade para markdown/html/csv (texto). Para `code`
          // mantenemos el comportamiento legacy (artifact de código plano).
          const canUpgrade = rawContentType === "markdown" || rawContentType === "html" || rawContentType === "csv";
          if (canUpgrade && mdContent.trim()) {
            const genericContent = markdownToGenericContent(mdContent, inputTitle);
            // Siempre PDF+DOCX como mínimo. Añadimos XLSX/PPTX solo si la heurística
            // lo justifica (tablas grandes o estructura de slides): eso evita generar
            // ppts/xls vacíos y ahorra tiempo de render.
            const extraFormats = detectExtraFormats(mdContent, genericContent);
            // Word primero + PDF (lectura/archivo): el usuario suele querer editar; el PDF
            // queda como segundo formato. primary_format docx alinea UI y descargas.
            const requestedFormats: KawiilOutputFormat[] = [
              "docx",
              "pdf",
              ...extraFormats.filter((f) => f !== "pdf" && f !== "docx"),
            ];

            // 2 reintentos del render completo antes de degradar a markdown plano.
            // Razón: `render-ai-document` ocasionalmente falla por cold-start de la
            // edge, timeouts de red o glitches puntuales del runtime Deno; un retry
            // corto evita bajar artefactos perfectamente válidos a solo-markdown.
            const MAX_ATTEMPTS = 2;
            let upgradeResult: { ok: boolean; payload: string; error?: string } = {
              ok: false,
              payload: "",
            };
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
              try {
                const attemptResult = await handleCreateAiDocument(
                  {
                    title: inputTitle,
                    template_key: "generico",
                    requested_formats: requestedFormats,
                    primary_format: "docx",
                    content: genericContent as unknown as Record<string, unknown>,
                    confidence: 0.9,
                    reason: "Auto-upgrade de create_artifact → pipeline Kawiil",
                    preview_markdown: mdContent,
                  },
                  userId,
                  orgId,
                  aiProjectId,
                  authHeader,
                );
                const parsed = JSON.parse(attemptResult) as {
                  artifact_id?: string;
                  error?: string;
                };
                if (parsed.artifact_id) {
                  upgradeResult = { ok: true, payload: attemptResult };
                  break;
                }
                upgradeResult = { ok: false, payload: attemptResult, error: parsed.error || "unknown_error" };
                console.warn(
                  `Auto-upgrade create_artifact intento ${attempt}/${MAX_ATTEMPTS} falló:`,
                  parsed.error,
                );
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                upgradeResult = { ok: false, payload: "", error: msg };
                console.error(
                  `Auto-upgrade create_artifact intento ${attempt}/${MAX_ATTEMPTS} threw:`,
                  msg,
                );
              }
              if (attempt < MAX_ATTEMPTS) {
                // Backoff exponencial corto: 350ms, 700ms…
                await new Promise((r) => setTimeout(r, 350 * attempt));
              }
            }

            if (upgradeResult.ok) {
              result = upgradeResult.payload;
              try {
                const parsed = JSON.parse(result);
                if (parsed.artifact_id) {
                  createdArtifacts.push({
                    id: parsed.artifact_id,
                    title: parsed.title,
                    content_type: parsed.content_type || "pdf",
                    template_key: parsed.template_key,
                    primary_format: parsed.primary_format,
                  });
                }
              } catch {
                /* ignore parse issues */
              }
            } else {
              // Todos los reintentos fallaron: guardamos markdown marcado como
              // `render_status='pending'` para que el reconciliador vuelva a intentar
              // el render y el UI pueda mostrar el estado.
              const errSummary = String(upgradeResult.error || "error desconocido").slice(0, 180);
              console.warn(
                "Auto-upgrade create_artifact: todos los reintentos fallaron, guardando como markdown pending:",
                errSummary,
              );
              sseWriter.writeProgress(
                "warning",
                `Generación PDF/DOCX falló tras ${MAX_ATTEMPTS} intentos (${errSummary}). Se guardó como markdown; reintentando en segundo plano.`,
              );
              result = await handleCreateArtifact(
                tu.input || {},
                userId,
                orgId,
                aiProjectId,
                { renderStatus: "pending", renderError: errSummary },
              );
              try {
                const legacyParsed = JSON.parse(result);
                if (legacyParsed.artifact_id) {
                  createdArtifacts.push({
                    id: legacyParsed.artifact_id,
                    title: legacyParsed.title,
                    content_type: legacyParsed.content_type || "markdown",
                  });
                }
              } catch {
                /* ignore parse issues */
              }
            }
          } else {
            // content_type === "code" o contenido vacío: comportamiento legacy.
            result = await handleCreateArtifact(tu.input || {}, userId, orgId, aiProjectId);
            try {
              const parsed = JSON.parse(result);
              if (parsed.artifact_id) {
                createdArtifacts.push({ id: parsed.artifact_id, title: parsed.title, content_type: parsed.content_type || "markdown" });
              }
            } catch {}
          }
        } else if (tu.name === "create_ai_document" || tu.name === "create_office_document") {
          // create_office_document se acepta por back-compat; handleCreateAiDocument lo normaliza.
          console.log(`AI Document Tool: ${tu.input?.title} (template=${tu.input?.template_key || "legacy:" + tu.input?.requested_kind})`);
          sseWriter.writeProgress(
            "tool",
            `Generando documento: ${typeof tu.input?.title === "string" ? tu.input.title : "sin título"} (puede tardar unos segundos)…`,
          );
          result = await handleCreateAiDocument(tu.input || {}, userId, orgId, aiProjectId, authHeader);
          try {
            const parsed = JSON.parse(result);
            if (parsed.artifact_id) {
              createdArtifacts.push({
                id: parsed.artifact_id,
                title: parsed.title,
                content_type: parsed.content_type || "pdf",
                template_key: parsed.template_key,
                primary_format: parsed.primary_format,
              });
            }
          } catch {
            /* ignore parse issues */
          }
        } else {
          console.log(`Tool [Claude]: ${tu.name}`, tu.input);
          sseWriter.writeProgress("tool", `Ejecutando herramienta: ${tu.name}…`);
          result = await executeTool(tu.name, tu.input || {}, supabase, userId, orgId, conversationId);
          if (result && typeof result === "object" && !Array.isArray(result)) {
            tallyTaskMutationTool(tu.name, result as Record<string, unknown>, taskMutationTally);
          }
        }

        const rawToolStr = typeof result === "string" ? result : JSON.stringify(result);
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: truncateForToolResult(rawToolStr, MAX_TOOL_RESULT_CHARS),
        });
      }
      anthropicMsgs.push({ role: "user", content: toolResults });
      continue;
    }

    let textContent = contentBlocks
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");

    // El modelo a veces escribe bloques [artifact:uuid|...] con UUIDs inventados (cualquier
    // variante de segmentos tras el id). El usuario hace clic y el id no existe en DB.
    // Solo nosotros añadimos marcadores válidos al final (desde createdArtifacts).
    textContent = textContent.replace(/\s*\[artifact:[a-f0-9-]{36}\|[^\]]*\]\s*/gi, "\n");
    textContent = textContent.replace(/\n{3,}/g, "\n\n").trim();

    if (createdArtifacts.length > 0) {
      // Los marcadores usan `|` como separador y `]` como cierre; si el título los
      // contiene el regex del cliente puede extraer campos incorrectos o cortar el
      // título. Los reemplazamos por equivalentes visuales para no romper el parseo.
      const sanitizeMarkerField = (s: string) =>
        String(s ?? "")
          .replace(/\|/g, "/")
          .replace(/\]/g, ")")
          .replace(/\[/g, "(")
          .replace(/\s+/g, " ")
          .trim();
      const markers = createdArtifacts.map((a) => {
        const safeTitle = sanitizeMarkerField(a.title);
        // Siempre preferir marcador kawiil cuando hay template (fallback de primary por si el parseo vino incompleto).
        if (a.template_key) {
          const pf = (a.primary_format || "pdf") as string;
          return `[artifact:${a.id}|${safeTitle}|kawiil:${a.template_key}:${pf}]`;
        }
        return `[artifact:${a.id}|${safeTitle}|${a.office_kind ? `office:${a.office_kind}` : a.content_type}]`;
      }).join("\n");
      textContent = textContent + "\n\n" + markers;
    }

    // Salvavidas: si Claude termina la ronda sin texto y sin artefactos, NO cerrar el
    // stream en silencio (eso hacía que el cliente mostrara "No se recibió respuesta
    // del modelo" sin más contexto). Emitimos un mensaje claro según stop_reason.
    if (!textContent.trim()) {
      console.warn(
        `Claude round cerró sin texto. stop_reason=${stopReason} blocks=${contentBlocks.length} artifacts=${createdArtifacts.length}`,
      );
      if (stopReason === "max_tokens") {
        sseWriter.fail(
          "**La respuesta se cortó por tamaño (max_tokens).** " +
            "Suele ocurrir cuando el documento o la explicación solicitada es muy grande. " +
            "Prueba a dividir la tarea en pasos más chicos, pedir solo la sección que necesitas, " +
            "o reintentar en un chat nuevo con menos historial.",
        );
      } else if (stopReason === "refusal") {
        sseWriter.fail(
          "**La IA rechazó la solicitud por sus políticas.** Reformula el pedido o proporciona más contexto.",
        );
      } else {
        const mutationSuccesses =
          taskMutationTally.updateSingles + taskMutationTally.updateBatchOk + taskMutationTally.comments;
        // Tras varias rondas de tools, la última llamada (sin tools) a veces devuelve end_turn sin texto;
        // si ya aplicamos cambios en tareas, respondemos con un resumen en lugar de error genérico.
        if (mutationSuccesses > 0 && stopReason === "end_turn") {
          console.warn(
            "Claude end_turn sin texto tras mutaciones de tareas; emitiendo resumen de respaldo.",
          );
          sseWriter.writeProgress("response", "Resumen de lo ejecutado…");
          sseWriter.writeTextChunks(buildTaskMutationFallbackMessage(taskMutationTally));
          sseWriter.close();
          return;
        }
        if (mutationSuccesses === 0 && taskMutationTally.errors > 0 && stopReason === "end_turn") {
          sseWriter.fail(
            "**No se pudieron aplicar los cambios en las tareas** (revisa los errores en el historial o los IDs). " +
              "Reintenta con menos tareas a la vez o confirma los UUID en el tablero.",
          );
          return;
        }
        sseWriter.fail(
          `**La IA no devolvió texto en esta respuesta** (stop_reason: ${stopReason ?? "desconocido"}). ` +
            "Puede ser un fallo temporal del proveedor o que el mensaje excedió el contexto. " +
            "Reintenta en unos segundos o inicia un chat nuevo si el historial es muy largo.",
        );
      }
      return;
    }

    if (stopReason === "max_tokens") {
      console.warn(
        `[ai-chat] Respuesta truncada por max_tokens con texto parcial (${textContent.length} chars)`,
      );
      textContent +=
        "\n\n---\n\n**Nota:** Esta respuesta se cortó al alcanzar el límite de salida del modelo en un solo turno. " +
        "Puedes pedir la **continuación** en un mensaje corto, dividir la tarea (p. ej. solo el hallazgo o solo el anexo), " +
        "o abrir un chat nuevo si el historial es muy largo.";
    }

    sseWriter.writeProgress("response", "Generando la respuesta final…");
    sseWriter.writeTextChunks(textContent);
    sseWriter.close();
    return;
  }

  // Se agotaron los rounds sin texto final: responde algo legible.
  sseWriter.fail(
    "La IA usó demasiadas herramientas sin cerrar la respuesta. Prueba con una instrucción más directa o reintenta.",
  );
}

// ─── SSE "en vivo": mantiene viva la conexión con heartbeats mientras se procesa ───
// Supabase Edge Runtime corta la request si no hay actividad en el socket durante 150 s
// ("Request idle timeout limit (150s) reached"). Si el trabajo (rounds de Claude,
// tool calls, render-ai-document, etc.) tarda más que eso sin escribir nada al cliente,
// la respuesta se aborta. Por eso abrimos el stream inmediatamente y emitimos:
//   - kawiil_progress en tiempo real a medida que avanza el pipeline.
//   - Comentarios SSE `: keepalive ...\n\n` cada HEARTBEAT_INTERVAL_MS (el cliente
//     ignora líneas que empiezan con ":", ver useChat.ts).
const SSE_HEARTBEAT_INTERVAL_MS = 20_000;

interface LiveSseWriter {
  response: Response;
  writeProgress: (phase: string, message: string) => void;
  writeTextChunks: (text: string) => void;
  close: () => void;
  /** Escribe un mensaje como texto del asistente y cierra. Usar cuando falla el pipeline
   *  después de abrir el stream (ya no podemos emitir un HTTP status distinto). */
  fail: (message: string) => void;
  isClosed: () => boolean;
}

function openLiveSseStream(
  preamble: Array<{ phase: string; message: string }>,
): LiveSseWriter {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const writeRaw = (data: string) => {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(data));
    } catch {
      closed = true;
      stopHeartbeat();
    }
  };

  const stopHeartbeat = () => {
    if (heartbeat != null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const writeProgress = (phase: string, message: string) => {
    writeRaw(`data: ${JSON.stringify({ type: "kawiil_progress", phase, message })}\n\n`);
  };

  const writeTextChunks = (text: string) => {
    if (!text) return;
    const chunkSize = 24;
    for (let i = 0; i < text.length; i += chunkSize) {
      const chunk = text.slice(i, i + chunkSize);
      writeRaw(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`);
    }
  };

  const close = () => {
    if (closed) return;
    writeRaw("data: [DONE]\n\n");
    stopHeartbeat();
    try {
      controller?.close();
    } catch {
      /* ignore */
    }
    closed = true;
  };

  const fail = (message: string) => {
    if (closed) return;
    writeProgress("error", message.slice(0, 200));
    writeTextChunks(message);
    close();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
      for (const p of preamble) {
        writeProgress(p.phase, p.message);
      }
      // Heartbeat: mantiene viva la conexión mientras procesa el pipeline.
      heartbeat = setInterval(() => {
        writeRaw(`: keepalive ${Date.now()}\n\n`);
      }, SSE_HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      closed = true;
      stopHeartbeat();
    },
  });

  return {
    response: new Response(stream, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        // Por si algún proxy intenta bufferear: desactivamos el buffering.
        "X-Accel-Buffering": "no",
      },
    }),
    writeProgress,
    writeTextChunks,
    close,
    fail,
    isClosed: () => closed,
  };
}
