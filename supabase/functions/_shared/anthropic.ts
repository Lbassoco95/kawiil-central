// Helper mínimo para llamar a la API de Mensajes de Anthropic desde las Edge
// Functions del Conmutador. Reintenta ante 429/529/overloaded (backoff corto).

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export interface AnthropicCall {
  apiKey: string;
  model: string;
  system?: string;
  messages: { role: "user" | "assistant"; content: string }[];
  max_tokens?: number;
  temperature?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Devuelve el texto concatenado de los bloques de tipo "text".
export async function callAnthropicText(call: AnthropicCall): Promise<string> {
  const body = JSON.stringify({
    model: call.model,
    max_tokens: call.max_tokens ?? 512,
    temperature: call.temperature ?? 0,
    ...(call.system ? { system: call.system } : {}),
    messages: call.messages,
  });

  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": call.apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body,
    });

    if (resp.ok) {
      const data = await resp.json();
      const parts = Array.isArray(data?.content) ? data.content : [];
      return parts
        .filter((b: { type?: string }) => b?.type === "text")
        .map((b: { text?: string }) => b?.text ?? "")
        .join("")
        .trim();
    }

    lastErr = await resp.text().catch(() => `HTTP ${resp.status}`);
    // Reintenta solo ante sobrecarga / rate limit.
    if (resp.status === 429 || resp.status === 529 || resp.status >= 500) {
      await sleep(300 * Math.pow(2, attempt)); // 300ms, 600ms, 1.2s
      continue;
    }
    break;
  }
  throw new Error(`Anthropic API error: ${lastErr}`);
}

export const MODEL_HAIKU =
  (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno
    ?.env.get("KAWIIL_AI_FAST_MODEL")
    ?.trim() || "claude-haiku-4-5";
export const MODEL_SONNET = "claude-sonnet-4-6";
