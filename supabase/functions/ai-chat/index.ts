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
const ANTHROPIC_429_MAX_ATTEMPTS = 7;

function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** POST a /v1/messages con reintentos si Anthropic responde 429 (rate limit). */
async function anthropicMessagesFetch(apiKey: string, body: Record<string, unknown>): Promise<Response> {
  let lastResp: Response | undefined;
  for (let attempt = 0; attempt < ANTHROPIC_429_MAX_ATTEMPTS; attempt++) {
    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    lastResp = resp;
    if (resp.ok) return resp;
    if (resp.status !== 429) return resp;

    const errText = await resp.text();
    if (attempt >= ANTHROPIC_429_MAX_ATTEMPTS - 1) {
      console.warn("Anthropic 429 tras reintentos:", errText.slice(0, 240));
      return new Response(errText, {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    }

    let waitMs = Math.min(90_000, 3000 * 2 ** attempt);
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
    console.warn(`Anthropic 429, reintento ${attempt + 2}/${ANTHROPIC_429_MAX_ATTEMPTS} en ${waitMs}ms`);
    await sleepMs(waitMs);
  }
  return lastResp!;
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
/** Imágenes mayores: no multimodal base64 en Edge. */
const IMAGE_MULTIMODAL_MAX_BYTES = 2 * 1024 * 1024;
/** Excel: por encima se rechaza antes de XLSX.read (evita OOM). */
const XLSX_PROCESS_MAX_BYTES = 18 * 1024 * 1024;
const XLSX_LARGE_FILE_BYTES = 6 * 1024 * 1024;
const XLSX_HUGE_FILE_BYTES = 10 * 1024 * 1024;

/** Presupuesto de caracteres en `messages` (texto). PDF nativo base64 contaba aparte y podía superar 200k tokens con archivos <1MB. */
const MAX_CLAUDE_CONVERSATION_PAYLOAD_CHARS = 200_000;
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

/** Estima tamaño aproximado del contenido de un mensaje Anthropic (texto, imágenes, documentos base64, tool blocks). */
function estimateContentSize(content: unknown): number {
  if (content === null || content === undefined) return 0;
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return String(content).length;
  let n = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") n += b.text.length;
    if (b.type === "tool_result" && typeof b.content === "string") n += b.content.length;
    if (b.type === "tool_use") n += JSON.stringify(b).length;
    if (b.type === "image" && (b.source as any)?.data) n += String((b.source as any).data).length;
    if (b.type === "document" && (b.source as any)?.data) n += String((b.source as any).data).length;
  }
  return n;
}

function estimateMessagesChars(msgs: { role: string; content: unknown }[]): number {
  return msgs.reduce((acc, m) => acc + estimateContentSize(m.content), 0);
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
 * hasta quedar bajo el presupuesto, sin dejar tool_result huérfanos.
 */
function pruneClaudeMessages(msgs: any[], maxChars: number): any[] {
  if (msgs.length === 0) return msgs;
  const working = [...msgs];
  let guard = 0;
  while (working.length > 1 && estimateMessagesChars(working) > maxChars && guard < 400) {
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
  while (estimateMessagesChars(working) > maxChars && working.length >= 3) {
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
    estimateMessagesChars(working) > maxChars &&
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
  if (estimateMessagesChars(working) > maxChars && working.length === 1 && working[0].role === "user") {
    const c = working[0].content;
    if (typeof c === "string") {
      working[0] = { ...working[0], content: truncateText(c, Math.min(maxChars - 500, 120_000)) };
    }
  }
  return working;
}

function isAnthropicPromptTooLongMessage(errText: string): boolean {
  const t = errText.toLowerCase();
  return t.includes("prompt is too long") || t.includes("too many tokens") || t.includes("context length");
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
    description: "Búsqueda unificada por texto libre en tareas, clientes y proyectos. Devuelve resultados con tipo, id, nombre y URL.",
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
    description: "Crea un documento/artifact estructurado (manual, reporte, análisis, matriz, guía, plantilla). USA ESTA HERRAMIENTA cuando el usuario pida generar un documento largo, manual, reporte o cualquier contenido que merezca su propia vista. El artifact aparecerá en un panel lateral para que el usuario lo vea, copie o descargue.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título del documento" },
        content: {
          type: "string",
          description:
            "Contenido en Markdown del documento. Prioriza secciones con títulos ## y párrafos explicativos; evita listas largas salvo checklists o documentos explícitamente tabulares.",
        },
        content_type: { type: "string", enum: ["markdown", "code", "html", "csv"], description: "Tipo de contenido (default: markdown)" },
      },
      required: ["title", "content"],
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
];

// ─── Tool executor ───
async function executeTool(
  name: string,
  args: Record<string, any>,
  supabase: any,
  userId: string,
  orgId: string,
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
        .select("title, description, due_date, due_time, is_completed")
        .eq("user_id", userId);
      if (!args.include_completed) q = q.eq("is_completed", false);
      q = q.order("due_date", { ascending: true, nullsFirst: false });
      const { data, error } = await q;
      return error ? { error: error.message } : data;
    }
    case "create_reminder": {
      const { data, error } = await supabase.from("reminders").insert({
        user_id: userId, organization_id: orgId,
        title: args.title, description: args.description || null,
        due_date: args.due_date || null, due_time: args.due_time || null,
      }).select("id, title, due_date").single();
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

**Artifacts:** el contenido largo va en create_artifact; en el chat solo **párrafos** de resumen (qué es y para qué sirve).

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
- Si semantic_search no encuentra suficiente info, complementa con search_past_conversations (búsqueda exacta en conversaciones) y search_across (búsqueda en tareas/clientes/proyectos).
- Tras semantic_search, **sintetiza en párrafos** lo relevante para la pregunta; no devuelvas al usuario un inventario de fragmentos o documentos salvo que pida un índice o un listado explícito.
- Al responder, SIEMPRE cruza la información de múltiples fuentes: conocimiento base + memorias + comentarios + descripción + actividad.
- Si el usuario pregunta sobre una persona, consulta sus tareas Y la actividad reciente para dar un panorama completo.
- Si pregunta sobre un cliente, consulta sus proyectos, tareas, documentos extraídos Y memorias guardadas.
- Si encuentras información de la base de conocimiento o memorias, cítala: "Según mis notas..." o "En un análisis anterior guardé que..."
- **GUARDA en memoria** todo insight valioso: conclusiones de análisis, datos clave de clientes, estrategias discutidas, decisiones tomadas. Esto construye conocimiento real que perdura entre conversaciones.

### 5. Generación de documentos (Artifacts)
- Cuando el usuario pida generar un **documento largo** (manual, reporte, análisis, matriz, guía, plantilla, procedimiento), USA la herramienta **create_artifact** en lugar de poner el contenido directamente en el chat.
- Los artifacts aparecen en un panel lateral donde el usuario puede verlos completos, copiarlos o descargarlos.
- Usa create_artifact cuando el contenido generado supere ~500 palabras o sea un documento formal/estructurado.
- El artifact debe estar completo y bien formateado en Markdown.
- Después de crear un artifact, incluye un breve resumen en el chat de lo que generaste y por qué.

### 5b. Creación de proyectos y tareas
- **USA create_project** cuando el usuario pida crear un proyecto nuevo, ya sea directamente ("crea un proyecto de..."), analizando una minuta de reunión, o cuando del contexto se deduzca que hay que crear un nuevo proyecto. Puedes incluir fases y tareas directamente en la herramienta.
- **USA create_tasks** cuando el usuario pida crear tareas, ya sea a partir de instrucciones directas, una minuta, un análisis, o fases de un proyecto. Puedes crear múltiples tareas de una vez.
- **USA suggest_template** para buscar plantillas relevantes cuando el usuario quiera crear un proyecto similar a uno anterior.
- Cuando el usuario comparta una minuta o notas de reunión, analiza el contenido y propón la creación del proyecto y tareas correspondientes. Confirma con el usuario antes de crearlos, a menos que el usuario diga explícitamente "crea las tareas".
- Al crear proyectos, intenta identificar el cliente y área correctos basándote en el contexto.
- Al crear tareas, asigna prioridades inteligentemente según la urgencia y la naturaleza de la tarea.
- **IMPORTANTE:** Cuando crees un proyecto exitosamente, SIEMPRE incluye en tu respuesta el marcador [project:UUID_DEL_PROYECTO|NOMBRE_DEL_PROYECTO|AREA] para que aparezca una tarjeta visual del proyecto en el chat. Ejemplo: [project:abc-123|Contabilidad Grupo Dazon|contabilidad]

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
    } = body;

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

    let systemPrompt = simple && insightLite
      ? LITE_SYSTEM_PROMPT
      : buildSystemPrompt(profile) + projectContext;

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
      const results = await executeTool("search_across", { query: searchQuery }, supabase, user.id, orgId);

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
        MAX_CLAUDE_CONVERSATION_PAYLOAD_CHARS,
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
    try {
      return await handleClaudeChat(
        ANTHROPIC_API_KEY,
        systemPrompt,
        forClaude,
        supabase,
        user.id,
        orgId!,
        ai_project_id || null,
        sseProgressPreamble,
      );
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      console.warn("Claude chat failed:", errMsg);
      if (errMsg.includes("RATE_LIMIT_429")) {
        const msg = "Demasiadas solicitudes. Intenta de nuevo en unos segundos.";
        return new Response(
          JSON.stringify({
            error: msg,
            message: msg,
            retry_after: 20,
          }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
      if (errMsg.includes(ANTHROPIC_BILLING_THROW) || textLooksLikeAnthropicBilling(errMsg)) {
        return responseAnthropicBilling();
      }
      if (
        errMsg.includes("CLAUDE_CONTEXT_TOO_LONG") ||
        errMsg.toLowerCase().includes("prompt is too long")
      ) {
        const msg =
          "La conversación o los datos adjuntos superan el límite de contexto del modelo (200k tokens). " +
          "Inicia un chat nuevo, acorta el historial o evita varios PDFs enormes en el mismo hilo. " +
          "Los PDFs grandes pueden consultarse por búsqueda semántica tras indexarlos sin cargar todo el texto en cada mensaje.";
        return new Response(
          JSON.stringify({ error: msg, message: msg, code: "context_too_long" }),
          { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: errMsg }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (e) {
    console.error("ai-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Error desconocido" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Artifact Tool handler ───
async function handleCreateArtifact(
  input: any, userId: string, orgId: string, aiProjectId: string | null,
): Promise<string> {
  const svcUrlA = Deno.env.get("SUPABASE_URL")!;
  const serviceKeyA = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const svc = createClient(svcUrlA, serviceKeyA);

  const { title, content, content_type } = input;
  if (!title || !content) return JSON.stringify({ error: "title and content are required" });

  const { data: artifact, error } = await svc.from("ai_artifacts").insert({
    ai_project_id: aiProjectId || null,
    user_id: userId,
    organization_id: orgId,
    title,
    content,
    content_type: content_type || "markdown",
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
          metadata: { title, ai_project_id: aiProjectId, content_type: content_type || "markdown" },
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
    content_type: content_type || "markdown",
    message: `Artifact "${title}" creado exitosamente.`,
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

// ─── Claude (Anthropic) handler ───
async function handleClaudeChat(
  apiKey: string, systemPrompt: string, userMessages: any[],
  supabase: any, userId: string, orgId: string, aiProjectId: string | null,
  progressPreamble: Array<{ phase: string; message: string }>,
): Promise<Response> {
  let anthropicMsgs = pruneClaudeMessages(
    toAnthropicMessages(userMessages),
    MAX_CLAUDE_CONVERSATION_PAYLOAD_CHARS,
  );
  const MAX_ROUNDS = 8;
  const createdArtifacts: { id: string; title: string; content_type: string }[] = [];

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

    anthropicMsgs = pruneClaudeMessages(anthropicMsgs, MAX_CLAUDE_CONVERSATION_PAYLOAD_CHARS);

    const resp = await anthropicMessagesFetch(apiKey, {
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
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
      if (isAnthropicCreditBalanceLow(resp.status, errText)) {
        throw new Error(ANTHROPIC_BILLING_THROW);
      }
      if (resp.status === 400 && isAnthropicPromptTooLongMessage(errText)) {
        throw new Error("CLAUDE_CONTEXT_TOO_LONG");
      }
      throw new Error(`Claude error ${resp.status}: ${errText.substring(0, 300)}`);
    }

    const data = await resp.json();
    const stopReason = data.stop_reason;
    const contentBlocks = data.content || [];

    const toolUseBlocks = contentBlocks.filter((b: any) => b.type === "tool_use");

    if (toolUseBlocks.length > 0 && stopReason === "tool_use") {
      anthropicMsgs.push({ role: "assistant", content: contentBlocks });

      const toolResults: any[] = [];
      for (const tu of toolUseBlocks) {
        let result: any;

        if (tu.name === "memory") {
          console.log(`Memory Tool: ${tu.input?.command} ${tu.input?.path || ""}`);
          const memResult = await handleMemoryToolCall(tu.input || {}, userId, orgId, aiProjectId);
          result = memResult;
        } else if (tu.name === "create_artifact") {
          console.log(`Artifact Tool: ${tu.input?.title}`);
          result = await handleCreateArtifact(tu.input || {}, userId, orgId, aiProjectId);
          try {
            const parsed = JSON.parse(result);
            if (parsed.artifact_id) {
              createdArtifacts.push({ id: parsed.artifact_id, title: parsed.title, content_type: parsed.content_type || "markdown" });
            }
          } catch {}
        } else {
          console.log(`Tool [Claude]: ${tu.name}`, tu.input);
          result = await executeTool(tu.name, tu.input || {}, supabase, userId, orgId);
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

    if (createdArtifacts.length > 0) {
      const markers = createdArtifacts.map(
        (a) => `[artifact:${a.id}|${a.title}|${a.content_type}]`
      ).join("\n");
      textContent = textContent + "\n\n" + markers;
    }

    return streamProgressAndText(progressPreamble, textContent);
  }

  return new Response(JSON.stringify({ error: "Demasiadas consultas internas" }), {
    status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ─── SSE: pasos de progreso (cliente) + texto tipo OpenAI ───
function streamProgressAndText(
  preamble: Array<{ phase: string; message: string }>,
  text: string,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const p of preamble) {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: "kawiil_progress", phase: p.phase, message: p.message })}\n\n`,
          ),
        );
      }
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: "kawiil_progress",
            phase: "response",
            message: "Generando la respuesta final…",
          })}\n\n`,
        ),
      );
      const chunkSize = 24;
      for (let i = 0; i < text.length; i += chunkSize) {
        const chunk = text.slice(i, i + chunkSize);
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: chunk } }] })}\n\n`),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
  });
}
