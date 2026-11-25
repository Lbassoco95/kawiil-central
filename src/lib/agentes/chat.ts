// El chat de un agente vive en su propia pantalla (R2): `/agentes/chat/<id>`, con dirección propia para abrirla en una pestaña del navegador,
// recargarla o compartirla. `?conv=` es la conversación que se estaba viendo; `?a=` son los agentes abiertos en el espacio de trabajo (pestañas).
import type { EstadoOficina } from "./oficina";
import { estaPausado, soloLectura } from "../../../supabase/functions/_shared/agentePermisos";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_ABIERTOS = 8;   // tope de pestañas abiertas a la vez (no es el tope de «Varios a la vez», que es una decisión pendiente de Dirección)

export const leerAbiertos = (param: string | null | undefined): string[] =>
  [...new Set((param ?? "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => UUID.test(x)))].slice(0, MAX_ABIERTOS);

/** Dirección del chat de un agente. `abiertos` conserva las pestañas del espacio de trabajo; sin ellas, el chat abre solo (pestaña nueva del navegador). */
export function urlChat(agenteId: string, o: { conv?: string | null; abiertos?: string[]; modo?: "una" | "varios"; ver?: string[] } = {}): string {
  const q = new URLSearchParams();
  if (o.conv && UUID.test(o.conv)) q.set("conv", o.conv.toLowerCase());
  const otros = (o.abiertos ?? []).filter((x) => x !== agenteId);
  if (otros.length > 0) q.set("a", [agenteId, ...otros].join(","));
  if (o.modo === "varios") { q.set("modo", "varios"); if (o.ver?.length) q.set("ver", o.ver.join(",")); }
  const qs = q.toString();
  return `/agentes/chat/${agenteId}${qs ? `?${qs}` : ""}`;
}

// Estado que se muestra en las pestañas: siempre palabra + marca, nunca solo color (R2.4).
// «Solo lectura» lo es todo agente creado por otro agente que ninguna persona haya habilitado (decisión de Dirección, 25 nov), o el que el registro marque con `config.modo = "solo_lectura"`.
// «Pausado» (una persona lo pausó) manda sobre todo lo demás.
export interface EstadoVisible { texto: string; marca: string }
export function estadoVisible(estado: EstadoOficina, esperas: number, soloLecturaModo = false, pausado = false): EstadoVisible {
  if (pausado) return { texto: "Pausado", marca: "⏸" };
  if (esperas > 0) return { texto: "Te necesita", marca: "▲" };
  switch (estado) {
    case "trabajando": return { texto: "Trabajando", marca: "●" };
    case "celebrando": return { texto: "Terminó", marca: "✓" };
    case "con_error": case "atascado": return { texto: "Con error", marca: "✕" };
    case "descansando": return { texto: "Descansando", marca: "◌" };
    case "apagado": return { texto: "Sin señal", marca: "–" };
    default: return soloLecturaModo ? { texto: "Solo lectura", marca: "◇" } : { texto: "Disponible", marca: "○" };
  }
}
export const esSoloLectura = (config: Record<string, unknown> | null | undefined): boolean => soloLectura(config);
export const esPausado = (config: Record<string, unknown> | null | undefined): boolean => estaPausado(config);
