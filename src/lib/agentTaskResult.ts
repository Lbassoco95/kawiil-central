/**
 * Normaliza `agent_tasks.result` (Json) y `result_summary` para el chat.
 * `result_summary` suele ser un resumen corto; el texto completo va en `result` (string o JSON con claves tipo text/markdown).
 */

const TEXT_KEYS = [
  "markdown",
  "final_report",
  "full_text",
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
  "summary", // a veces el informe vive aquí; se compara longitud con result_summary abajo
] as const;

const NESTED_KEYS = ["data", "result", "payload", "output", "response"] as const;

const MAX_NEST_DEPTH = 2;

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Reúne cadenas candidatas en `result` (sin `result_summary`) y elige la **más larga**:
 * la VM a veces rellena `message` con un intro corto y `markdown` con el cuerpo completo.
 */
function collectStringCandidates(
  value: unknown,
  depth: number,
  out: string[],
): void {
  if (value == null || depth > MAX_NEST_DEPTH) return;

  if (typeof value === "string") {
    const t = value.trim();
    if (t.length > 0) out.push(t);
    return;
  }

  if (typeof value !== "object" || Array.isArray(value)) {
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
      if (/^(markdown|md|html|text|content)$/i.test(k)) {
        out.push(v.trim());
      }
    }
  }

  for (const nk of NESTED_KEYS) {
    if (!(nk in o)) continue;
    const inner = o[nk];
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      collectStringCandidates(inner, depth + 1, out);
    }
  }
}

/** Extrae texto mostrable desde `result` sin usar `result_summary` (candidata más larga). */
function extractTextFromResultValue(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") {
    return result.trim();
  }
  const out: string[] = [];
  collectStringCandidates(result, 0, out);
  if (out.length === 0) return "";
  return out.reduce((a, b) => (a.length >= b.length ? a : b), "");
}

/**
 * Texto canónico para el chat, copiar y sincronizar a `chat_messages.content`.
 * Prefiere el cuerpo largo en `result`; si no hay, `result_summary`.
 * Si ambos existen, se elige el **más largo** (evita quedarse con el resumen truncado).
 */
export function resolveAgentTaskDisplayText(
  result: unknown,
  resultSummary: string | null | undefined,
): string {
  const summary = typeof resultSummary === "string" ? resultSummary.trim() : "";

  if (typeof result === "string") {
    const s = result.trim();
    if (!s) return summary;
    if (!summary) return s;
    return s.length >= summary.length ? s : summary;
  }

  const fromObject = extractTextFromResultValue(result);
  if (fromObject && summary) {
    return fromObject.length >= summary.length ? fromObject : summary;
  }
  if (fromObject) return fromObject;
  if (summary) return summary;

  if (result != null && typeof result === "object" && !Array.isArray(result)) {
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
): { preview: string; isJson: boolean } {
  const fromObject = extractTextFromResultValue(result);
  const summary = typeof resultSummary === "string" ? resultSummary.trim() : "";
  const text = resolveAgentTaskDisplayText(result, resultSummary);
  const isJson =
    result != null &&
    typeof result === "object" &&
    !Array.isArray(result) &&
    !fromObject &&
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
