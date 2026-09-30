/**
 * Portal del cliente — ÚNICO punto de salida hacia un modelo: openclaw-gateway.
 *
 * Prohibido llamar directo a Anthropic, OpenAI o Google desde el portal. El
 * gateway corre en la VM kawiil-agents (ver docs/juun/README.md). Se asume su
 * interfaz compatible con chat completions (`POST {url}/v1/chat/completions`);
 * si Kawiil expone otra ruta, se cambia SOLO aquí (OPENCLAW_GATEWAY_PATH).
 *
 * Uso: paso 2 de la categorización (sugerencia). La sugerencia nunca queda
 * definitiva: una persona de Kawiil confirma (portal_staff_confirm_category).
 * Si OPENCLAW_GATEWAY_URL no está configurada, la función devuelve null.
 */
export interface GatewayConfig {
  url?: string | null;
  token?: string | null;
  model?: string | null;
  path?: string | null;
  fetchImpl?: typeof fetch;
}

export interface CategoryOption {
  id: string;
  name: string;
}

export interface CfdiForSuggestion {
  nombreEmisor: string | null;
  rfcEmisor: string | null;
  descripcion: string | null;
  claveProdServ: string | null;
  total: number | null;
}

export interface Suggestion {
  categoryId: string;
  model: string;
}

export function buildSuggestionPrompt(cfdi: CfdiForSuggestion, options: CategoryOption[]): string {
  return [
    "Clasifica un gasto de una factura mexicana (CFDI recibido) en UNA de estas categorías.",
    "Responde solo JSON: {\"category_id\": \"<id>\"} o {\"category_id\": null} si no hay certeza.",
    "Categorías:",
    ...options.map((o) => `- ${o.id}: ${o.name}`),
    "Factura:",
    `- Emisor: ${cfdi.nombreEmisor ?? "?"} (${cfdi.rfcEmisor ?? "?"})`,
    `- Concepto principal: ${cfdi.descripcion ?? "?"} · clave SAT ${cfdi.claveProdServ ?? "?"}`,
    `- Total: ${cfdi.total ?? "?"} MXN`,
  ].join("\n");
}

/** Extrae y valida la respuesta: solo acepta un id de la lista. */
export function parseSuggestion(content: string, options: CategoryOption[]): string | null {
  const m = content.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    const id = typeof j.category_id === "string" ? j.category_id : null;
    return id && options.some((o) => o.id === id) ? id : null;
  } catch {
    return null;
  }
}

export async function suggestCategory(
  cfg: GatewayConfig,
  cfdi: CfdiForSuggestion,
  options: CategoryOption[],
): Promise<Suggestion | null> {
  if (!cfg.url || options.length === 0) return null;
  const model = cfg.model || "openclaw";
  const f = cfg.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  const res = await f(`${cfg.url.replace(/\/+$/, "")}${cfg.path || "/v1/chat/completions"}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}),
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [{ role: "user", content: buildSuggestionPrompt(cfdi, options) }],
    }),
    signal: ctrl.signal,
  }).finally(() => clearTimeout(timer));
  if (!res.ok) throw new Error(`openclaw-gateway respondió ${res.status}`);
  const j = await res.json();
  const content = j?.choices?.[0]?.message?.content ?? "";
  const id = parseSuggestion(String(content), options);
  return id ? { categoryId: id, model: `openclaw:${model}` } : null;
}
