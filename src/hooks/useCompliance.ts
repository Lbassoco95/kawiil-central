import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface ComplianceEntityType {
  id: string;
  code: string;
  name: string;
  group_name: string;
  description: string | null;
  is_active: boolean;
}

export interface ClientComplianceConfig {
  id: string;
  organization_id: string;
  client_id: string;
  entity_type_id: string;
  registration_number: string | null;
  authorization_date: string | null;
  compliance_officer_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  entity_type?: ComplianceEntityType;
}

export interface ComplianceTaskTemplate {
  id: string;
  entity_type_id: string;
  task_name: string;
  description: string | null;
  category: string;
  periodicity: string;
  due_day: number | null;
  due_month: number | null;
  due_month_2: number | null;
  due_description: string | null;
  sort_order: number;
  is_active: boolean;
}

export function useComplianceEntityTypes() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["compliance-entity-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("compliance_entity_types")
        .select("*")
        .eq("is_active", true)
        .order("group_name, name");
      if (error) throw error;
      return data as ComplianceEntityType[];
    },
    enabled: !!user,
  });
}

export function useClientComplianceConfig(clientId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["client-compliance-config", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_compliance_config")
        .select("*, compliance_entity_types(*)")
        .eq("client_id", clientId!)
        .eq("is_active", true);
      if (error) throw error;
      return (data || []).map((d: any) => ({
        ...d,
        entity_type: d.compliance_entity_types,
      })) as ClientComplianceConfig[];
    },
    enabled: !!user && !!clientId,
  });
}

export function useSaveClientCompliance() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      clientId,
      entityTypeIds,
      registrationNumber,
      authorizationDate,
      complianceOfficerName,
    }: {
      clientId: string;
      entityTypeIds: string[];
      registrationNumber?: string;
      authorizationDate?: string;
      complianceOfficerName?: string;
    }) => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });

      // Get existing configs
      const { data: existing } = await supabase
        .from("client_compliance_config")
        .select("id, entity_type_id")
        .eq("client_id", clientId)
        .eq("is_active", true);

      const existingIds = (existing || []).map((e: any) => e.entity_type_id);
      const toAdd = entityTypeIds.filter((id) => !existingIds.includes(id));
      const toRemove = (existing || []).filter((e: any) => !entityTypeIds.includes(e.entity_type_id));

      // Deactivate removed
      for (const r of toRemove) {
        await supabase
          .from("client_compliance_config")
          .update({ is_active: false })
          .eq("id", (r as any).id);
      }

      // Add new
      for (const entityTypeId of toAdd) {
        await supabase.from("client_compliance_config").insert({
          organization_id: orgId!,
          client_id: clientId,
          entity_type_id: entityTypeId,
          registration_number: registrationNumber || null,
          authorization_date: authorizationDate || null,
          compliance_officer_name: complianceOfficerName || null,
        });
      }

      // Update shared fields on all active configs
      if (entityTypeIds.length > 0) {
        await supabase
          .from("client_compliance_config")
          .update({
            registration_number: registrationNumber || null,
            authorization_date: authorizationDate || null,
            compliance_officer_name: complianceOfficerName || null,
          })
          .eq("client_id", clientId)
          .eq("is_active", true);
      }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["client-compliance-config", vars.clientId] });
      toast.success("Configuración de cumplimiento guardada");
    },
    onError: (err: Error) => {
      toast.error("Error al guardar configuración: " + err.message);
    },
  });
}

export function useComplianceTemplates(entityTypeIds: string[]) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["compliance-templates", entityTypeIds],
    queryFn: async () => {
      if (entityTypeIds.length === 0) return [];
      const { data, error } = await supabase
        .from("compliance_task_templates")
        .select("*, compliance_entity_types(code, name, group_name)")
        .in("entity_type_id", entityTypeIds)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return data as any[];
    },
    enabled: !!user && entityTypeIds.length > 0,
  });
}

// Calculate due dates for compliance tasks
export function calculateDueDates(
  template: ComplianceTaskTemplate,
  year: number
): { dueDate: string; period: string }[] {
  const results: { dueDate: string; period: string }[] = [];

  switch (template.periodicity) {
    case "mensual": {
      for (let m = 1; m <= 12; m++) {
        const day = template.due_day || 17;
        // For monthly tasks, the due date is in the NEXT month
        const dueMonth = m === 12 ? 1 : m + 1;
        const dueYear = m === 12 ? year + 1 : year;
        const lastDay = new Date(dueYear, dueMonth, 0).getDate();
        const d = Math.min(day, lastDay);
        results.push({
          dueDate: `${dueYear}-${String(dueMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
          period: `${year}-${String(m).padStart(2, "0")}`,
        });
      }
      break;
    }
    case "trimestral": {
      const quarters = [
        { months: [1, 2, 3], label: "Q1", dueMonth: 3, dueDay: 31 },
        { months: [4, 5, 6], label: "Q2", dueMonth: 6, dueDay: 30 },
        { months: [7, 8, 9], label: "Q3", dueMonth: 9, dueDay: 30 },
        { months: [10, 11, 12], label: "Q4", dueMonth: 12, dueDay: 31 },
      ];
      for (const q of quarters) {
        results.push({
          dueDate: `${year}-${String(q.dueMonth).padStart(2, "0")}-${String(q.dueDay).padStart(2, "0")}`,
          period: `${year}-${q.label}`,
        });
      }
      break;
    }
    case "semestral": {
      const m1 = template.due_month || 6;
      const m2 = template.due_month_2 || 12;
      const lastDay1 = new Date(year, m1, 0).getDate();
      const lastDay2 = new Date(year, m2, 0).getDate();
      results.push({
        dueDate: `${year}-${String(m1).padStart(2, "0")}-${String(lastDay1).padStart(2, "0")}`,
        period: `${year}-S1`,
      });
      results.push({
        dueDate: `${year}-${String(m2).padStart(2, "0")}-${String(lastDay2).padStart(2, "0")}`,
        period: `${year}-S2`,
      });
      break;
    }
    case "anual": {
      const m = template.due_month || 1;
      const lastDay = new Date(year, m, 0).getDate();
      results.push({
        dueDate: `${year}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
        period: `${year}`,
      });
      break;
    }
    case "cuando_aplique": {
      // No auto-generated dates; create a single placeholder
      results.push({
        dueDate: "",
        period: `${year}`,
      });
      break;
    }
  }

  return results;
}

export function useGenerateComplianceTasks() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      projectId,
      templates,
      responsibleUserId,
    }: {
      projectId: string;
      templates: (ComplianceTaskTemplate & { compliance_entity_types?: any })[];
      responsibleUserId: string;
    }) => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      const year = new Date().getFullYear();
      const today = new Date().toISOString().split("T")[0];

      const tasksToInsert: any[] = [];

      for (const tpl of templates) {
        const dates = calculateDueDates(tpl, year);

        for (const { dueDate, period } of dates) {
          // Calculate priority based on due date
          let priority = "media";
          if (dueDate) {
            const daysUntil = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000);
            if (daysUntil <= 7) priority = "urgente";
            else if (daysUntil <= 30) priority = "alta";
          }

          tasksToInsert.push({
            title: tpl.task_name,
            description: tpl.description || null,
            area: "cumplimiento" as any,
            priority,
            status: "pendiente",
            due_date: dueDate || null,
            assigned_to: responsibleUserId,
            project_id: projectId,
            organization_id: orgId!,
            created_by: user!.id,
            compliance_template_id: tpl.id,
            compliance_periodicity: tpl.periodicity,
            compliance_period: period,
          });
        }
      }

      // Batch insert (max 100 at a time)
      for (let i = 0; i < tasksToInsert.length; i += 100) {
        const batch = tasksToInsert.slice(i, i + 100);
        const { error } = await supabase.from("tasks").insert(batch);
        if (error) throw error;
      }

      return tasksToInsert.length;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["project-tasks"] });
      toast.success(`${count} tareas de cumplimiento generadas`);
    },
    onError: (err: Error) => {
      toast.error("Error al generar tareas: " + err.message);
    },
  });
}
