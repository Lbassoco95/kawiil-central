/**
 * Resumen de invitados para leerlos de un vistazo: quién confirma,
 * quién falta y los acompañantes (+1) con nombre.
 * Quien dijo "no" no suma en "vienen", ni su acompañante ni sus extras.
 */

export type GuestStatus = "si" | "no" | "pendiente";

export interface GuestAttendee {
  id?: string;
  name: string;
  confirmed: string;
  has_plus_one: boolean;
  plus_one_name?: string | null;
  plus_one_confirmed?: string | null;
  plus_one_dietary?: string | null;
  plus_one_phone?: string | null;
  extra_guests_requested?: number | null;
  extra_guests_status?: string | null;
  extra_guests_note?: string | null;
}

export interface PlusOneLine {
  attendeeId: string;
  name: string;
  host: string;
  status: GuestStatus;
  dietary: string | null;
  phone: string | null;
  /** El invitado dijo que no asiste: el +1 tampoco viene. */
  hostDeclined: boolean;
}

export type ExtraGuestStatus = "solicitado" | "aprobado" | "rechazado";

export interface ExtraGuestLine {
  attendeeId: string;
  host: string;
  count: number;
  status: ExtraGuestStatus;
  note: string | null;
}

export interface GuestOverview {
  invitadosTotal: number;
  confirman: number;
  pendientes: number;
  noAsisten: number;
  /** Invitados que confirman + sus +1 que confirman + extras aprobados de quien confirma. */
  vienen: number;
  /** Lo mismo, pero todavía en pendiente. */
  porConfirmar: number;
  /** Invitados con una solicitud de extra sin resolver. */
  porAprobar: number;
  plusOnes: PlusOneLine[];
  plusSinNombre: number;
  extras: ExtraGuestLine[];
}

const clean = (s?: string | null) => (s ?? "").trim();

export function guestStatus(value?: string | null): GuestStatus {
  return value === "si" || value === "no" ? value : "pendiente";
}

function extraStatus(value?: string | null): ExtraGuestStatus | null {
  return value === "solicitado" || value === "aprobado" || value === "rechazado" ? value : null;
}

export function buildGuestOverview(attendees: GuestAttendee[]): GuestOverview {
  let confirman = 0;
  let pendientes = 0;
  let noAsisten = 0;
  let vienen = 0;
  let porConfirmar = 0;
  let porAprobar = 0;
  let plusSinNombre = 0;
  const plusOnes: PlusOneLine[] = [];
  const extras: ExtraGuestLine[] = [];

  attendees.forEach((a, index) => {
    const confirmed = guestStatus(a.confirmed);
    const host = clean(a.name) || "Invitado";
    const attendeeId = a.id ?? `invitado-${index}`;

    if (confirmed === "si") {
      confirman += 1;
      vienen += 1;
    } else if (confirmed === "no") {
      noAsisten += 1;
    } else {
      pendientes += 1;
      porConfirmar += 1;
    }

    if (a.has_plus_one) {
      const plus = guestStatus(a.plus_one_confirmed);
      const name = clean(a.plus_one_name);
      const hostDeclined = confirmed === "no";
      if (!hostDeclined && plus === "si") vienen += 1;
      if (!hostDeclined && plus === "pendiente") porConfirmar += 1;
      if (name) {
        plusOnes.push({
          attendeeId,
          name,
          host,
          status: plus,
          dietary: clean(a.plus_one_dietary) || null,
          phone: clean(a.plus_one_phone) || null,
          hostDeclined,
        });
      } else if (!hostDeclined && plus !== "no") {
        plusSinNombre += 1;
      }
    }

    const extrasCount = a.extra_guests_requested ?? 0;
    const extrasState = extraStatus(a.extra_guests_status);
    if (extrasCount > 0 && extrasState) {
      if (extrasState === "solicitado") porAprobar += 1;
      extras.push({
        attendeeId,
        host,
        count: extrasCount,
        status: extrasState,
        note: clean(a.extra_guests_note) || null,
      });
      if (extrasState === "aprobado" && confirmed === "si") vienen += extrasCount;
      if (extrasState === "aprobado" && confirmed === "pendiente") porConfirmar += extrasCount;
    }
  });

  return {
    invitadosTotal: attendees.length,
    confirman,
    pendientes,
    noAsisten,
    vienen,
    porConfirmar,
    porAprobar,
    plusOnes,
    plusSinNombre,
    extras,
  };
}
