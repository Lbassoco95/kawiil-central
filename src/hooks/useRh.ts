import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { invokeSlackApi } from "@/lib/slackApi";
import {
  WORK_MODE_SLACK_STATUS,
  type RhAttendance,
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

export interface CheckInPayload {
  workMode: RhWorkMode;
  expectedWorkMode: RhWorkMode | null;
  fix: GeoFix | null;
  withinGeofence: boolean | null;
  officeLocationId: string | null;
  notes?: string | null;
}

export function useCheckIn() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CheckInPayload) => {
      const orgId = await getMyOrgId(user!.id);
      const { error } = await db.from("rh_attendance").insert({
        user_id: user!.id,
        organization_id: orgId,
        work_date: todayKey(),
        check_in_at: new Date().toISOString(),
        work_mode: payload.workMode,
        expected_work_mode: payload.expectedWorkMode,
        check_in_lat: payload.fix?.lat ?? null,
        check_in_lng: payload.fix?.lng ?? null,
        check_in_accuracy_m: payload.fix?.accuracy ?? null,
        within_geofence: payload.withinGeofence,
        office_location_id: payload.officeLocationId,
        notes: payload.notes ?? null,
      });
      if (error) throw error;
      // Refleja el estado en Slack para que el equipo lo vea (no bloqueante).
      await syncSlackStatus(payload.workMode);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-today-attendance"] });
      qc.invalidateQueries({ queryKey: ["rh-my-attendance"] });
      qc.invalidateQueries({ queryKey: ["rh-org-attendance"] });
      toast.success("Entrada registrada");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo registrar la entrada"),
  });
}

export function useCheckOut() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, fix }: { id: string; fix: GeoFix | null }) => {
      const { error } = await db
        .from("rh_attendance")
        .update({
          check_out_at: new Date().toISOString(),
          check_out_lat: fix?.lat ?? null,
          check_out_lng: fix?.lng ?? null,
        })
        .eq("id", id)
        .eq("user_id", user!.id);
      if (error) throw error;
      // Limpia el estado de Slack al cerrar la jornada (no bloqueante).
      await syncSlackStatus(null);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-today-attendance"] });
      qc.invalidateQueries({ queryKey: ["rh-my-attendance"] });
      qc.invalidateQueries({ queryKey: ["rh-org-attendance"] });
      toast.success("Salida registrada");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo registrar la salida"),
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
  start_time: string;
  end_time: string;
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
          start_time: input.start_time,
          end_time: input.end_time,
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
