import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type StepStatus = "pendiente" | "en_progreso" | "en_espera_cliente" | "completado";

export const STEP_STATUS_OPTIONS: { value: StepStatus; label: string }[] = [
  { value: "pendiente", label: "Pendiente" },
  { value: "en_progreso", label: "En progreso" },
  { value: "en_espera_cliente", label: "En espera del cliente" },
  { value: "completado", label: "Completado" },
];

export interface AccountingStep {
  key: string;
  label: string;
  completed: boolean;
  completed_at: string | null;
  completed_by: string | null;
  step_status?: StepStatus;
  date?: string | null;
  notes?: string | null;
  document_ids?: string[];
  time_spent_seconds?: number;
}

export interface AccountingPeriod {
  id: string;
  project_id: string;
  organization_id: string;
  year: number;
  month: number;
  steps: AccountingStep[];
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

export function getMonthName(month: number) {
  return MONTH_NAMES[month - 1] ?? "";
}

export function useAccountingPeriods(projectId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["accounting-periods", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounting_periods")
        .select("*")
        .eq("project_id", projectId!)
        .order("year", { ascending: false })
        .order("month", { ascending: false });
      if (error) throw error;
      return (data as any[]).map((d) => ({
        ...d,
        steps: d.steps as AccountingStep[],
      })) as AccountingPeriod[];
    },
    enabled: !!user && !!projectId,
  });
}

export function useCreateAccountingPeriod() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ projectId, year, month }: { projectId: string; year: number; month: number }) => {
      const { data: project, error: projErr } = await supabase
        .from("projects")
        .select("*")
        .eq("id", projectId)
        .single();
      if (projErr) throw projErr;

      const taxObligations = (project as any).tax_obligations as { key: string; label: string }[] | null;
      
      const extraSteps = (taxObligations ?? []).map((o) => ({
        key: `decl_${o.key}`,
        label: `Declaración: ${o.label}`,
        completed: false,
        completed_at: null,
        completed_by: null,
        step_status: "pendiente" as StepStatus,
        date: null,
        notes: null,
        document_ids: [],
      }));

      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });

      const { data, error } = await supabase
        .from("accounting_periods")
        .insert({
          project_id: projectId,
          organization_id: orgId!,
          year,
          month,
        })
        .select()
        .single();
      if (error) throw error;

      // Enrich default steps with new fields + append tax obligation steps
      const currentSteps = (data.steps as any as AccountingStep[]).map((s) => ({
        ...s,
        step_status: s.step_status || ("pendiente" as StepStatus),
        date: s.date || null,
        notes: s.notes || null,
        document_ids: s.document_ids || [],
      }));
      const allSteps = [...currentSteps, ...extraSteps];
      const { error: updateErr } = await supabase
        .from("accounting_periods")
        .update({ steps: allSteps as any })
        .eq("id", data.id);
      if (updateErr) throw updateErr;

      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["accounting-periods", vars.projectId] });
      toast.success("Periodo contable creado");
    },
    onError: (error: any) => {
      if (error.message?.includes("duplicate")) {
        toast.error("Ya existe un periodo para ese mes/año");
      } else {
        toast.error("Error al crear periodo: " + error.message);
      }
    },
  });
}

export function useToggleAccountingStep() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ periodId, projectId, stepKey, completed }: {
      periodId: string;
      projectId: string;
      stepKey: string;
      completed: boolean;
    }) => {
      const { data: period, error: fetchErr } = await supabase
        .from("accounting_periods")
        .select("steps")
        .eq("id", periodId)
        .single();
      if (fetchErr) throw fetchErr;

      const steps = (period.steps as any as AccountingStep[]).map((s) =>
        s.key === stepKey
          ? {
              ...s,
              completed,
              completed_at: completed ? new Date().toISOString() : null,
              completed_by: completed ? user!.id : null,
              step_status: completed ? ("completado" as StepStatus) : s.step_status,
            }
          : s
      );

      const allDone = steps.every((s) => s.completed);
      const anyStarted = steps.some((s) => s.completed || s.step_status !== "pendiente");

      const { error } = await supabase
        .from("accounting_periods")
        .update({
          steps: steps as any,
          status: allDone ? "completado" : anyStarted ? "en_progreso" : "pendiente",
        })
        .eq("id", periodId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["accounting-periods", vars.projectId] });
    },
    onError: (error) => {
      toast.error("Error al actualizar paso: " + error.message);
    },
  });
}

export function useUpdateStepDetails() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ periodId, projectId, stepKey, updates }: {
      periodId: string;
      projectId: string;
      stepKey: string;
      updates: Partial<Pick<AccountingStep, "step_status" | "date" | "notes" | "document_ids" | "time_spent_seconds">>;
    }) => {
      const { data: period, error: fetchErr } = await supabase
        .from("accounting_periods")
        .select("steps")
        .eq("id", periodId)
        .single();
      if (fetchErr) throw fetchErr;

      const steps = (period.steps as any as AccountingStep[]).map((s) =>
        s.key === stepKey ? { ...s, ...updates } : s
      );

      const allDone = steps.every((s) => s.completed);
      const anyStarted = steps.some((s) => s.completed || (s.step_status && s.step_status !== "pendiente"));

      const { error } = await supabase
        .from("accounting_periods")
        .update({
          steps: steps as any,
          status: allDone ? "completado" : anyStarted ? "en_progreso" : "pendiente",
        })
        .eq("id", periodId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["accounting-periods", vars.projectId] });
    },
    onError: (error) => {
      toast.error("Error al actualizar paso: " + error.message);
    },
  });
}
