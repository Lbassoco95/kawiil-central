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

/** Enlace personal de confirmación de un asistente. */
export const rsvpUrl = (origin: string, token: string) => `${origin}/invitacion/${token}`;

/**
 * Mensaje para el invitado. Termina invitando a confirmar; quien lo envía le agrega
 * debajo el enlace personal, donde confirma asistencia, alergias y si lleva +1.
 */
export function inviteeMessage(f: InviteFields): string {
  return [
    "¡Hola! 👋",
    "",
    `Te esperamos en ${f.name}.`,
    "",
    ...details(f),
    "",
    "El evento es +1: puedes venir con un acompañante.",
    "Confirma tu asistencia aquí; ahí mismo nos dices si tú o tu acompañante son alérgicos a algo 👇",
  ].join("\n");
}
