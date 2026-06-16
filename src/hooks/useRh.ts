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
  summarizeJornada,
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

const todayKey = () => {
  // Fecha local del navegador en formato YYYY-MM-DD
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

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
    // Comida/descanso/trayecto NO expiran solos: el usuario los termina
    // manualmente (p. ej. comida con cliente sigue ocupado). El resto expira
    // al final del día para no dejar el estado pegado.
    const noExpire =
      status === PAUSE_SLACK_STATUS.lunch ||
      status === PAUSE_SLACK_STATUS.break ||
      status === TRANSIT_SLACK_STATUS;
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 0, 0);
    await invokeSlackApi({
      action: "users.profile.set",
      profile: {
        status_text: status.text,
        status_emoji: status.emoji,
        status_expiration: noExpire ? 0 : Math.floor(endOfDay.getTime() / 1000),
      },
    });
  } catch {
    // Silencioso: el estado de Slack es complementario al registro de RH.
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
const startOfTodayISO = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

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
  const { data: session } = useTodayAttendance();
  const { data: events = [] } = useTodayEvents();
  const { data: schedule } = useMyWorkSchedule();
  const { data: offices = [] } = useOfficeLocations();

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["rh-today-attendance"] });
    qc.invalidateQueries({ queryKey: ["rh-today-events"] });
    qc.invalidateQueries({ queryKey: ["rh-my-attendance"] });
    qc.invalidateQueries({ queryKey: ["rh-org-attendance"] });
  };

  const mutation = useMutation({
    mutationFn: async (action: JornadaAction) => {
      const orgId = await getMyOrgId(user!.id);
      const workMode =
        action.type === "check_in" ? action.workMode : session?.work_mode ?? "office";
      const geo = await captureGeo(workMode, offices);

      let attendanceId = session?.id ?? null;

      if (action.type === "check_in") {
        const expected = plannedModeForToday(schedule);
        // ¿Ya hubo una jornada hoy? Entonces este es un turno adicional (sin comida).
        const { count } = await db
          .from("rh_attendance")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user!.id)
          .eq("work_date", todayKey());
        const isAdditional = (count ?? 0) > 0;
        const { data, error } = await db
          .from("rh_attendance")
          .insert({
            user_id: user!.id,
            organization_id: orgId,
            work_date: todayKey(),
            check_in_at: new Date().toISOString(),
            work_mode: action.workMode,
            expected_work_mode: expected,
            check_in_lat: geo.fix?.lat ?? null,
            check_in_lng: geo.fix?.lng ?? null,
            check_in_accuracy_m: geo.fix?.accuracy ?? null,
            within_geofence: geo.withinGeofence,
            office_location_id: geo.officeLocationId,
            is_additional_shift: isAdditional,
          })
          .select("id")
          .single();
        if (error) throw error;
        attendanceId = data.id as string;
      }

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
        await db
          .from("rh_attendance")
          .update({
            check_out_at: new Date().toISOString(),
            check_out_lat: geo.fix?.lat ?? null,
            check_out_lng: geo.fix?.lng ?? null,
          })
          .eq("id", attendanceId)
          .eq("user_id", user!.id);
      }

      // Refleja el estado en Slack según la acción (no bloqueante).
      let slack: SlackStatus | null;
      switch (action.type) {
        case "check_in":
          slack = WORK_MODE_SLACK_STATUS[action.workMode];
          break;
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

      return action.type;
    },
    onSuccess: (type) => {
      invalidate();
      toast.success(ACTION_TOAST[type]);
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo registrar el evento"),
  });

  // Acota los eventos a la jornada (sesión) actual: si hoy se inició una
  // nueva jornada tras cerrar la anterior, solo cuenta la más reciente.
  const sessionEvents = session
    ? events.filter((e) => e.attendance_id === session.id)
    : [];
  const summary = summarizeJornada(sessionEvents);

  return {
    session: session ?? null,
    events: sessionEvents,
    schedule: schedule ?? null,
    summary,
    isPending: mutation.isPending,
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
