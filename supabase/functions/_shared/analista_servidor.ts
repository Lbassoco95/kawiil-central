// Piezas del Analista que comparten marketing-agente (preguntas directas) y marketing-seguimientos (preguntas programadas).
// Solo lectura: la llamada al modelo y las herramientas de lista cerrada (mk_analista_datos). No conoce Metricool.
import type { Esfuerzo, Herramienta, Herramientas, Llm, Mensaje } from "./analista.ts";

// El modelo siempre razona antes de responder, y ese razonamiento cuenta dentro de max_tokens: con 1024 se agotaba pensando y no llegaba a escribir
// (13 nov 2026, CMO: stop=max_tokens, bloques=thinking). 8000 deja espacio de sobra para razonar y redactar (~250 palabras).
export const MAX_TOKENS_SALIDA = 8000;
export const TIEMPO_MAX_LLAMADA_MS = 60_000;

// Llamada a la API de mensajes de Anthropic con herramientas. Devuelve el formato que espera correrConsulta.
export function llmAnthropic(apiKey: string, modelo: string): Llm {
  return async ({ system, mensajes, herramientas, sinHerramientas, esfuerzo }: { system: string; mensajes: Mensaje[]; herramientas: Herramienta[]; sinHerramientas?: boolean; esfuerzo?: Esfuerzo }) => {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: modelo, max_tokens: MAX_TOKENS_SALIDA, ...(esfuerzo ? { output_config: { effort: esfuerzo } } : {}), system, messages: mensajes, ...(herramientas.length > 0 ? { tools: herramientas.map((h) => ({ name: h.name, description: h.description, input_schema: h.input_schema })) } : {}), ...(sinHerramientas ? { tool_choice: { type: "none" } } : {}) }),
      signal: AbortSignal.timeout(TIEMPO_MAX_LLAMADA_MS),
    });
    if (!r.ok) throw new Error(`anthropic ${r.status}`);
    const d = await r.json();
    return { contenido: d.content ?? [], stop_reason: d.stop_reason ?? "end_turn", uso: { entrada: d.usage?.input_tokens ?? 0, salida: d.usage?.output_tokens ?? 0 } };
  };
}

// Herramienta de Comunicación interna: lee los comunicados que ya existen para no duplicar un aviso. Solo los publicados y los borradores de quien pregunta
// (no los de otras personas). El texto de los comunicados se entrega recortado y es DATO, no instrucciones. Si la base aún no tiene las columnas nuevas, falla y el agente sigue sin ella.
// deno-lint-ignore no-explicit-any
export function herramientasComunicacion(db: { from: (t: string) => any }, org: string, userId: string): Herramientas {
  return {
    comunicados_recientes: async () => {
      const { data, error } = await db.from("internal_comunicados").select("title, body, estado, origen, vigente_desde, vigente_hasta, avisar_al_entrar, created_by, created_at")
        .eq("organization_id", org).order("created_at", { ascending: false }).limit(40);
      if (error) throw new Error(error.message);
      type Fila = { title: string; body: string | null; estado: string; origen: string; vigente_desde: string | null; vigente_hasta: string | null; avisar_al_entrar: boolean; created_by: string | null; created_at: string };
      const filas = ((data ?? []) as Fila[]).filter((c) => c.estado === "publicado" || (c.estado === "borrador" && c.created_by === userId)).slice(0, 15)
        .map((c) => ({ titulo: c.title, texto: (c.body ?? "").slice(0, 300), estado: c.estado, origen: c.origen, vigente_desde: c.vigente_desde, vigente_hasta: c.vigente_hasta, avisar_al_entrar: c.avisar_al_entrar, creado: c.created_at.slice(0, 10) }));
      return { herramienta: "comunicados_recientes", corte: new Date().toISOString(), datos: filas };
    },
  };
}

// Herramientas: cada una llama a la función SQL de lista cerrada con la organización indicada.
export const NOMBRES_HERRAMIENTAS = ["colchon_actual", "resultados_semanales", "resultados_por_formato", "resultados_por_pilar", "semaforo_semanas", "casos_abiertos", "informe_hoy", "piezas_proximas", "reglas_vigentes", "cobertura_fuentes", "estado_equipo"];

// deno-lint-ignore no-explicit-any
export function herramientasDe(db: { rpc: (fn: string, args: Record<string, unknown>) => any }, org: string): Herramientas {
  return Object.fromEntries(NOMBRES_HERRAMIENTAS.map((n) => [n, async (entrada: Record<string, unknown>) => {
    const { data, error } = await db.rpc("mk_analista_datos", { p_org: org, p_herramienta: n, p_entrada: entrada });
    if (error) throw new Error(error.message);
    return data;
  }]));
}
