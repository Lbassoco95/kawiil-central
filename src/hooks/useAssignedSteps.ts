import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface AssignedStep {
  id: string;
  stepKey: string;
  stepLabel: string;
  status: string;
  dueDate: string | null;
  sourceType: "gestoria" | "constitucion" | "contabilidad" | "declaracion_anual" | "juicio";
  sourceLabel: string;
  projectId: string;
  projectName: string;
  clientName: string | null;
  isCollaborator?: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  gestoria: "Gestoría",
  constitucion: "Constitución",
  contabilidad: "Contabilidad",
  declaracion_anual: "Decl. Anual",
  juicio: "Juicio",
};

/** Fecha límite efectiva en JSON de pasos (snake_case, camelCase legacy o campo date). */
function pickStepDueDate(s: any): string | null {
  const raw = s?.due_date ?? s?.dueDate ?? s?.date ?? null;
  if (raw == null || raw === "") return null;
  return typeof raw === "string" ? raw : String(raw);
}

/** Check if a step is assigned to or has the user as collaborator */
function isUserInvolved(step: any, userId: string): "assigned" | "collaborator" | false {
  if (step.assigned_to === userId) return "assigned";
  if (Array.isArray(step.collaborators) && step.collaborators.includes(userId)) return "collaborator";
  return false;
}

export function useAssignedSteps() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["assigned-steps", user?.id],
    queryFn: async () => {
      const steps: AssignedStep[] = [];
      const userId = user!.id;

      // Projects with constitution_details (gestoria + constitution)
      const { data: projects } = await supabase
        .from("projects")
        .select("id, name, area, constitution_details, clients(name)")
        .not("constitution_details", "is", null);

      if (projects) {
        for (const p of projects) {
          const details = p.constitution_details as any;
          if (details?.steps) {
            for (const s of details.steps) {
              const role = isUserInvolved(s, userId);
              if (role) {
                const type = p.area === "gestoria" ? "gestoria" : "constitucion";
                steps.push({
                  id: `${p.id}_${s.key}`,
                  stepKey: s.key,
                  stepLabel: s.label,
                  status: s.status || "pendiente",
                  dueDate: pickStepDueDate(s),
                  sourceType: type as any,
                  sourceLabel: SOURCE_LABELS[type],
                  projectId: p.id,
                  projectName: p.name,
                  clientName: (p as any).clients?.name || null,
                  isCollaborator: role === "collaborator",
                });
              }
            }
          }
        }
      }

      // Projects with lawsuit_details
      const { data: lawsuitProjects } = await supabase
        .from("projects")
        .select("id, name, lawsuit_details, clients(name)")
        .not("lawsuit_details", "is", null);

      if (lawsuitProjects) {
        for (const p of lawsuitProjects) {
          const details = p.lawsuit_details as any;
          if (details?.stages) {
            for (const s of details.stages) {
              const role = isUserInvolved(s, userId);
              if (role) {
                steps.push({
                  id: `${p.id}_${s.key}`,
                  stepKey: s.key,
                  stepLabel: s.label,
                  status: s.status || "pendiente",
                  dueDate: pickStepDueDate(s),
                  sourceType: "juicio",
                  sourceLabel: SOURCE_LABELS.juicio,
                  projectId: p.id,
                  projectName: p.name,
                  clientName: (p as any).clients?.name || null,
                  isCollaborator: role === "collaborator",
                });
              }
            }
          }
        }
      }

      // Accounting periods
      const { data: periods } = await supabase
        .from("accounting_periods")
        .select("id, project_id, steps");

      if (periods) {
        const projectIds = [...new Set(periods.map((p) => p.project_id))];
        const { data: pProjects } = projectIds.length > 0
          ? await supabase.from("projects").select("id, name, clients(name)").in("id", projectIds)
          : { data: [] };
        const projMap = new Map((pProjects || []).map((p) => [p.id, p]));

        for (const period of periods) {
          const stepsArr = period.steps as any[];
          if (!stepsArr) continue;
          const proj = projMap.get(period.project_id);
          for (const s of stepsArr) {
            const role = isUserInvolved(s, userId);
            if (role) {
              steps.push({
                id: `ap_${period.id}_${s.key}`,
                stepKey: s.key,
                stepLabel: s.label,
                status: s.step_status || (s.completed ? "completado" : "pendiente"),
                dueDate: pickStepDueDate(s),
                sourceType: "contabilidad",
                sourceLabel: SOURCE_LABELS.contabilidad,
                projectId: period.project_id,
                projectName: proj?.name || "Proyecto",
                clientName: (proj as any)?.clients?.name || null,
                isCollaborator: role === "collaborator",
              });
            }
          }
        }
      }

      // Annual declarations
      const { data: declarations } = await supabase
        .from("annual_declarations")
        .select("id, project_id, steps");

      if (declarations) {
        const projectIds = [...new Set(declarations.map((d) => d.project_id))];
        const { data: dProjects } = projectIds.length > 0
          ? await supabase.from("projects").select("id, name, clients(name)").in("id", projectIds)
          : { data: [] };
        const projMap = new Map((dProjects || []).map((p) => [p.id, p]));

        for (const decl of declarations) {
          const stepsArr = decl.steps as any[];
          if (!stepsArr) continue;
          const proj = projMap.get(decl.project_id);
          for (const s of stepsArr) {
            const role = isUserInvolved(s, userId);
            if (role) {
              steps.push({
                id: `ad_${decl.id}_${s.key}`,
                stepKey: s.key,
                stepLabel: s.label,
                status: s.step_status || (s.completed ? "completado" : "pendiente"),
                dueDate: pickStepDueDate(s),
                sourceType: "declaracion_anual",
                sourceLabel: SOURCE_LABELS.declaracion_anual,
                projectId: decl.project_id,
                projectName: proj?.name || "Proyecto",
                clientName: (proj as any)?.clients?.name || null,
                isCollaborator: role === "collaborator",
              });
            }
          }
        }
      }

      return steps
        .filter((s) => s.status !== "completado")
        .sort((a, b) => {
          if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
          if (a.dueDate) return -1;
          if (b.dueDate) return 1;
          return 0;
        });
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
