// Permisos de un agente creado por otro agente y pausa (decisión de Dirección, 25 nov 2026):
//  · Todo agente creado por OTRO agente empieza en «Solo lectura»; una persona lo habilita (`config.habilitado`).
//  · Un agente pausado no recibe tareas hasta que una persona lo reanuda (`config.pausado`).
// Funciones puras, sin red ni base: las usan la pantalla, `agente-constructor` (que escribe) y `dispatch-to-agent` (que lo hace valer en lo que este repositorio controla).
// Lo que ocurre dentro de la VM `kawiil-agents` (programadas, llamadas entre agentes) lo hace valer la VM: ver docs/agentes-vm-requisitos.md.

type Config = Record<string, unknown> | null | undefined;
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** El agente lo creó otro agente (`creado_por = { tipo: "agente", id }`). */
export const creadoPorAgente = (cfg: Config): boolean => { const p = obj(obj(cfg)?.creado_por); return p?.tipo === "agente" && typeof p.id === "string" && p.id !== ""; };

/** Una persona lo habilitó: `config.habilitado = { por, en }`. */
export const estaHabilitado = (cfg: Config): boolean => { const h = obj(obj(cfg)?.habilitado); return !!h && typeof h.por === "string" && h.por !== ""; };

/** Solo lectura: lo marca el registro (`config.modo = "solo_lectura"`) o lo es todo agente creado por otro agente que ninguna persona ha habilitado. */
export const soloLectura = (cfg: Config): boolean => obj(cfg)?.modo === "solo_lectura" || (creadoPorAgente(cfg) && !estaHabilitado(cfg));

export const estaPausado = (cfg: Config): boolean => { const p = obj(obj(cfg)?.pausado); return !!p && typeof p.por === "string" && p.por !== ""; };

const base = (cfg: Config): Record<string, unknown> => ({ ...(obj(cfg) ?? {}) });

/** Pausa (o reanuda con `pausado = false`) y deja quién y cuándo. No toca nada más del config. */
export function conPausa(cfg: Config, pausado: boolean, persona: string, ahora: Date): Record<string, unknown> {
  const c = base(cfg);
  if (pausado) c.pausado = { por: persona, en: ahora.toISOString() }; else delete c.pausado;
  return c;
}

/** Una persona habilita al agente: deja de estar en Solo lectura. Solo aplica a los que lo necesitan (creados por otro agente o marcados). */
export function conHabilitacion(cfg: Config, persona: string, ahora: Date): { ok: true; config: Record<string, unknown> } | { ok: false; error: string } {
  if (!soloLectura(cfg)) return { ok: false, error: "Este agente no está en Solo lectura." };
  const c = base(cfg);
  c.habilitado = { por: persona, en: ahora.toISOString() };
  if (c.modo === "solo_lectura") delete c.modo;
  return { ok: true, config: c };
}

/** Lo que una tarea puede llevar a un agente en Solo lectura: ningún acceso de 1Password ni escritura en sitios, aunque la persona los marque. */
export function contextoSeguro(contexto: unknown, cfg: Config): unknown {
  const c = obj(contexto);
  if (!c || !soloLectura(cfg)) return contexto;
  const { accesos_aprobados: _a, escrituras_aprobadas: _e, ...resto } = c;
  return resto;
}
