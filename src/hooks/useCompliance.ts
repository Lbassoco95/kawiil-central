import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  ensureComplianceProjectForClient,
  syncComplianceProjectDescription,
} from "@/lib/ensureComplianceProject";
import { buildComplianceTaskDescriptionSuffix } from "@/lib/complianceProjectSummary";
import { calculateDueDates } from "@/lib/complianceDueDates";

export type { ComplianceTemplateForDueDates } from "@/lib/complianceDueDates";
export { calculateDueDates };

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
        const { error } = await supabase
          .from("client_compliance_config")
          .update({ is_active: false })
          .eq("id", (r as any).id);
        if (error) throw error;
      }

      // Add new
      for (const entityTypeId of toAdd) {
        const { error } = await supabase.from("client_compliance_config").insert({
          organization_id: orgId!,
          client_id: clientId,
          entity_type_id: entityTypeId,
          registration_number: registrationNumber || null,
          authorization_date: authorizationDate || null,
          compliance_officer_name: complianceOfficerName || null,
        });
        if (error) throw error;
      }

      // Update shared fields on all active configs
      if (entityTypeIds.length > 0) {
        const { error } = await supabase
          .from("client_compliance_config")
          .update({
            registration_number: registrationNumber || null,
            authorization_date: authorizationDate || null,
            compliance_officer_name: complianceOfficerName || null,
          })
          .eq("client_id", clientId)
          .eq("is_active", true);
        if (error) throw error;
      }

      let tasksCreated = 0;
      if (entityTypeIds.length > 0) {
        const r = await ensureComplianceProjectForClient({
          clientId,
          userId: user!.id,
          entityTypeIds,
        });
        tasksCreated = r.tasksCreated;
      } else {
        await syncComplianceProjectDescription(clientId);
      }

      return { tasksCreated };
    },
    onSuccess: (data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["client-compliance-config", vars.clientId] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["client-projects", vars.clientId] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["client", vars.clientId] });
      queryClient.invalidateQueries({ queryKey: ["project"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["project-tasks"] });
      if (data.tasksCreated > 0) {
        toast.success(
          `Configuración guardada. Se añadieron ${data.tasksCreated} tareas de cumplimiento nuevas.`,
        );
      } else {
        toast.success("Configuración de cumplimiento guardada");
      }
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

export function useGenerateComplianceTasks() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      projectId,
      templates,
      responsibleUserId,
      clientId,
    }: {
      projectId: string;
      templates: (ComplianceTaskTemplate & { compliance_entity_types?: any })[];
      responsibleUserId: string;
      clientId?: string | null;
    }) => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      const year = new Date().getFullYear();

      let taskContextSuffix = "";
      if (clientId) {
        const { data: cfgRows, error: cfgErr } = await supabase
          .from("client_compliance_config")
          .select(
            "registration_number, authorization_date, compliance_officer_name, compliance_entity_types(name, code, group_name)",
          )
          .eq("client_id", clientId)
          .eq("is_active", true);
        if (cfgErr) throw cfgErr;
        if (cfgRows?.length) taskContextSuffix = buildComplianceTaskDescriptionSuffix(cfgRows as any);
      }

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

          const baseDesc = tpl.description?.trim() || "";
          const description = [baseDesc, taskContextSuffix].filter(Boolean).join("") || null;

          tasksToInsert.push({
            title: tpl.task_name,
            description,
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
            client_id: clientId || null,
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
    onSuccess: (count, vars) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["project-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["project", vars.projectId] });
      if (vars.clientId) {
        queryClient.invalidateQueries({ queryKey: ["client-projects", vars.clientId] });
      }
      toast.success(`${count} tareas de cumplimiento generadas`);
    },
    onError: (err: Error) => {
      toast.error("Error al generar tareas: " + err.message);
    },
  });
}
