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
      const isSoftlanding = services.includes("softlanding");
      const responsibleId = client.responsible_user_id || user!.id;

      // Default constitution steps for auto-initialization
      const DEFAULT_CONSTITUTION_STEPS = [
        { key: "documentacion_socios", label: "Recopilación de documentación de socios", description: "Integrar documentos de identidad, poderes y datos de los socios/accionistas.", icon: "FileText", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: responsibleId, due_date: null, document_ids: [], collaborators: [] },
        { key: "envio_notaria", label: "Envío de información a notaría", description: "Enviar la documentación completa de socios a la notaría.", icon: "Building2", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: responsibleId, due_date: null, document_ids: [], collaborators: [] },
        { key: "proyecto_constitucion", label: "Proyecto de constitución", description: "La notaría prepara el proyecto de acta constitutiva para revisión.", icon: "Stamp", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: responsibleId, due_date: null, document_ids: [], collaborators: [] },
        { key: "firma_socios", label: "Firma de socios", description: "Los socios firman el acta constitutiva ante notario.", icon: "PenLine", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: responsibleId, due_date: null, document_ids: [], collaborators: [] },
        { key: "contratacion_linea", label: "Contratación de línea telefónica", description: "Contratar línea telefónica a nombre de la empresa para comprobante de domicilio.", icon: "Phone", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: responsibleId, due_date: null, document_ids: [], collaborators: [] },
        { key: "recibo_comprobante", label: "Comprobante de domicilio generado", description: "Verificar que ya se generó el recibo de la línea contratada.", icon: "Home", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: responsibleId, due_date: null, document_ids: [], collaborators: [] },
        { key: "cita_rfc", label: "Agendar cita ante el SAT (RFC)", description: "El gestor solicita cita en el SAT para la inscripción al RFC.", icon: "CalendarClock", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", appointment_date: null, assigned_to: responsibleId, due_date: null, document_ids: [], collaborators: [] },
        { key: "obtencion_rfc", label: "Obtención del RFC", description: "Acudir a la cita y completar la inscripción al RFC.", icon: "Receipt", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: responsibleId, due_date: null, document_ids: [], collaborators: [] },
        { key: "cita_efirma", label: "Agendar cita ante el SAT (e.firma)", description: "El gestor solicita cita para obtener la firma electrónica.", icon: "CalendarClock", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", appointment_date: null, assigned_to: responsibleId, due_date: null, document_ids: [], collaborators: [] },
        { key: "firma_electronica", label: "Obtención de e.firma (FIEL)", description: "Acudir a la cita y completar el trámite de firma electrónica avanzada.", icon: "KeyRound", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: responsibleId, due_date: null, document_ids: [], collaborators: [] },
        { key: "cuenta_bancaria", label: "Alta de cuenta bancaria", description: "Apertura de cuenta bancaria corporativa.", icon: "Landmark", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: responsibleId, due_date: null, document_ids: [], collaborators: [] },
        { key: "registro_rpc", label: "Registro ante el RPC (boleta)", description: "Inscripción en el Registro Público de Comercio.", icon: "BookOpen", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", assigned_to: responsibleId, due_date: null, document_ids: [], collaborators: [] },
        { key: "inscripcion_rnie", label: "Inscripción al RNIE", description: "Registro Nacional de Inversiones Extranjeras (socios extranjeros).", icon: "Globe", status: "pendiente", completed: false, completed_at: null, completed_by: null, notes: "", conditional: true, assigned_to: responsibleId, due_date: null, document_ids: [], collaborators: [] },
      ];

      if (data) {
        const projectsToCreate: Array<{ name: string; area: string; constitution_details?: any }> = [];

        // Contabilidad project for backoffice/softlanding (with constitution for softlanding)
        if (isSoftlanding) {
          projectsToCreate.push({
            name: `Softlanding - ${data.name}`,
            area: "softlanding",
            constitution_details: {
              steps: DEFAULT_CONSTITUTION_STEPS,
              has_foreign_partners: true,
            },
          });
        } else if (services.includes("contabilidad")) {
          projectsToCreate.push({
            name: `Contabilidad - ${data.name}`,
            area: "contabilidad",
          });
        }

        // Legal project
        if (services.includes("legal")) {
          projectsToCreate.push({ name: `Legal - ${data.name}`, area: "legal" });
        }

        // PLD/FT project
        if (services.includes("pld_ft")) {
          projectsToCreate.push({ name: `Cumplimiento PLD/FT - ${data.name}`, area: "pld_ft" });
        }

        // Cumplimiento project
        if (services.includes("cumplimiento")) {
          projectsToCreate.push({ name: `Cumplimiento — ${data.name}`, area: "cumplimiento" });
        }

        // Constitución Nacional project (standalone)
        if (services.includes("constitucion_nacional") && !isSoftlanding) {
          projectsToCreate.push({
            name: `Constitución - ${data.name}`,
            area: "constitucion_nacional",
            constitution_details: {
              steps: DEFAULT_CONSTITUTION_STEPS,
              has_foreign_partners: false,
            },
          });
        }

        // Gestoría project
        if (services.includes("gestoria")) {
          projectsToCreate.push({ name: `Gestoría - ${data.name}`, area: "gestoria" });
        }

        // Representación project
        if (services.includes("representacion")) {
          projectsToCreate.push({ name: `Representación - ${data.name}`, area: "representacion" });
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
              responsible_user_id: responsibleId,
              tax_obligations: [],
              ...(proj.constitution_details ? { constitution_details: proj.constitution_details } : {}),
            } as any);
          if (projectError) {
            console.error(`Error creating auto project (${proj.area}):`, projectError);
          }
        }

        // Auto-create quarterly legal review task when payroll is set on creation
        const payrollType = (client as any).payroll_type || null;
        if (payrollType) {
          // Find the legal project responsible (just created above if legal service exists)
          const { data: legalProject } = await supabase
            .from("projects")
            .select("responsible_user_id")
            .eq("client_id", data.id)
            .eq("area", "legal")
            .neq("status", "cancelado")
            .maybeSingle();

          const assignTo = legalProject?.responsible_user_id || client.responsible_user_id || user!.id;

          await supabase.from("tasks").insert({
            title: `Revisión de contratos y estructura legal - ${data.name}`,
            description: "Revisión trimestral de contratos laborales y estructura legal de contrataciones para verificar cumplimiento legal vigente.",
            client_id: data.id,
            organization_id: orgId!,
            created_by: user!.id,
            assigned_to: assignTo,
            area: "legal",
            priority: "media",
            status: "pendiente",
            is_recurring: true,
            recurrence_pattern: "trimestral",
          } as any);
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

export const NOMINA_OBLIGATION_STEPS = [
  { key: "decl_isr_retenciones_nomina", label: "Declaración: ISR Retenciones (nómina)" },
  { key: "decl_imss", label: "Declaración: IMSS" },
  { key: "decl_isn", label: "Declaración: ISN" },
];

export const ASIMILADOS_OBLIGATION_STEPS = [
  { key: "decl_isr_retenciones_asimilados", label: "Declaración: ISR Retenciones (asimilados)" },
];

/** Get the payroll obligation steps based on the payroll type */
export function getPayrollSteps(payrollType: string | null): { key: string; label: string }[] {
  if (!payrollType) return [];
  if (payrollType === "nomina") return NOMINA_OBLIGATION_STEPS;
  if (payrollType === "asimilados") return ASIMILADOS_OBLIGATION_STEPS;
  if (payrollType === "ambos") return [...NOMINA_OBLIGATION_STEPS, ...ASIMILADOS_OBLIGATION_STEPS];
  return [];
}

/** All possible payroll step keys for removal */
const ALL_PAYROLL_KEYS = [
  ...NOMINA_OBLIGATION_STEPS.map((s) => s.key),
  ...ASIMILADOS_OBLIGATION_STEPS.map((s) => s.key),
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
      updates: Partial<ClientInsert> & { payroll_type?: string | null };
      previousServices: string[];
    }) => {
      // Get previous payroll_type value
      const { data: prevClient } = await supabase
        .from("clients")
        .select("payroll_type")
        .eq("id", id)
        .single();
      const previousPayrollType = (prevClient as any)?.payroll_type || null;

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

        if (addedServices.includes("softlanding") && !existingAreas.includes("softlanding")) {
          projectsToCreate.push({
            name: `Softlanding - ${data.name}`,
            area: "softlanding",
          });
        } else if (addedServices.includes("contabilidad") && !existingAreas.includes("contabilidad") && !existingAreas.includes("softlanding")) {
          projectsToCreate.push({
            name: `Contabilidad - ${data.name}`,
            area: "contabilidad",
          });
        }

        if (addedServices.includes("legal") && !existingAreas.includes("legal")) {
          projectsToCreate.push({ name: `Legal - ${data.name}`, area: "legal" });
        }

        if (addedServices.includes("pld_ft") && !existingAreas.includes("pld_ft")) {
          projectsToCreate.push({ name: `Cumplimiento PLD/FT - ${data.name}`, area: "pld_ft" });
        }

        if (addedServices.includes("cumplimiento") && !existingAreas.includes("cumplimiento")) {
          projectsToCreate.push({ name: `Cumplimiento — ${data.name}`, area: "cumplimiento" });
        }

        if (addedServices.includes("representacion") && !existingAreas.includes("representacion")) {
          projectsToCreate.push({ name: `Representación - ${data.name}`, area: "representacion" });
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

      // Handle payroll type change: add/remove payroll steps from accounting periods
      const newPayrollType = (updates as any).payroll_type !== undefined
        ? (updates as any).payroll_type
        : previousPayrollType;

      if (newPayrollType !== previousPayrollType && data) {
        const { data: accountingProjects } = await supabase
          .from("projects")
          .select("id")
          .eq("client_id", id)
          .in("area", ["contabilidad", "softlanding"])
          .neq("status", "cancelado");

        if (accountingProjects && accountingProjects.length > 0) {
          const newStepsDef = getPayrollSteps(newPayrollType);
          const newStepKeys = newStepsDef.map((s) => s.key);

          for (const proj of accountingProjects) {
            const { data: periods } = await supabase
              .from("accounting_periods")
              .select("id, steps")
              .eq("project_id", proj.id);

            if (periods) {
              for (const period of periods) {
                // Remove all old payroll steps
                let steps = (period.steps as any[]).filter(
                  (s: any) => !ALL_PAYROLL_KEYS.includes(s.key)
                );
                // Add new payroll steps
                const existingKeys = steps.map((s: any) => s.key);
                const toAdd = newStepsDef.filter((ps) => !existingKeys.includes(ps.key));
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
                await supabase
                  .from("accounting_periods")
                  .update({ steps: steps as any })
                  .eq("id", period.id);
              }
            }
          }
          queryClient.invalidateQueries({ queryKey: ["accounting-periods"] });
        }

        // Auto-create quarterly legal review task when payroll is activated
        const hadPayroll = !!previousPayrollType;
        const hasPayroll = !!newPayrollType;
        if (!hadPayroll && hasPayroll && data) {
          const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });

          // Find legal project responsible for this client
          const { data: legalProject } = await supabase
            .from("projects")
            .select("responsible_user_id")
            .eq("client_id", id)
            .eq("area", "legal")
            .neq("status", "cancelado")
            .maybeSingle();

          const assignTo = legalProject?.responsible_user_id || data.responsible_user_id || user!.id;

          // Check if task already exists
          const { data: existingTask } = await supabase
            .from("tasks")
            .select("id")
            .eq("client_id", id)
            .eq("is_recurring", true)
            .eq("recurrence_pattern", "trimestral")
            .ilike("title", "%revisión de contratos%")
            .maybeSingle();

          if (!existingTask) {
            await supabase.from("tasks").insert({
              title: `Revisión de contratos y estructura legal - ${data.name}`,
              description: "Revisión trimestral de contratos laborales y estructura legal de contrataciones para verificar cumplimiento legal vigente.",
              client_id: id,
              organization_id: orgId!,
              created_by: user!.id,
              assigned_to: assignTo,
              area: "legal",
              priority: "media",
              status: "pendiente",
              is_recurring: true,
              recurrence_pattern: "trimestral",
            } as any);
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
          }
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
