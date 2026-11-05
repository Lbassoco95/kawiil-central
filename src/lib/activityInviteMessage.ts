/**
 * Texto base de los mensajes del evento. Funciones puras, sin dependencias.
 * Quien llama formatea la fecha (para no acoplar este archivo a date-fns).
 */

export interface InviteFields {
  name: string;
  /** Fecha ya en texto (ej. "viernes 18 de diciembre de 2026"); vacío si no hay. */
  fecha: string;
  /** Hora "HH:MM" o null. */
  hora: string | null;
  lugar: string | null;
}

const details = (f: InviteFields) => [
  `📅 Fecha: ${f.fecha || "por confirmar"}`,
  `🕒 Hora: ${f.hora ? `${f.hora.slice(0, 5)} h` : "por confirmar"}`,
  `📍 Lugar: ${f.lugar?.trim() || "por confirmar"}`,
];

/** Mensaje para el invitado (menciona que puede ir con acompañante). */
export function inviteeMessage(f: InviteFields): string {
  return [
    "¡Hola! 👋",
    "",
    `Te esperamos en ${f.name}.`,
    "",
    ...details(f),
    "",
    "El evento es +1: puedes venir con un acompañante.",
    "Por favor confírmanos tu asistencia, el nombre de tu acompañante y si tú o tu acompañante tienen alguna restricción alimentaria.",
    "",
    "¡Gracias!",
  ].join("\n");
}

/** Mensaje para el acompañante (+1): dice quién lo invitó y no le pide datos de otra persona. */
export function companionMessage(f: InviteFields, inviteeFirstName: string): string {
  const quien = inviteeFirstName.trim() || "Un invitado";
  return [
    "¡Hola! 👋",
    "",
    `${quien} te invitó como su acompañante a ${f.name}.`,
    "",
    ...details(f),
    "",
    "Por favor confírmanos tu asistencia y si tienes alguna restricción alimentaria.",
    "",
    "¡Gracias!",
  ].join("\n");
}
