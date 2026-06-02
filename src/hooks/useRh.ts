import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { invokeSlackApi } from "@/lib/slackApi";
import {
  WORK_MODE_SLACK_STATUS,
  getCurrentPosition,
  matchOffice,
  plannedModeForToday,
  summarizeJornada,
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
async function syncSlackStatus(mode: RhWorkMode | null): Promise<void> {
  try {
    if (mode === null) {
      await invokeSlackApi({ action: "users.profile.set", clear_status: true });
      return;
    }
    const s = WORK_MODE_SLACK_STATUS[mode];
    // Expira al final del día (medianoche local) para no dejar el estado pegado.
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 0, 0);
    await invokeSlackApi({
      action: "users.profile.set",
      profile: {
        status_text: s.text,
        status_emoji: s.emoji,
        status_expiration: Math.floor(endOfDay.getTime() / 1000),
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
        await syncSlackStatus(null);
      } else if (action.type === "check_in") {
        await syncSlackStatus(action.workMode);
      }

      return action.type;
    },
    onSuccess: (type) => {
      invalidate();
      toast.success(ACTION_TOAST[type]);
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo registrar el evento"),
  });

  const summary = summarizeJornada(events);

  return {
    session: session ?? null,
    events,
    schedule: schedule ?? null,
    summary,
    isPending: mutation.isPending,
    act: mutation.mutate,
  };
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
