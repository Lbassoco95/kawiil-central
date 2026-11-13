// Piezas del Analista que comparten marketing-agente (preguntas directas) y marketing-seguimientos (preguntas programadas).
// Solo lectura: la llamada al modelo y las herramientas de lista cerrada (mk_analista_datos). No conoce Metricool.
import type { Herramienta, Herramientas, Llm, Mensaje } from "./analista.ts";

// Llamada a la API de mensajes de Anthropic con herramientas. Devuelve el formato que espera correrConsulta.
export function llmAnthropic(apiKey: string, modelo: string): Llm {
  return async ({ system, mensajes, herramientas, sinHerramientas }: { system: string; mensajes: Mensaje[]; herramientas: Herramienta[]; sinHerramientas?: boolean }) => {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: modelo, max_tokens: 1024, system, messages: mensajes, tools: herramientas.map((h) => ({ name: h.name, description: h.description, input_schema: h.input_schema })), ...(sinHerramientas ? { tool_choice: { type: "none" } } : {}) }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) throw new Error(`anthropic ${r.status}`);
    const d = await r.json();
    return { contenido: d.content ?? [], stop_reason: d.stop_reason ?? "end_turn", uso: { entrada: d.usage?.input_tokens ?? 0, salida: d.usage?.output_tokens ?? 0 } };
  };
}

// Herramientas: cada una llama a la función SQL de lista cerrada con la organización indicada.
export const NOMBRES_HERRAMIENTAS = ["colchon_actual", "resultados_semanales", "resultados_por_formato", "resultados_por_pilar", "semaforo_semanas", "casos_abiertos", "informe_hoy", "piezas_proximas", "reglas_vigentes", "cobertura_fuentes"];

// deno-lint-ignore no-explicit-any
export function herramientasDe(db: { rpc: (fn: string, args: Record<string, unknown>) => any }, org: string): Herramientas {
  return Object.fromEntries(NOMBRES_HERRAMIENTAS.map((n) => [n, async (entrada: Record<string, unknown>) => {
    const { data, error } = await db.rpc("mk_analista_datos", { p_org: org, p_herramienta: n, p_entrada: entrada });
    if (error) throw new Error(error.message);
    return data;
  }]));
}
