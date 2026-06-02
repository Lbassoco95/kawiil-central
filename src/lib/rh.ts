/**
 * Recursos Humanos (RH) — tipos y helpers compartidos.
 * Entrega 1: check-in/out con geolocalización, turnos y modalidad
 * (oficina / home office) configurada por los G4 (transformador).
 */

export type RhWorkMode = "office" | "home_office" | "commission";

export const WORK_MODES: RhWorkMode[] = ["office", "home_office", "commission"];

export type RhEmploymentType = "full_time" | "part_time";

export const EMPLOYMENT_TYPES: RhEmploymentType[] = ["full_time", "part_time"];

export const EMPLOYMENT_TYPE_LABEL: Record<RhEmploymentType, string> = {
  full_time: "Tiempo completo",
  part_time: "Medio tiempo",
};

export interface RhOfficeLocation {
  id: string;
  organization_id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** weekly_plan: { "1": "office", "2": "home_office", ..., "7": null } — ISO weekday (1=Lun..7=Dom), null = descanso */
export type RhWeeklyPlan = Record<string, RhWorkMode | null>;

export interface RhWorkSchedule {
  id: string;
  organization_id: string;
  user_id: string;
  shift_label: string;
  employment_type: RhEmploymentType;
  start_time: string; // "HH:MM:SS"
  end_time: string;
  lunch_start: string;
  lunch_end: string;
  timezone: string;
  default_work_mode: RhWorkMode;
  weekly_plan: RhWeeklyPlan;
  office_location_id: string | null;
  notes: string | null;
  assigned_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface RhAttendance {
  id: string;
  organization_id: string;
  user_id: string;
  work_date: string; // "YYYY-MM-DD"
  check_in_at: string;
  check_out_at: string | null;
  work_mode: RhWorkMode;
  expected_work_mode: RhWorkMode | null;
  check_in_lat: number | null;
  check_in_lng: number | null;
  check_in_accuracy_m: number | null;
  within_geofence: boolean | null;
  office_location_id: string | null;
  check_out_lat: number | null;
  check_out_lng: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/* ====================== Eventos de jornada ====================== */

export type RhEventType =
  | "check_in"
  | "lunch_start"
  | "lunch_end"
  | "break_start"
  | "break_end"
  | "check_out";

export interface RhAttendanceEvent {
  id: string;
  attendance_id: string;
  organization_id: string;
  user_id: string;
  event_type: RhEventType;
  event_at: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  within_geofence: boolean | null;
  office_location_id: string | null;
  created_at: string;
}

/** Duración máxima sugerida de un descanso corto (minutos). */
export const BREAK_MAX_MINUTES = 20;
/** Intervalo mínimo entre descansos cortos (horas). */
export const BREAK_INTERVAL_HOURS = 2;

export type RhJornadaState = "none" | "working" | "lunch" | "break" | "done";

export const JORNADA_STATE_LABEL: Record<RhJornadaState, string> = {
  none: "Sin iniciar",
  working: "En jornada",
  lunch: "En comida",
  break: "En descanso",
  done: "Jornada cerrada",
};

export const WORK_MODE_LABEL: Record<RhWorkMode, string> = {
  office: "Oficina",
  home_office: "Home Office",
  commission: "De comisión",
};

export const WORK_MODE_EMOJI: Record<RhWorkMode, string> = {
  office: "🏢",
  home_office: "🏠",
  commission: "🚶",
};

/** Texto/emoji de estado de Slack por modalidad. */
export const WORK_MODE_SLACK_STATUS: Record<RhWorkMode, { emoji: string; text: string }> = {
  office: { emoji: ":office:", text: "En la oficina" },
  home_office: { emoji: ":house_with_garden:", text: "Home Office" },
  commission: { emoji: ":walking:", text: "De comisión" },
};

/** Etiquetas ISO weekday: 1=Lunes ... 7=Domingo */
export const ISO_WEEKDAYS: { key: string; short: string; long: string }[] = [
  { key: "1", short: "Lun", long: "Lunes" },
  { key: "2", short: "Mar", long: "Martes" },
  { key: "3", short: "Mié", long: "Miércoles" },
  { key: "4", short: "Jue", long: "Jueves" },
  { key: "5", short: "Vie", long: "Viernes" },
  { key: "6", short: "Sáb", long: "Sábado" },
  { key: "7", short: "Dom", long: "Domingo" },
];

/** Devuelve el ISO weekday (1=Lun..7=Dom) de una fecha. */
export function isoWeekday(date = new Date()): string {
  const js = date.getDay(); // 0=Dom..6=Sáb
  return String(js === 0 ? 7 : js);
}

/** Modalidad planificada para hoy según el plan semanal del empleado. */
export function plannedModeForToday(
  schedule: Pick<RhWorkSchedule, "weekly_plan" | "default_work_mode"> | null | undefined,
  date = new Date(),
): RhWorkMode | null {
  if (!schedule) return null;
  const day = isoWeekday(date);
  if (Object.prototype.hasOwnProperty.call(schedule.weekly_plan ?? {}, day)) {
    return schedule.weekly_plan[day]; // puede ser null (descanso)
  }
  return schedule.default_work_mode;
}

/** "HH:MM:SS" o "HH:MM" → "HH:MM" */
export function formatTime(t: string | null | undefined): string {
  if (!t) return "—";
  return t.slice(0, 5);
}

/**
 * Distancia Haversine en metros entre dos coordenadas.
 */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000; // radio terrestre en metros
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface GeoFix {
  lat: number;
  lng: number;
  accuracy: number;
}

/** Obtiene la posición actual del navegador como promesa. */
export function getCurrentPosition(): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Tu navegador no soporta geolocalización."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? "Permiso de ubicación denegado. Actívalo para registrar tu entrada."
            : err.code === err.TIMEOUT
              ? "Se agotó el tiempo para obtener tu ubicación. Intenta de nuevo."
              : "No se pudo obtener tu ubicación.";
        reject(new Error(msg));
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  });
}

/**
 * Determina si una posición cae dentro de alguna oficina activa.
 * Devuelve la oficina más cercana dentro de su radio, o null.
 */
export function matchOffice(
  fix: GeoFix,
  offices: RhOfficeLocation[],
): { office: RhOfficeLocation; distance: number } | null {
  let best: { office: RhOfficeLocation; distance: number } | null = null;
  for (const o of offices) {
    if (!o.is_active) continue;
    const d = distanceMeters(fix.lat, fix.lng, o.latitude, o.longitude);
    if (d <= o.radius_meters && (!best || d < best.distance)) {
      best = { office: o, distance: d };
    }
  }
  return best;
}

export type RhComplianceStatus = "compliant" | "mismatch" | "geofence_fail" | "unknown";

export interface RhComplianceResult {
  status: RhComplianceStatus;
  label: string;
  detail: string;
}

/**
 * Evalúa si el registro cumple con lo planificado por el G4:
 *  - mismatch: la modalidad elegida no coincide con la planificada para hoy.
 *  - geofence_fail: dijo "oficina" pero la geolocalización quedó fuera de toda geocerca.
 *  - compliant: coincide (y, si es oficina, dentro de la geocerca).
 */
export function evaluateCompliance(params: {
  actual: RhWorkMode;
  expected: RhWorkMode | null;
  withinGeofence: boolean | null;
}): RhComplianceResult {
  const { actual, expected, withinGeofence } = params;
  if (actual === "office" && withinGeofence === false) {
    return {
      status: "geofence_fail",
      label: "Fuera de geocerca",
      detail: "Registraste «Oficina» pero tu ubicación quedó fuera del perímetro configurado.",
    };
  }
  if (!expected) {
    return {
      status: "unknown",
      label: "Sin turno asignado",
      detail: "No hay un turno configurado para hoy; el registro no se evalúa.",
    };
  }
  if (actual === expected) {
    return {
      status: "compliant",
      label: "Cumple el turno",
      detail: `Coincide con lo planificado (${WORK_MODE_LABEL[expected]}).`,
    };
  }
  return {
    status: "mismatch",
    label: "No coincide con el turno",
    detail: `Tu turno indicaba ${WORK_MODE_LABEL[expected]} y registraste ${WORK_MODE_LABEL[actual]}.`,
  };
}

export interface JornadaSummary {
  state: RhJornadaState;
  /** ms efectivos trabajados (excluye comida y descansos) */
  workedMs: number;
  /** ms en comida */
  lunchMs: number;
  /** ms en descansos cortos */
  breakMs: number;
  /** Número de descansos cortos tomados hoy */
  breaksTaken: number;
  /** ¿Puede iniciar un descanso corto ahora? (han pasado ≥2h desde el último) */
  canBreak: boolean;
  /** Cuándo estará disponible el próximo descanso (epoch ms), o null si ya. */
  nextBreakAt: number | null;
  /** Marca temporal del inicio de la pausa actual (comida o descanso), si aplica. */
  pauseStartedAt: number | null;
}

/**
 * Reconstruye el estado de la jornada a partir de los eventos ordenados.
 * Calcula tiempo trabajado (descontando pausas) y elegibilidad de descanso.
 */
export function summarizeJornada(
  events: RhAttendanceEvent[],
  now = Date.now(),
): JornadaSummary {
  const empty: JornadaSummary = {
    state: "none",
    workedMs: 0,
    lunchMs: 0,
    breakMs: 0,
    breaksTaken: 0,
    canBreak: false,
    nextBreakAt: null,
    pauseStartedAt: null,
  };
  if (events.length === 0) return empty;

  const sorted = [...events].sort(
    (a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime(),
  );
  const t = (e: RhAttendanceEvent) => new Date(e.event_at).getTime();

  const checkIn = sorted.find((e) => e.event_type === "check_in");
  if (!checkIn) return empty;
  const checkOut = sorted.find((e) => e.event_type === "check_out");

  let state: RhJornadaState = checkOut ? "done" : "working";
  let lunchMs = 0;
  let breakMs = 0;
  let breaksTaken = 0;
  let pauseStartedAt: number | null = null;
  let openPause: { kind: "lunch" | "break"; at: number } | null = null;
  let lastResumeOrStart = t(checkIn);

  for (const e of sorted) {
    switch (e.event_type) {
      case "lunch_start":
        openPause = { kind: "lunch", at: t(e) };
        break;
      case "break_start":
        openPause = { kind: "break", at: t(e) };
        breaksTaken += 1;
        break;
      case "lunch_end":
        if (openPause?.kind === "lunch") {
          lunchMs += t(e) - openPause.at;
          lastResumeOrStart = t(e);
          openPause = null;
        }
        break;
      case "break_end":
        if (openPause?.kind === "break") {
          breakMs += t(e) - openPause.at;
          lastResumeOrStart = t(e);
          openPause = null;
        }
        break;
    }
  }

  if (!checkOut && openPause) {
    state = openPause.kind === "lunch" ? "lunch" : "break";
    pauseStartedAt = openPause.at;
    // pausa abierta: suma el tiempo transcurrido hasta ahora
    if (openPause.kind === "lunch") lunchMs += now - openPause.at;
    else breakMs += now - openPause.at;
  }

  const end = checkOut ? t(checkOut) : now;
  const grossMs = end - t(checkIn);
  const workedMs = Math.max(0, grossMs - lunchMs - breakMs);

  // Descanso corto disponible cada 2h desde el inicio o el último descanso.
  const intervalMs = BREAK_INTERVAL_HOURS * 3600_000;
  const nextBreakAt = lastResumeOrStart + intervalMs;
  const canBreak = state === "working" && now >= nextBreakAt;

  return {
    state,
    workedMs,
    lunchMs,
    breakMs,
    breaksTaken,
    canBreak,
    nextBreakAt: state === "working" && !canBreak ? nextBreakAt : null,
    pauseStartedAt,
  };
}

/** Formatea ms a "Hh Mm". */
export function formatDuration(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return `${h}h ${m}m`;
}

/** Minutos de tiempo extra trabajado respecto al horario del turno (o 0). */
export function overtimeMinutes(
  schedule: Pick<RhWorkSchedule, "start_time" | "end_time"> | null | undefined,
  workedMs: number,
): number {
  if (!schedule) return 0;
  const [sh, sm] = schedule.start_time.split(":").map(Number);
  const [eh, em] = schedule.end_time.split(":").map(Number);
  const scheduledMin = eh * 60 + em - (sh * 60 + sm);
  const workedMin = Math.round(workedMs / 60000);
  return Math.max(0, workedMin - scheduledMin);
}

/** Duración legible entre check-in y check-out (o ahora). */
export function workedDuration(checkIn: string, checkOut: string | null): string {
  const start = new Date(checkIn).getTime();
  const end = checkOut ? new Date(checkOut).getTime() : Date.now();
  const mins = Math.max(0, Math.round((end - start) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return `${h}h ${m}m`;
}
