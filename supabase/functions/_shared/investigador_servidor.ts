// Llamada al modelo CON búsqueda web para el descubrimiento de fuentes del Investigador. Es la única pieza que habla con la API de Anthropic para buscar.
// - La búsqueda la hace la herramienta de búsqueda web de Anthropic (herramienta del servidor): esta función no abre ningún sitio por su cuenta.
// - El modelo no recibe ninguna otra herramienta (ni de base de datos ni de escritura). Su respuesta es texto que luego se valida candidato por candidato.
// - Misma API y mismas restricciones que el resto: sin thinking/budget_tokens/temperature (el modelo responde 400 con ellos).
// - La versión de la herramienta de búsqueda es configurable por secreto (MARKETING_BUSQUEDA_HERRAMIENTA) por si Anthropic publica una versión nueva.
import { MAX_TOKENS_SALIDA } from "./analista_servidor.ts";
import { DESCUBRIR, type Buscar } from "./investigador_descubrir.ts";

export const HERRAMIENTA_BUSQUEDA_POR_DEFECTO = "web_search_20250305";
export const TIEMPO_LLAMADA_BUSQUEDA_MS = 50_000;
export const MAX_RONDAS = 3; // la API puede pausar un turno largo («pause_turn») y hay que continuarlo

type Bloque = { type: string; text?: string; name?: string };
type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<Response>;

export function buscarConModelo(apiKey: string, modelo: string, o: { herramienta?: string; fetchFn?: Fetch } = {}): Buscar {
  const fetchFn: Fetch = o.fetchFn ?? ((u, i) => fetch(u, i));
  const herramienta = o.herramienta || HERRAMIENTA_BUSQUEDA_POR_DEFECTO;
  return async (system, usuario) => {
    const mensajes: Array<{ role: "user" | "assistant"; content: unknown }> = [{ role: "user", content: usuario }];
    const tokens = { entrada: 0, salida: 0 };
    let busquedas = 0;
    for (let ronda = 0; ronda < MAX_RONDAS; ronda++) {
      const r = await fetchFn("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: modelo, max_tokens: MAX_TOKENS_SALIDA, system, messages: mensajes, tools: [{ type: herramienta, name: "web_search", max_uses: DESCUBRIR.MAX_BUSQUEDAS }] }),
        signal: AbortSignal.timeout(TIEMPO_LLAMADA_BUSQUEDA_MS),
      });
      if (!r.ok) throw new Error(`anthropic ${r.status}`); // nunca se devuelve el cuerpo del error
      const d = await r.json() as { content?: Bloque[]; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
      const bloques = d.content ?? [];
      tokens.entrada += d.usage?.input_tokens ?? 0; tokens.salida += d.usage?.output_tokens ?? 0;
      busquedas += bloques.filter((b) => b.type === "server_tool_use" && b.name === "web_search").length;
      if (d.stop_reason === "pause_turn") { mensajes.push({ role: "assistant", content: bloques }); continue; }
      const texto = bloques.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
      if (!texto) throw new Error("el modelo no devolvió texto");
      return { texto, tokens, busquedas };
    }
    throw new Error("la búsqueda no terminó en el número de rondas permitido");
  };
}
