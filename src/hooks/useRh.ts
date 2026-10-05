import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { invokeSlackApi } from "@/lib/slackApi";
import {
  WORK_MODE_SLACK_STATUS,
  PAUSE_SLACK_STATUS,
  TRANSIT_SLACK_STATUS,
  getCurrentPosition,
  matchOffice,
  plannedModeForToday,
  summarizeJornadaWithSession,
  type SlackStatus,
  type RhAbsenceRequest,
  type RhAbsenceType,
  type RhDayPart,
  type RhAttendance,
  type RhAttendanceEvent,
  type RhEmploymentType,
  type RhEventType,
  type RhOfficeLocation,
  type RhWeeklyPlan,
  type RhWorkMode,
  type RhWorkSchedule,
  type GeoFix,
} from "@/lib/rh";
import { startOfDayMxISO, toDateStringMX } from "@/lib/dateUtils";

/** Tabla sin tipos generados aún: usamos el cast establecido en el repo. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

async function getMyOrgId(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data?.organization_id) {
    throw new Error("No se pudo determinar tu organización.");
  }
  return data.organization_id as string;
}

/** Día laboral RH = calendario América/Mexico_City (alineado con BD). */
const todayKey = () => toDateStringMX();

/** Medianoche CDMX en ISO — filtro de eventos de hoy. */
const startOfTodayISO = () => startOfDayMxISO();

/** Mensaje legible desde errores de PostgREST / RPC / Error nativo. */
function rhErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    const m = err.message;
    if (/not_authenticated/i.test(m)) return "Tu sesión expiró. Vuelve a iniciar sesión.";
    if (/no_organization/i.test(m)) return "No se pudo determinar tu organización.";
    return m;
  }
  if (err && typeof err === "object") {
    const o = err as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [o.message, o.details, o.hint].filter((x) => typeof x === "string" && x.trim());
    if (parts.length) return (parts as string[]).join(" — ");
    if (typeof o.code === "string" && o.code) return `${fallback} (${o.code})`;
  }
  return fallback;
}

/** Errores de Slack que indican que el token del usuario ya no sirve. */
const SLACK_STATUS_FATAL_RE =
  /token_revoked|invalid_auth|not_authed|account_inactive|not_allowed_token|slack_not_connected/i;

/** Aviso una sola vez por carga de página para no repetir el toast. */
let slackAuthWarned = false;

/**
 * Refleja la modalidad de trabajo como estado de Slack del propio usuario.
 * Best-effort: si Slack no está conectado o falla, no interrumpe el check-in.
 */
async function syncSlackStatus(status: SlackStatus | null): Promise<void> {
  try {
    if (status === null) {
      await invokeSlackApi({ action: "users.profile.set", clear_status: true });
      return;
    }
    // Todos los estados expiran al fin del día: durante la jornada el usuario
    // (y el cron de sync) los mantiene al día, y si alguno queda pegado (p. ej.
    // olvidó terminar la comida o el cierre forzado de medianoche) se limpia
    // solo en vez de quedar "Comiendo" para siempre.
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 0, 0);
    await invokeSlackApi({
      action: "users.profile.set",
      profile: {
        status_text: status.text,
        status_emoji: status.emoji,
        status_expiration: Math.floor(endOfDay.getTime() / 1000),
      },
    });
  } catch (e) {
    // Silencioso: el estado de Slack es complementario al registro de RH.
    // Pero si el token murió conviene avisar una vez para que reconecte.
    if (!slackAuthWarned && e instanceof Error && SLACK_STATUS_FATAL_RE.test(e.message)) {
      slackAuthWarned = true;
      toast.warning(
        "Tu conexión de Slack caducó: tu estado ya no se actualizará. Reconéctalo desde Comunicación.",
        { duration: 15_000 },
      );
    }
  }
}

/* ============================================================
 * Empleado: mi turno
 * ========================================================== */
export function useMyWorkSchedule() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-my-schedule", user?.id],
    queryFn: async (): Promise<RhWorkSchedule | null> => {
      const { data, error } = await db
        .from("rh_work_schedules")
        .select("*")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as RhWorkSchedule | null) ?? null;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

/* ============================================================
 * Empleado: asistencia de hoy + historial
 * ========================================================== */
export function useTodayAttendance() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-today-attendance", user?.id, todayKey()],
    queryFn: async (): Promise<RhAttendance | null> => {
      const { data, error } = await db
        .from("rh_attendance")
        .select("*")
        .eq("user_id", user!.id)
        .eq("work_date", todayKey())
        .order("check_in_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as RhAttendance | null) ?? null;
    },
    enabled: !!user,
  });
}

export function useMyAttendance(limit = 30) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-my-attendance", user?.id, limit],
    queryFn: async (): Promise<RhAttendance[]> => {
      const { data, error } = await db
        .from("rh_attendance")
        .select("*")
        .eq("user_id", user!.id)
        .order("check_in_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data as RhAttendance[]) ?? [];
    },
    enabled: !!user,
  });
}

/* ============================================================
 * Eventos de jornada (punches) de hoy
 * ========================================================== */
export function useTodayEvents() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-today-events", user?.id, todayKey()],
    queryFn: async (): Promise<RhAttendanceEvent[]> => {
      const { data, error } = await db
        .from("rh_attendance_events")
        .select("*")
        .eq("user_id", user!.id)
        .gte("event_at", startOfTodayISO())
        .order("event_at", { ascending: true });
      if (error) throw error;
      return (data as RhAttendanceEvent[]) ?? [];
    },
    enabled: !!user,
  });
}

/** Captura ubicación (siempre) y resuelve geocerca para la modalidad dada. */
async function captureGeo(workMode: RhWorkMode, offices: RhOfficeLocation[]) {
  let fix: GeoFix | null = null;
  let withinGeofence: boolean | null = null;
  let officeLocationId: string | null = null;
  try {
    fix = await getCurrentPosition();
    if (offices.length > 0) {
      const m = matchOffice(fix, offices);
      officeLocationId = m?.office.id ?? null;
      if (workMode === "office") withinGeofence = !!m;
    }
  } catch {
    if (workMode === "office" && offices.length > 0) withinGeofence = false;
  }
  return { fix, withinGeofence, officeLocationId };
}

export type JornadaAction =
  | { type: "check_in"; workMode: RhWorkMode }
  | { type: "change_mode"; workMode: RhWorkMode }
  | { type: "lunch_start" }
  | { type: "lunch_end" }
  | { type: "break_start" }
  | { type: "break_end" }
  | { type: "check_out" };

const ACTION_TOAST: Record<RhEventType, string> = {
  check_in: "Jornada iniciada",
  lunch_start: "¡Buen provecho! Comida iniciada",
  lunch_end: "De vuelta de comer",
  break_start: "Descanso iniciado (20 min)",
  break_end: "De vuelta del descanso",
  check_out: "Jornada cerrada",
};

/**
 * Hook integral de jornada: estado actual + acciones (entrada, comida,
 * descansos, salida). Cada acción guarda ubicación y, en entrada/salida,
 * sincroniza el estado de Slack.
 */
export function useJornada() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const attendanceQ = useTodayAttendance();
  const eventsQ = useTodayEvents();
  const { data: session } = attendanceQ;
  const { data: events = [] } = eventsQ;
  const { data: schedule } = useMyWorkSchedule();
  const { data: offices = [] } = useOfficeLocations();

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["rh-today-attendance"] });
    void qc.invalidateQueries({ queryKey: ["rh-today-events"] });
    void qc.invalidateQueries({ queryKey: ["rh-my-attendance"] });
    void qc.invalidateQueries({ queryKey: ["rh-org-attendance"] });
  };

  const seedCachesAfterCheckIn = (attendance: RhAttendance) => {
    const day = todayKey();
    qc.setQueryData(["rh-today-attendance", user?.id, day], attendance);
    const prev = (qc.getQueryData(["rh-today-events", user?.id, day]) as RhAttendanceEvent[] | undefined) ?? [];
    const hasCheckIn = prev.some(
      (e) => e.attendance_id === attendance.id && e.event_type === "check_in",
    );
    if (!hasCheckIn) {
      const seed: RhAttendanceEvent = {
        id: `local-check-in-${attendance.id}`,
        attendance_id: attendance.id,
        organization_id: attendance.organization_id,
        user_id: attendance.user_id,
        event_type: "check_in",
        event_at: attendance.check_in_at,
        lat: attendance.check_in_lat,
        lng: attendance.check_in_lng,
        accuracy_m: attendance.check_in_accuracy_m,
        within_geofence: attendance.within_geofence,
        office_location_id: attendance.office_location_id,
        created_at: attendance.check_in_at,
      };
      qc.setQueryData(["rh-today-events", user?.id, day], [...prev, seed]);
    }
  };

  const mutation = useMutation({
    mutationFn: async (action: JornadaAction) => {
      const orgId = await getMyOrgId(user!.id);
      const workMode =
        action.type === "check_in" || action.type === "change_mode"
          ? action.workMode
          : session?.work_mode ?? "office";
      const geo = await captureGeo(workMode, offices);

      // Cambiar la modalidad en curso (dónde estás) sin abrir un evento nuevo:
      // actualiza la jornada activa y refleja el estado en Slack al instante.
      if (action.type === "change_mode") {
        if (!session?.id) throw new Error("No hay una jornada activa.");
        const { error } = await db
          .from("rh_attendance")
          .update({
            work_mode: action.workMode,
            within_geofence: geo.withinGeofence,
            office_location_id: geo.officeLocationId,
          })
          .eq("id", session.id)
          .eq("user_id", user!.id);
        if (error) throw error;
        // Si va en trayecto, ese estado manda; si no, refleja la nueva modalidad.
        await syncSlackStatus(
          session.in_transit ? TRANSIT_SLACK_STATUS : WORK_MODE_SLACK_STATUS[action.workMode],
        );
        return { type: action.type as JornadaAction["type"], alreadyActive: false };
      }

      // Entrada: RPC atómica e idempotente (attendance + punch en una txn).
      if (action.type === "check_in") {
        const expected = plannedModeForToday(schedule);
        const { data, error } = await db.rpc("rh_start_jornada", {
          p_work_mode: action.workMode,
          p_expected_work_mode: expected,
          p_lat: geo.fix?.lat ?? null,
          p_lng: geo.fix?.lng ?? null,
          p_accuracy_m: geo.fix?.accuracy ?? null,
          p_within_geofence: geo.withinGeofence,
          p_office_location_id: geo.officeLocationId,
        });
        if (error) throw error;
        const payload = data as {
          attendance?: RhAttendance;
          already_active?: boolean;
          created?: boolean;
        } | null;
        const attendance = payload?.attendance;
        if (!attendance?.id) {
          throw new Error("No se pudo iniciar la jornada. Intenta de nuevo.");
        }
        seedCachesAfterCheckIn(attendance);
        await syncSlackStatus(WORK_MODE_SLACK_STATUS[action.workMode]);
        return {
          type: "check_in" as const,
          alreadyActive: !!payload?.already_active,
        };
      }

      let attendanceId = session?.id ?? null;
      if (!attendanceId) throw new Error("No hay una jornada activa.");

      const { error: evErr } = await db.from("rh_attendance_events").insert({
        attendance_id: attendanceId,
        organization_id: orgId,
        user_id: user!.id,
        event_type: action.type,
        event_at: new Date().toISOString(),
        lat: geo.fix?.lat ?? null,
        lng: geo.fix?.lng ?? null,
        accuracy_m: geo.fix?.accuracy ?? null,
        within_geofence: geo.withinGeofence,
        office_location_id: geo.officeLocationId,
      });
      if (evErr) throw evErr;

      if (action.type === "check_out") {
        const { error: outErr } = await db
          .from("rh_attendance")
          .update({
            check_out_at: new Date().toISOString(),
            check_out_lat: geo.fix?.lat ?? null,
            check_out_lng: geo.fix?.lng ?? null,
          })
          .eq("id", attendanceId)
          .eq("user_id", user!.id);
        if (outErr) throw outErr;
      }

      // Refleja el estado en Slack según la acción (no bloqueante).
      let slack: SlackStatus | null;
      switch (action.type) {
        case "lunch_start":
          slack = PAUSE_SLACK_STATUS.lunch;
          break;
        case "break_start":
          slack = PAUSE_SLACK_STATUS.break;
          break;
        case "lunch_end":
        case "break_end":
          slack = WORK_MODE_SLACK_STATUS[workMode];
          break;
        case "check_out":
        default:
          slack = null;
      }
      await syncSlackStatus(slack);

      return { type: action.type, alreadyActive: false };
    },
    onSuccess: (result) => {
      invalidate();
      if (result.type === "change_mode") {
        toast.success("Modalidad actualizada");
        return;
      }
      if (result.type === "check_in" && result.alreadyActive) {
        toast.success("Tu jornada ya estaba activa");
        return;
      }
      toast.success(ACTION_TOAST[result.type as RhEventType] ?? "Listo");
    },
    onError: (e: unknown) => toast.error(rhErrorMessage(e, "No se pudo registrar el evento")),
  });

  // Acota los eventos a la jornada (sesión) actual: si hoy se inició una
  // nueva jornada tras cerrar la anterior, solo cuenta la más reciente.
  // Si la sesión existe pero los eventos aún no cargan, el fallback evita
  // mostrar "Sin iniciar" sobre una jornada realmente abierta.
  const sessionEvents = session
    ? events.filter((e) => e.attendance_id === session.id)
    : [];
  const summary = summarizeJornadaWithSession(session ?? null, events);

  const queriesLoading =
    (!!user && attendanceQ.isLoading) || (!!user && eventsQ.isLoading);
  const queriesError = !!(attendanceQ.isError || eventsQ.isError);

  return {
    session: session ?? null,
    events: sessionEvents,
    schedule: schedule ?? null,
    summary,
    isPending: mutation.isPending || queriesLoading,
    isLoading: queriesLoading,
    isError: queriesError,
    refetch: () => {
      void attendanceQ.refetch();
      void eventsQ.refetch();
    },
    act: mutation.mutate,
  };
}

/**
 * Estado "en trayecto" (🚗): no es una pausa de la jornada, solo refleja en
 * Slack que la persona va en movimiento. Al apagarlo, restaura el estado de
 * la modalidad actual.
 */
export function useTransitStatus() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ on, workMode, attendanceId }: { on: boolean; workMode: RhWorkMode; attendanceId?: string | null }) => {
      // Persiste la señal (fuente de verdad compartida por la tarjeta y el menú rápido).
      if (attendanceId) {
        await db.from("rh_attendance").update({ in_transit: on }).eq("id", attendanceId).eq("user_id", user!.id);
      }
      await syncSlackStatus(on ? TRANSIT_SLACK_STATUS : WORK_MODE_SLACK_STATUS[workMode]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-today-attendance"] });
      qc.invalidateQueries({ queryKey: ["rh-org-attendance"] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar el estado"),
  });
}

/* ============================================================
 * Oficinas (geocerca) — lectura para todos, gestión G4
 * ========================================================== */
export function useOfficeLocations() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-office-locations"],
    queryFn: async (): Promise<RhOfficeLocation[]> => {
      const { data, error } = await db
        .from("rh_office_locations")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as RhOfficeLocation[]) ?? [];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

export interface OfficeLocationInput {
  id?: string;
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active?: boolean;
}

export function useSaveOfficeLocation() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: OfficeLocationInput) => {
      const orgId = await getMyOrgId(user!.id);
      if (input.id) {
        const { error } = await db
          .from("rh_office_locations")
          .update({
            name: input.name,
            address: input.address ?? null,
            latitude: input.latitude,
            longitude: input.longitude,
            radius_meters: input.radius_meters,
            is_active: input.is_active ?? true,
          })
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("rh_office_locations").insert({
          organization_id: orgId,
          created_by: user!.id,
          name: input.name,
          address: input.address ?? null,
          latitude: input.latitude,
          longitude: input.longitude,
          radius_meters: input.radius_meters,
          is_active: input.is_active ?? true,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-office-locations"] });
      toast.success("Oficina guardada");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo guardar la oficina"),
  });
}

/* ============================================================
 * Turnos del equipo (G4)
 * ========================================================== */
export function useOrgSchedules() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-org-schedules"],
    queryFn: async (): Promise<RhWorkSchedule[]> => {
      const { data, error } = await db.from("rh_work_schedules").select("*");
      if (error) throw error;
      return (data as RhWorkSchedule[]) ?? [];
    },
    enabled: !!user,
  });
}

export interface ScheduleInput {
  user_id: string;
  shift_label: string;
  employment_type: RhEmploymentType;
  start_time: string;
  end_time: string;
  lunch_start: string;
  lunch_end: string;
  timezone?: string;
  default_work_mode: RhWorkMode;
  weekly_plan: RhWeeklyPlan;
  office_location_id?: string | null;
  notes?: string | null;
}

export function useSaveSchedule() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ScheduleInput) => {
      const orgId = await getMyOrgId(user!.id);
      const { error } = await db.from("rh_work_schedules").upsert(
        {
          organization_id: orgId,
          user_id: input.user_id,
          shift_label: input.shift_label,
          employment_type: input.employment_type,
          start_time: input.start_time,
          end_time: input.end_time,
          lunch_start: input.lunch_start,
          lunch_end: input.lunch_end,
          timezone: input.timezone ?? "America/Mexico_City",
          default_work_mode: input.default_work_mode,
          weekly_plan: input.weekly_plan,
          office_location_id: input.office_location_id ?? null,
          notes: input.notes ?? null,
          assigned_by: user!.id,
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-org-schedules"] });
      qc.invalidateQueries({ queryKey: ["rh-my-schedule"] });
      toast.success("Turno guardado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo guardar el turno"),
  });
}

/* ============================================================
 * Asistencia del equipo (G4)
 * ========================================================== */
/** Eventos de jornada de toda la organización para hoy (solo G4 por RLS). */
export function useOrgEventsToday() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-org-events", todayKey()],
    queryFn: async (): Promise<RhAttendanceEvent[]> => {
      const { data, error } = await db
        .from("rh_attendance_events")
        .select("*")
        .gte("event_at", startOfTodayISO())
        .order("event_at", { ascending: true });
      if (error) throw error;
      return (data as RhAttendanceEvent[]) ?? [];
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });
}

export function useOrgAttendance(workDate?: string) {
  const { user } = useAuth();
  const date = workDate ?? todayKey();
  return useQuery({
    queryKey: ["rh-org-attendance", date],
    queryFn: async (): Promise<RhAttendance[]> => {
      const { data, error } = await db
        .from("rh_attendance")
        .select("*")
        .eq("work_date", date)
        .order("check_in_at", { ascending: false });
      if (error) throw error;
      return (data as RhAttendance[]) ?? [];
    },
    enabled: !!user,
  });
}

/** G4: jornadas del equipo en un rango de fechas (opcionalmente de un colaborador). */
export function useOrgAttendanceRange(from: string, to: string, userId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-org-attendance-range", from, to, userId ?? "all"],
    queryFn: async (): Promise<RhAttendance[]> => {
      let q = db.from("rh_attendance").select("*").gte("work_date", from).lte("work_date", to);
      if (userId) q = q.eq("user_id", userId);
      const { data, error } = await q
        .order("work_date", { ascending: false })
        .order("check_in_at", { ascending: true });
      if (error) throw error;
      return (data as RhAttendance[]) ?? [];
    },
    enabled: !!user && !!from && !!to,
  });
}

/* ============================================================
 * Corrección de salida (jornadas cerradas a la fuerza)
 * ========================================================== */
/** Mis jornadas cerradas a la fuerza que esperan que declare mi salida. */
export function useMyPendingCheckouts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-my-pending-checkouts", user?.id],
    queryFn: async (): Promise<RhAttendance[]> => {
      const { data, error } = await db
        .from("rh_attendance")
        .select("*")
        .eq("user_id", user!.id)
        .eq("checkout_review", "pending_user")
        .order("work_date", { ascending: true });
      if (error) throw error;
      return (data as RhAttendance[]) ?? [];
    },
    enabled: !!user,
  });
}

/** Declara la hora aproximada de salida -> pasa a aprobación de G4. */
export function useProposeCheckout() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, proposedAt }: { id: string; proposedAt: string }) => {
      const { error } = await db
        .from("rh_attendance")
        .update({ proposed_check_out_at: proposedAt, checkout_review: "pending_g4" })
        .eq("id", id)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-my-pending-checkouts"] });
      qc.invalidateQueries({ queryKey: ["rh-checkout-approvals"] });
      toast.success("Salida enviada para aprobación de G4");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo enviar"),
  });
}

/** G4: jornadas con salida propuesta pendiente de aprobar. */
export function useCheckoutApprovals(enabled: boolean) {
  return useQuery({
    queryKey: ["rh-checkout-approvals"],
    queryFn: async (): Promise<RhAttendance[]> => {
      const { data, error } = await db
        .from("rh_attendance")
        .select("*")
        .eq("checkout_review", "pending_g4")
        .order("work_date", { ascending: true });
      if (error) throw error;
      return (data as RhAttendance[]) ?? [];
    },
    enabled,
  });
}

/** G4 aprueba (fija la hora real) o rechaza (vuelve a pedir la salida). */
export function useDecideCheckout() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ row, approve }: { row: RhAttendance; approve: boolean }) => {
      const patch = approve
        ? {
            check_out_at: row.proposed_check_out_at,
            checkout_review: "approved",
            checkout_reviewed_by: user!.id,
            checkout_reviewed_at: new Date().toISOString(),
          }
        : { checkout_review: "pending_user", proposed_check_out_at: null };
      const { error } = await db.from("rh_attendance").update(patch).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-checkout-approvals"] });
      qc.invalidateQueries({ queryKey: ["rh-org-attendance"] });
      toast.success("Listo");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo procesar"),
  });
}

/* ============================================================
 * Corrección de la hora de ENTRADA (aprueba el G4 de la célula)
 * ========================================================== */
/** El colaborador propone su hora real de entrada -> aprobación del G4 de su célula. */
export function useProposeCheckinCorrection() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, proposedAt, note }: { id: string; proposedAt: string; note?: string | null }) => {
      const { error } = await db
        .from("rh_attendance")
        .update({
          proposed_check_in_at: proposedAt,
          checkin_review: "pending_g4",
          checkin_note: note ?? null,
          checkin_reviewed_by: null,
          checkin_reviewed_at: null,
        })
        .eq("id", id)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-my-attendance"] });
      qc.invalidateQueries({ queryKey: ["rh-checkin-approvals"] });
      toast.success("Corrección de entrada enviada a tu G4");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo enviar la corrección"),
  });
}

/** G4: correcciones de entrada pendientes de los miembros de las células que lidera. */
export function useCheckinApprovals(enabled: boolean) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-checkin-approvals", user?.id],
    queryFn: async (): Promise<RhAttendance[]> => {
      // Células que lidera este G4.
      const { data: cels } = await db
        .from("celulas")
        .select("id")
        .eq("responsible_user_id", user!.id)
        .eq("is_active", true);
      const celIds = (cels ?? []).map((c: { id: string }) => c.id);
      if (celIds.length === 0) return [];
      // Miembros de esas células.
      const { data: members } = await db.from("user_celulas").select("user_id").in("celula_id", celIds);
      const memberIds = [...new Set((members ?? []).map((m: { user_id: string }) => m.user_id))];
      if (memberIds.length === 0) return [];
      // Correcciones de entrada pendientes de esos miembros.
      const { data, error } = await db
        .from("rh_attendance")
        .select("*")
        .eq("checkin_review", "pending_g4")
        .in("user_id", memberIds)
        .order("work_date", { ascending: true });
      if (error) throw error;
      return (data as RhAttendance[]) ?? [];
    },
    enabled,
  });
}

/** G4 aprueba (fija la hora de entrada propuesta) o rechaza la corrección. */
export function useDecideCheckinCorrection() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ row, approve }: { row: RhAttendance; approve: boolean }) => {
      const patch = approve
        ? {
            check_in_at: row.proposed_check_in_at,
            checkin_review: "approved",
            checkin_reviewed_by: user!.id,
            checkin_reviewed_at: new Date().toISOString(),
          }
        : {
            checkin_review: "rejected",
            checkin_reviewed_by: user!.id,
            checkin_reviewed_at: new Date().toISOString(),
            proposed_check_in_at: null,
          };
      const { error } = await db.from("rh_attendance").update(patch).eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-checkin-approvals"] });
      qc.invalidateQueries({ queryKey: ["rh-org-attendance"] });
      qc.invalidateQueries({ queryKey: ["rh-my-attendance"] });
      toast.success("Listo");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo procesar"),
  });
}

/* ============================================================
 * Células y solicitudes de ausencias (Entrega 3)
 * ========================================================== */
export interface Celula {
  id: string;
  name: string;
  slug: string;
  responsible_user_id: string | null;
}

/** Células a las que pertenece el usuario actual. */
export function useMyCelulas() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-my-celulas", user?.id],
    queryFn: async (): Promise<Celula[]> => {
      const { data, error } = await db
        .from("user_celulas")
        .select("celula:celulas(id, name, slug, responsible_user_id)")
        .eq("user_id", user!.id);
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((data ?? []) as any[]).map((r) => r.celula).filter(Boolean) as Celula[];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

/** Células de las que el usuario actual es responsable (G4 líder). */
export function useMyResponsibleCelulas() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-responsible-celulas", user?.id],
    queryFn: async (): Promise<Celula[]> => {
      const { data, error } = await db
        .from("celulas")
        .select("id, name, slug, responsible_user_id")
        .eq("responsible_user_id", user!.id)
        .eq("is_active", true);
      if (error) throw error;
      return (data as Celula[]) ?? [];
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

export function useMyAbsenceRequests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-my-absences", user?.id],
    queryFn: async (): Promise<RhAbsenceRequest[]> => {
      const { data, error } = await db
        .from("rh_absence_requests")
        .select("*")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as RhAbsenceRequest[]) ?? [];
    },
    enabled: !!user,
  });
}

/** Solicitudes/permisos de un colaborador (para su expediente).
 *  RLS: visible para el propio usuario, el responsable de su célula o un G4. */
export function useUserAbsenceRequests(userId: string | null) {
  return useQuery({
    queryKey: ["rh-user-absences", userId],
    enabled: !!userId,
    queryFn: async (): Promise<RhAbsenceRequest[]> => {
      const { data, error } = await db
        .from("rh_absence_requests")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as RhAbsenceRequest[]) ?? [];
    },
  });
}

/** Solicitudes de las células que el usuario aprueba (responsable). */
export function useCelulaAbsenceRequests(celulaIds: string[]) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-celula-absences", celulaIds.slice().sort().join(",")],
    queryFn: async (): Promise<RhAbsenceRequest[]> => {
      if (celulaIds.length === 0) return [];
      const { data, error } = await db
        .from("rh_absence_requests")
        .select("*")
        .in("celula_id", celulaIds)
        .neq("user_id", user!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as RhAbsenceRequest[]) ?? [];
    },
    enabled: !!user && celulaIds.length > 0,
  });
}

export interface AbsenceRequestInput {
  absence_type: RhAbsenceType;
  start_date: string;
  end_date: string;
  day_part: RhDayPart;
  celula_id: string | null;
  reason?: string | null;
}

export function useCreateAbsenceRequest() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: AbsenceRequestInput) => {
      const orgId = await getMyOrgId(user!.id);
      const { data, error } = await db.from("rh_absence_requests").insert({
        user_id: user!.id,
        organization_id: orgId,
        celula_id: input.celula_id,
        absence_type: input.absence_type,
        start_date: input.start_date,
        end_date: input.end_date,
        day_part: input.day_part,
        reason: input.reason ?? null,
        status: "pending",
      }).select("id").single();
      if (error) throw error;

      // Aviso por Slack al G4 responsable (solo burnout y permiso). Best-effort:
      // no bloquea ni revierte la solicitud si Slack falla.
      if (data?.id && (input.absence_type === "burnout" || input.absence_type === "permiso")) {
        db.functions
          .invoke("rh-absence-slack-notify", { body: { request_id: data.id } })
          .catch((e: unknown) => console.error("Slack RH notify failed:", e));
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-my-absences"] });
      qc.invalidateQueries({ queryKey: ["rh-approved-absences"] });
      if (vars.absence_type === "burnout") {
        toast.success("Día de burnout aprobado al instante");
      } else {
        toast.success("Solicitud enviada para aprobación");
      }
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo enviar la solicitud"),
  });
}

export function useCancelAbsenceRequest() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db
        .from("rh_absence_requests")
        .update({ status: "cancelled" })
        .eq("id", id)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-my-absences"] });
      toast.success("Solicitud cancelada");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo cancelar"),
  });
}

export function useDecideAbsenceRequest() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      decision,
      note,
    }: {
      id: string;
      decision: "approved" | "rejected";
      note?: string | null;
    }) => {
      const { error } = await db
        .from("rh_absence_requests")
        .update({
          status: decision,
          approver_user_id: user!.id,
          decided_at: new Date().toISOString(),
          decision_note: note ?? null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-celula-absences"] });
      qc.invalidateQueries({ queryKey: ["rh-approvable-absences"] });
      qc.invalidateQueries({ queryKey: ["rh-my-absences"] });
      toast.success(vars.decision === "approved" ? "Solicitud aprobada" : "Solicitud rechazada");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo registrar la decisión"),
  });
}

/**
 * Solicitudes que me toca aprobar: las asignadas a mí (responsable de la célula
 * del solicitante o aprobador por defecto) más las que quedaron sin asignar
 * (red de seguridad para G4). Nunca las propias.
 */
export function useApprovableAbsenceRequests() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-approvable-absences", user?.id],
    queryFn: async (): Promise<RhAbsenceRequest[]> => {
      const { data, error } = await db
        .from("rh_absence_requests")
        .select("*")
        .neq("user_id", user!.id)
        .or(`assigned_approver_user_id.eq.${user!.id},assigned_approver_user_id.is.null`)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data as RhAbsenceRequest[]) ?? [];
    },
    enabled: !!user,
  });
}

/** Ausencias aprobadas visibles (G4: toda la org; otros: propias) — para calendario y "ausentes hoy". */
export function useApprovedAbsences() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["rh-approved-absences", user?.id],
    queryFn: async (): Promise<RhAbsenceRequest[]> => {
      const { data, error } = await db
        .from("rh_absence_requests")
        .select("*")
        .eq("status", "approved")
        .order("start_date", { ascending: true });
      if (error) throw error;
      return (data as RhAbsenceRequest[]) ?? [];
    },
    enabled: !!user,
    staleTime: 2 * 60 * 1000,
  });
}
