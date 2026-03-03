import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { AccountingStep, StepStatus } from "./useAccountingPeriods";

export interface AnnualDeclaration {
  id: string;
  project_id: string;
  organization_id: string;
  year: number;
  steps: AccountingStep[];
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function useAnnualDeclarations(projectId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["annual-declarations", projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("annual_declarations" as any)
        .select("*")
        .eq("project_id", projectId!)
        .order("year", { ascending: false });
      if (error) throw error;
      return (data as any[]).map((d) => ({
        ...d,
        steps: d.steps as AccountingStep[],
      })) as AnnualDeclaration[];
    },
    enabled: !!user && !!projectId,
  });
}

export function useCreateAnnualDeclaration() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ projectId, year }: { projectId: string; year: number }) => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      const { data, error } = await supabase
        .from("annual_declarations" as any)
        .insert({
          project_id: projectId,
          organization_id: orgId!,
          year,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["annual-declarations", vars.projectId] });
      toast.success("Declaración anual creada");
    },
    onError: (error: any) => {
      if (error.message?.includes("duplicate") || error.message?.includes("unique")) {
        toast.error("Ya existe una declaración para ese año");
      } else {
        toast.error("Error al crear declaración: " + error.message);
      }
    },
  });
}

export function useToggleAnnualStep() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ declarationId, projectId, stepKey, completed }: {
      declarationId: string;
      projectId: string;
      stepKey: string;
      completed: boolean;
    }) => {
      const { data: decl, error: fetchErr } = await supabase
        .from("annual_declarations" as any)
        .select("steps")
        .eq("id", declarationId)
        .single();
      if (fetchErr) throw fetchErr;

      const steps = ((decl as any).steps as AccountingStep[]).map((s) =>
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
        .from("annual_declarations" as any)
        .update({
          steps: steps as any,
          status: allDone ? "completado" : anyStarted ? "en_progreso" : "pendiente",
        } as any)
        .eq("id", declarationId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["annual-declarations", vars.projectId] });
    },
    onError: (error) => {
      toast.error("Error al actualizar paso: " + (error as any).message);
    },
  });
}

export function useUpdateAnnualStepDetails() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ declarationId, projectId, stepKey, updates }: {
      declarationId: string;
      projectId: string;
      stepKey: string;
      updates: Partial<Pick<AccountingStep, "step_status" | "date" | "notes" | "document_ids" | "time_spent_seconds">>;
    }) => {
      const { data: decl, error: fetchErr } = await supabase
        .from("annual_declarations" as any)
        .select("steps")
        .eq("id", declarationId)
        .single();
      if (fetchErr) throw fetchErr;

      const steps = ((decl as any).steps as AccountingStep[]).map((s) =>
        s.key === stepKey ? { ...s, ...updates } : s
      );

      const allDone = steps.every((s) => s.completed);
      const anyStarted = steps.some((s) => s.completed || (s.step_status && s.step_status !== "pendiente"));

      const { error } = await supabase
        .from("annual_declarations" as any)
        .update({
          steps: steps as any,
          status: allDone ? "completado" : anyStarted ? "en_progreso" : "pendiente",
        } as any)
        .eq("id", declarationId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["annual-declarations", vars.projectId] });
    },
    onError: (error) => {
      toast.error("Error al actualizar paso: " + (error as any).message);
    },
  });
}
