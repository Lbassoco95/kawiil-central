// Acceso a datos de los comunicados internos que redacta el agente «Comunicación interna». Solo Dirección (permiso marketing_decidir) puede guardar borradores, publicar,
// retirar o descartar: lo hacen las funciones ic_* de la base, que además lo vuelven a comprobar. El agente nunca escribe nada: la persona guarda y aprueba.
import { supabase } from "@/integrations/supabase/client";
import type { PropuestaComunicado } from "@/lib/comunicados";

export interface ResultadoComunicado { ok: boolean; id?: string; error?: string }

/** Mensaje en español para una persona. Los errores que la base manda a propósito ya vienen en español; los técnicos se reemplazan. */
export function mensajeDeError(error: { message?: string; code?: string } | null | undefined): string {
  const m = error?.message ?? "";
  if (error?.code === "PGRST202" || /could not find the function|schema cache/i.test(m)) return "Esta función todavía no está activa: falta aplicar la actualización de la base de datos.";
  if (/permission denied/i.test(m) || error?.code === "42501" && !/^Solo Dirección/.test(m)) return "No tienes permiso para hacer esto.";
  if (/^(Solo Dirección|No se encontr|El título|El mensaje|La vigencia|Para avisar|Solo se pueden)/.test(m)) return m;
  return "No se pudo completar la acción. Inténtalo de nuevo.";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args: Record<string, unknown>) => (supabase as any).rpc(fn, args) as Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;

export async function guardarBorradorComunicado(p: PropuestaComunicado): Promise<ResultadoComunicado> {
  const { data, error } = await rpc("ic_crear_borrador", { p_titulo: p.titulo, p_mensaje: p.mensaje, p_desde: p.vigente_desde, p_hasta: p.vigente_hasta, p_avisar: p.avisar_al_entrar });
  return error ? { ok: false, error: mensajeDeError(error) } : { ok: true, id: String(data) };
}
export async function publicarComunicado(id: string): Promise<ResultadoComunicado> {
  const { error } = await rpc("ic_publicar", { p_id: id });
  return error ? { ok: false, id, error: mensajeDeError(error) } : { ok: true, id };
}
export async function archivarComunicado(id: string): Promise<ResultadoComunicado> {
  const { error } = await rpc("ic_archivar", { p_id: id });
  return error ? { ok: false, id, error: mensajeDeError(error) } : { ok: true, id };
}
export async function descartarBorradorComunicado(id: string): Promise<ResultadoComunicado> {
  const { error } = await rpc("ic_descartar_borrador", { p_id: id });
  return error ? { ok: false, id, error: mensajeDeError(error) } : { ok: true, id };
}
/** Aprobación en un paso: guarda el borrador y lo publica. Si falla al publicar, el borrador se conserva y se dice. */
export async function publicarPropuestaComunicado(p: PropuestaComunicado): Promise<ResultadoComunicado> {
  const b = await guardarBorradorComunicado(p);
  if (!b.ok || !b.id) return b;
  const r = await publicarComunicado(b.id);
  return r.ok ? r : { ok: false, id: b.id, error: `Se guardó como borrador, pero no se pudo publicar: ${r.error}` };
}
