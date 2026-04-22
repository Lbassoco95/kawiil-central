/**
 * Normaliza `agent_tasks.result` (Json) y `result_summary` para el chat.
 * `result_summary` suele ser un resumen corto; el texto completo va en `result` (string o JSON con claves tipo text/markdown)
 * o a veces en `execution_metadata` (p. ej. salida de la VM kawiil-agents).
 */

const TEXT_KEYS = [
  "markdown",
  "final_report",
  "full_text",
  "report_text",
  "plain_text",
  "text",
  "content",
  "output",
  "report",
  "analysis",
  "answer",
  "message",
  "response",
  "body",
  "revised",
  "summary",
  "user_visible",
  "display_text",
  "llm_output",
  "completion",
] as const;

const NESTED_KEYS = ["data", "result", "payload", "output", "response", "details", "task_result"] as const;

/** Más capas: algunas VMs anidan `data.result.markdown`. */
const MAX_NEST_DEPTH = 6;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Reúne cadenas candidatas y elige la **más larga**; además, si hay arrays de tramos
 * (`sections`, `content_blocks`, etc.) las une para no quedarnos solo con un bloque.
 */
function collectStringCandidates(value: unknown, depth: number, out: string[]): void {
  if (value == null || depth > MAX_NEST_DEPTH) return;

  if (typeof value === "string") {
    const t = value.trim();
    if (t.length > 0) out.push(t);
    return;
  }

  if (Array.isArray(value)) {
    const joined = joinArrayToReadableText(value);
    if (joined) out.push(joined);
    for (const item of value) {
      collectStringCandidates(item, depth + 1, out);
    }
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const o = value as Record<string, unknown>;
  for (const k of TEXT_KEYS) {
    if (isNonEmptyString(o[k])) out.push((o[k] as string).trim());
  }

  const keySet = new Set<string>(TEXT_KEYS as readonly string[]);
  for (const k of Object.keys(o)) {
    if (keySet.has(k)) continue;
    const v = o[k];
    if (typeof v === "string" && v.trim().length > 0) {
      if (/^(markdown|md|html|text|content|report|body|answer)$/i.test(k)) {
        out.push(v.trim());
      }
    }
  }

  for (const nk of NESTED_KEYS) {
    if (!(nk in o)) continue;
    const inner = o[nk];
    if (inner && typeof inner === "object") {
      collectStringCandidates(inner, depth + 1, out);
    }
  }
}

/**
 * Une arrays de strings u objetos con un solo campo de texto, típico de informes por secciones.
 */
function joinArrayToReadableText(arr: unknown[]): string | null {
  if (arr.length === 0) return null;
  const pieces: string[] = [];
  for (const el of arr) {
    if (typeof el === "string") {
      const t = el.trim();
      if (t) pieces.push(t);
    } else if (el && typeof el === "object" && !Array.isArray(el)) {
      const o = el as Record<string, unknown>;
      let found = false;
      for (const k of TEXT_KEYS) {
        if (isNonEmptyString(o[k])) {
          pieces.push((o[k] as string).trim());
          found = true;
          break;
        }
      }
      if (!found) {
        for (const k of Object.keys(o)) {
          const v = o[k];
          if (typeof v === "string" && v.trim().length > 0 && /text|content|body|md|markdown|html/i.test(k)) {
            pieces.push(v.trim());
            found = true;
            break;
          }
        }
      }
    }
  }
  if (pieces.length === 0) return null;
  if (pieces.length === 1) return pieces[0];
  return pieces.join("\n\n");
}

function longestCandidate(candidates: string[]): string {
  if (candidates.length === 0) return "";
  return candidates.reduce((a, b) => (a.length >= b.length ? a : b), "");
}

/** Extrae texto mostrable desde un valor (objeto, array, string; si el string es JSON, lo parsea). */
function extractTextFromResultValue(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") {
    const s = result.trim();
    if (!s) return "";
    if (
      (s.startsWith("{") && s.endsWith("}")) ||
      (s.startsWith("[") && s.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(s) as unknown;
        const fromParsed = extractTextFromResultValueInner(parsed);
        if (fromParsed.length > 0) return fromParsed;
      } catch {
        /* literal string, no JSON */
      }
    }
    return s;
  }
  return extractTextFromResultValueInner(result);
}

function extractTextFromResultValueInner(result: unknown): string {
  const out: string[] = [];
  collectStringCandidates(result, 0, out);
  return longestCandidate(out);
}

function pickLongestNonEmpty(...parts: (string | undefined)[]): string {
  const n = parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  if (n.length === 0) return "";
  return n.reduce((a, b) => (a.length >= b.length ? a : b), "");
}

/**
 * Texto canónico para el chat, copiar y sincronizar a `chat_messages.content`.
 * Combina `result`, opcionalmente `execution_metadata` y `result_summary`.
 * Elige la variante **más larga** en cada paso (evita resumen o `message` intro corto).
 */
export function resolveAgentTaskDisplayText(
  result: unknown,
  resultSummary: string | null | undefined,
  executionMetadata?: unknown,
): string {
  const summary = typeof resultSummary === "string" ? resultSummary.trim() : "";
  const fromResult = extractTextFromResultValue(result);
  const fromMeta =
    executionMetadata !== undefined && executionMetadata !== null
      ? extractTextFromResultValue(executionMetadata)
      : "";

  let text = pickLongestNonEmpty(fromResult, fromMeta, summary);
  if (text) return text;

  if (result != null && typeof result === "object") {
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return "";
    }
  }
  return "";
}

/** Vista previa alineada con `resolveAgentTaskDisplayText`; `isJson` si solo queda el JSON “crudo”. */
export function getAgentTaskPreviewModel(
  result: unknown,
  resultSummary: string | null | undefined,
  executionMetadata?: unknown,
): { preview: string; isJson: boolean } {
  const fromObject = extractTextFromResultValue(result);
  const fromMeta =
    executionMetadata != null && executionMetadata !== undefined
      ? extractTextFromResultValue(executionMetadata)
      : "";
  const summary = typeof resultSummary === "string" ? resultSummary.trim() : "";
  const text = resolveAgentTaskDisplayText(result, resultSummary, executionMetadata);
  const isJson =
    result != null &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    !fromObject &&
    !fromMeta &&
    !summary;
  return { preview: text, isJson };
}

export type AgentTaskDeliverableLink = { label: string; href: string };

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s.trim());
}

function pushItem(out: AgentTaskDeliverableLink[], label: string, href: string) {
  const h = href.trim();
  if (!h) return;
  if (h.length < 2) return;
  if (!isHttpUrl(h) && !h.startsWith("/") && !h.startsWith("gs://") && h.length < 3) return;
  out.push({ label: label || "Enlace", href: h });
}

function walkUnknownForFiles(u: unknown, out: AgentTaskDeliverableLink[], depth: number) {
  if (depth > 4 || u == null) return;
  if (Array.isArray(u)) {
    for (const item of u) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        const name =
          (typeof o.name === "string" && o.name) ||
          (typeof o.filename === "string" && o.filename) ||
          (typeof o.title === "string" && o.title) ||
          "Archivo";
        const href =
          (typeof o.url === "string" && o.url) ||
          (typeof o.href === "string" && o.href) ||
          (typeof o.download_url === "string" && o.download_url) ||
          (typeof o.file_url === "string" && o.file_url) ||
          (typeof o.path === "string" && o.path) ||
          (typeof o.signedUrl === "string" && o.signedUrl) ||
          "";
        if (href) pushItem(out, name, href);
        else walkUnknownForFiles(o, out, depth + 1);
      } else if (typeof item === "string" && (isHttpUrl(item) || item.startsWith("/"))) {
        pushItem(out, "Enlace", item);
      }
    }
    return;
  }
  if (typeof u === "object") {
    const o = u as Record<string, unknown>;
    const names = [
      "files",
      "attachments",
      "deliverables",
      "output_files",
      "outputs",
      "documents",
    ];
    for (const n of names) {
      if (n in o) walkUnknownForFiles(o[n], out, depth + 1);
    }
  }
}

/**
 * Enlaces o rutas entregables desde el JSON de resultado o de `execution_metadata`.
 */
export function extractDeliverableLinks(
  result: unknown,
  executionMetadata: unknown,
): AgentTaskDeliverableLink[] {
  const out: AgentTaskDeliverableLink[] = [];
  walkUnknownForFiles(result, out, 0);
  walkUnknownForFiles(executionMetadata, out, 0);
  const seen = new Set<string>();
  return out.filter((l) => {
    const k = `${l.label}::${l.href}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
