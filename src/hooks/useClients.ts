import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { sendSlackNotification } from "@/lib/slackNotifications";
import { logActivity } from "@/lib/activityLog";

export type Client = Tables<"clients">;
export type ClientInsert = TablesInsert<"clients">;

export function useClients() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Client[];
    },
    enabled: !!user,
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (client: Omit<ClientInsert, "organization_id" | "created_by">) => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", {
        _user_id: user!.id,
      });

      const { data, error } = await supabase
        .from("clients")
        .insert({
          ...client,
          organization_id: orgId!,
          created_by: user!.id,
          dropbox_folder_path: client.dropbox_folder_path || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Auto-create projects based on contracted services
      const services = client.services || [];
      if (data) {
        const projectsToCreate: Array<{ name: string; area: string }> = [];

        // Contabilidad project for backoffice/softlanding
        if (services.includes("contabilidad") || services.includes("softlanding")) {
          projectsToCreate.push({
            name: `Contabilidad - ${data.name}`,
            area: services.includes("softlanding") ? "softlanding" : "contabilidad",
          });
        }

        // Legal project for backoffice/softlanding
        if (services.includes("legal")) {
          projectsToCreate.push({
            name: `Legal - ${data.name}`,
            area: "legal",
          });
        }

        // Compliance project for PLD/FT
        if (services.includes("pld_ft")) {
          projectsToCreate.push({
            name: `Cumplimiento PLD/FT - ${data.name}`,
            area: "pld_ft",
          });
        }

        for (const proj of projectsToCreate) {
          const { error: projectError } = await supabase
            .from("projects")
            .insert({
              name: proj.name,
              client_id: data.id,
              area: proj.area,
              organization_id: orgId!,
              created_by: user!.id,
              responsible_user_id: client.responsible_user_id || user!.id,
              tax_obligations: [],
            } as any);
          if (projectError) {
            console.error(`Error creating auto project (${proj.area}):`, projectError);
          }
        }
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Cliente creado exitosamente");

      if (data) {
        logActivity({ entityType: "client", entityId: data.id, action: "created", details: { name: data.name, client_type: data.client_type } });
        sendSlackNotification("client_created", {
          name: data.name,
          client_type: data.client_type,
          services: data.services,
        });
      }
    },
    onError: (error) => {
      toast.error("Error al crear cliente: " + error.message);
    },
  });
}

export const PAYROLL_OBLIGATION_STEPS = [
  { key: "decl_isr_retenciones_nomina", label: "Declaración: ISR Retenciones (nómina)" },
  { key: "decl_imss", label: "Declaración: IMSS" },
  { key: "decl_isn", label: "Declaración: ISN" },
];

export function useUpdateClient() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
      previousServices,
    }: {
      id: string;
      updates: Partial<ClientInsert> & { has_payroll?: boolean };
      previousServices: string[];
    }) => {
      // Get previous has_payroll value
      const { data: prevClient } = await supabase
        .from("clients")
        .select("has_payroll")
        .eq("id", id)
        .single();
      const previousPayroll = (prevClient as any)?.has_payroll || false;

      const { data, error } = await supabase
        .from("clients")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;

      // Auto-create projects for newly added services
      const newServices = (updates.services || []) as string[];
      const addedServices = newServices.filter((s) => !previousServices.includes(s));

      if (addedServices.length > 0 && data) {
        const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });

        const { data: existingProjects } = await supabase
          .from("projects")
          .select("area")
          .eq("client_id", id)
          .neq("status", "cancelado");

        const existingAreas = (existingProjects || []).map((p) => p.area);

        const projectsToCreate: Array<{ name: string; area: string }> = [];

        if (
          (addedServices.includes("contabilidad") || addedServices.includes("softlanding")) &&
          !existingAreas.includes("contabilidad") &&
          !existingAreas.includes("softlanding")
        ) {
          projectsToCreate.push({
            name: `Contabilidad - ${data.name}`,
            area: addedServices.includes("softlanding") ? "softlanding" : "contabilidad",
          });
        }

        if (addedServices.includes("legal") && !existingAreas.includes("legal")) {
          projectsToCreate.push({ name: `Legal - ${data.name}`, area: "legal" });
        }

        if (addedServices.includes("pld_ft") && !existingAreas.includes("pld_ft")) {
          projectsToCreate.push({ name: `Cumplimiento PLD/FT - ${data.name}`, area: "pld_ft" });
        }

        for (const proj of projectsToCreate) {
          await supabase.from("projects").insert({
            name: proj.name,
            client_id: data.id,
            area: proj.area,
            organization_id: orgId!,
            created_by: user!.id,
            responsible_user_id: data.responsible_user_id || user!.id,
            tax_obligations: [],
          } as any);
        }

        if (projectsToCreate.length > 0) {
          queryClient.invalidateQueries({ queryKey: ["projects"] });
          queryClient.invalidateQueries({ queryKey: ["client-projects", id] });
        }
      }

      // Handle payroll change: add/remove payroll steps from accounting periods
      const newPayroll = (updates as any).has_payroll ?? previousPayroll;
      if (newPayroll !== previousPayroll && data) {
        // Find accounting projects for this client
        const { data: accountingProjects } = await supabase
          .from("projects")
          .select("id")
          .eq("client_id", id)
          .in("area", ["contabilidad", "softlanding"])
          .neq("status", "cancelado");

        if (accountingProjects && accountingProjects.length > 0) {
          for (const proj of accountingProjects) {
            const { data: periods } = await supabase
              .from("accounting_periods")
              .select("id, steps")
              .eq("project_id", proj.id);

            if (periods) {
              for (const period of periods) {
                let steps = period.steps as any[];
                if (newPayroll) {
                  // Add payroll steps if not present
                  const existingKeys = steps.map((s: any) => s.key);
                  const toAdd = PAYROLL_OBLIGATION_STEPS.filter((ps) => !existingKeys.includes(ps.key));
                  if (toAdd.length > 0) {
                    steps = [
                      ...steps,
                      ...toAdd.map((ps) => ({
                        key: ps.key,
                        label: ps.label,
                        completed: false,
                        completed_at: null,
                        completed_by: null,
                        step_status: "pendiente",
                        date: null,
                        notes: null,
                        document_ids: [],
                      })),
                    ];
                  }
                } else {
                  // Remove payroll steps
                  const payrollKeys = PAYROLL_OBLIGATION_STEPS.map((ps) => ps.key);
                  steps = steps.filter((s: any) => !payrollKeys.includes(s.key));
                }
                await supabase
                  .from("accounting_periods")
                  .update({ steps: steps as any })
                  .eq("id", period.id);
              }
            }
          }
          queryClient.invalidateQueries({ queryKey: ["accounting-periods"] });
        }
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["client", data.id] });
      logActivity({ entityType: "client", entityId: data.id, action: "updated", details: { name: data.name } });
      toast.success("Cliente actualizado exitosamente");
    },
    onError: (error) => {
      toast.error("Error al actualizar cliente: " + error.message);
    },
  });
}

export function useDeleteClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      logActivity({ entityType: "client", entityId: id, action: "deleted" });
      toast.success("Cliente eliminado");
    },
    onError: (error) => toast.error("Error al eliminar cliente: " + error.message),
  });
}

export function useOrgProfiles() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["org-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("is_active", true)
        .order("full_name");

      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}
