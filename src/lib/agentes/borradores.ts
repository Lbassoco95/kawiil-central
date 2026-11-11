import { limpiarMensajes, pareceSecreto, validarPropuesta, type MensajeChat, type PropuestaAgente } from "../../../supabase/functions/_shared/agenteConstructor";

// Borradores de la creación de agentes: reglas puras (sin red) para guardar y retomar el chat del Constructor.
export interface Borrador { id: string; titulo: string; mensajes: MensajeChat[]; propuesta: PropuestaAgente | null; actualizado: string }
export const MAX_BORRADORES = 20;

// Título: el primer mensaje de la persona, en una línea.
export function tituloBorrador(mensajes: MensajeChat[]): string {
  const t = (mensajes.find((m) => m.role === "user")?.content ?? "").replace(/\s+/g, " ").trim();
  return t.length > 70 ? t.slice(0, 69) + "…" : t || "Agente sin nombre";
}

// ¿Vale la pena guardar? Debe haber algo dicho, y nada que parezca una contraseña o una llave (un secreto jamás se guarda).
export function guardable(mensajes: MensajeChat[]): boolean {
  return mensajes.length > 0 && mensajes.some((m) => m.role === "user") && !mensajes.some((m) => pareceSecreto(m.content));
}

// Fila de la base → borrador seguro. Lo que no tenga forma se descarta: el borrador nunca rompe la pantalla.
export function borradorDeFila(f: unknown): Borrador | null {
  const x = (f && typeof f === "object" ? f : null) as Record<string, unknown> | null;
  if (!x || typeof x.id !== "string") return null;
  const mensajes = limpiarMensajes(x.messages);
  if (mensajes.length === 0) return null;
  let propuesta: PropuestaAgente | null = null;
  if (x.propuesta) { const v = validarPropuesta(x.propuesta); if (v.ok) propuesta = v.propuesta; }
  return { id: x.id, titulo: typeof x.titulo === "string" && x.titulo ? x.titulo : tituloBorrador(mensajes), mensajes, propuesta, actualizado: typeof x.updated_at === "string" ? x.updated_at : "" };
}
