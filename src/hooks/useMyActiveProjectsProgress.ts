import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  countConstitutionLikeSteps,
  countLawsuitStages,
  countAccountingStepsFromPeriods,
  countAnnualDeclarationSteps,
  countBoardTasksForProject,
  resolvePrimaryPipeline,
  pct,
  type PrimaryPipelineKind,
} from "@/lib/personalProjectProgress";

export type MyActiveProjectProgressRow = {
  id: string;
  name: string;
  clientName: string | null;
  area: string | null;
  primaryKind: PrimaryPipelineKind;
  primaryLabel: string;
  primaryPct: number;
  primaryDone: number;
  primaryTotal: number;
  taskDone: number;
  taskTotal: number;
  taskPct: number;
};

export function useMyActiveProjectsProgress() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["my-active-projects-progress", user?.id],
    queryFn: async (): Promise<MyActiveProjectProgressRow[]> => {
      const { data: projects, error: e1 } = await supabase
        .from("projects")
        .select("id, name, area, status, constitution_details, lawsuit_details, clients(name)")
        .eq("responsible_user_id", user!.id)
        .eq("status", "activo")
        .order("name");
      if (e1) throw e1;
      if (!projects?.length) return [];

      const ids = projects.map((p) => p.id);

      const { data: taskRows, error: e2 } = await supabase
        .from("tasks")
        .select("project_id, status")
        .in("project_id", ids);
      if (e2) throw e2;

      const { data: periods, error: e3 } = await supabase
        .from("accounting_periods")
        .select("project_id, steps")
        .in("project_id", ids);
      if (e3) throw e3;

      const { data: declarations, error: e4 } = await supabase
        .from("annual_declarations")
        .select("project_id, steps")
        .in("project_id", ids);
      if (e4) throw e4;

      const tasksByProject = new Map<string, { status: string }[]>();
      for (const t of taskRows ?? []) {
        if (!t.project_id) continue;
        const list = tasksByProject.get(t.project_id) ?? [];
        list.push({ status: t.status });
        tasksByProject.set(t.project_id, list);
      }

      const periodsByProject = new Map<string, { steps?: unknown }[]>();
      for (const p of periods ?? []) {
        const list = periodsByProject.get(p.project_id) ?? [];
        list.push({ steps: p.steps });
        periodsByProject.set(p.project_id, list);
      }

      const annualByProject = new Map<string, { steps?: unknown }[]>();
      for (const d of declarations ?? []) {
        const list = annualByProject.get(d.project_id) ?? [];
        list.push({ steps: d.steps });
        annualByProject.set(d.project_id, list);
      }

      const rows: MyActiveProjectProgressRow[] = [];

      for (const p of projects) {
        const constitution = countConstitutionLikeSteps(p.constitution_details);
        const lawsuit = countLawsuitStages(p.lawsuit_details);
        const accounting = countAccountingStepsFromPeriods(periodsByProject.get(p.id) ?? []);
        const annual = countAnnualDeclarationSteps(annualByProject.get(p.id) ?? []);
        const taskCount = countBoardTasksForProject(tasksByProject.get(p.id) ?? []);

        const primary = resolvePrimaryPipeline({
          area: p.area,
          constitution,
          lawsuit,
          accounting,
          annual,
          tasks: taskCount,
        });

        const taskDone = taskCount?.done ?? 0;
        const taskTotal = taskCount?.total ?? 0;
        const taskPct = pct(taskDone, taskTotal);

        if (!primary) {
          rows.push({
            id: p.id,
            name: p.name,
            clientName: (p as { clients?: { name?: string } | null }).clients?.name ?? null,
            area: p.area,
            primaryKind: "tareas",
            primaryLabel: "Sin flujo ni tareas activas en tablero",
            primaryPct: 0,
            primaryDone: 0,
            primaryTotal: 0,
            taskDone,
            taskTotal,
            taskPct,
          });
          continue;
        }

        const { count, label, kind } = primary;
        rows.push({
          id: p.id,
          name: p.name,
          clientName: (p as { clients?: { name?: string } | null }).clients?.name ?? null,
          area: p.area,
          primaryKind: kind,
          primaryLabel: label,
          primaryPct: pct(count.done, count.total),
          primaryDone: count.done,
          primaryTotal: count.total,
          taskDone,
          taskTotal,
          taskPct,
        });
      }

      return rows.sort((a, b) => a.name.localeCompare(b.name, "es"));
    },
    enabled: !!user,
  });
}
