import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const DAYS_AHEAD = 14;

export type DueAlertTask = {
  id: string;
  type: "task";
  title: string;
  due_date: string;
  status: string;
  priority: string;
  assigned_to: string | null;
  client_name?: string;
  project_name?: string;
  project_id?: string | null;
  is_overdue: boolean;
  assigned_to_me?: boolean;
};

export type DueAlertStep = {
  id: string;
  type: "accounting_step";
  label: string;
  due_date: string;
  project_id: string;
  project_name: string;
  period_label: string;
  step_key: string;
  is_overdue: boolean;
};

export function useDueDateAlerts() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["due-date-alerts", user?.id],
    queryFn: async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayIso = today.toISOString().split("T")[0];
      const end = new Date(today);
      end.setDate(end.getDate() + DAYS_AHEAD);
      const endIso = end.toISOString().split("T")[0];

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (!profile?.organization_id) {
        return { overdue: [], dueSoon: [], stepsOverdue: [], stepsDueSoon: [] };
      }

      const statuses: ("pendiente" | "en_progreso" | "en_revision")[] = ["pendiente", "en_progreso", "en_revision"];

      const { data: allTasks, error: tasksError } = await supabase
        .from("tasks")
        .select(
          "id, title, due_date, status, priority, assigned_to, client_id, project_id, clients(name), projects(name)"
        )
        .eq("organization_id", profile.organization_id)
        .not("due_date", "is", null)
        .in("status", statuses)
        .order("due_date", { ascending: true });
      if (tasksError) throw tasksError;

      const tasks = (allTasks ?? []) as any[];
      const overdue: DueAlertTask[] = [];
      const dueSoon: DueAlertTask[] = [];
      tasks.forEach((t) => {
        const d = t.due_date.split("T")[0];
        const isOverdue = d < todayIso;
        const inRange = d >= todayIso && d <= endIso;
        const item: DueAlertTask = {
          id: t.id,
          type: "task",
          title: t.title,
          due_date: t.due_date,
          status: t.status,
          priority: t.priority,
          assigned_to: t.assigned_to,
          client_name: t.clients?.name,
          project_name: t.projects?.name,
          is_overdue: isOverdue,
          assigned_to_me: t.assigned_to === user!.id,
        };
        if (isOverdue) overdue.push(item);
        else if (inRange) dueSoon.push(item);
      });

      const { data: periods } = await supabase
        .from("accounting_periods")
        .select("id, project_id, year, month, steps, projects(name)")
        .eq("organization_id", profile.organization_id);
      const stepsOverdue: DueAlertStep[] = [];
      const stepsDueSoon: DueAlertStep[] = [];
      (periods ?? []).forEach((p: any) => {
        const steps = (p.steps as any[]) ?? [];
        const projectName = p.projects?.name ?? "—";
        const periodLabel = `${p.year}-${String(p.month).padStart(2, "0")}`;
        steps.forEach((s: any) => {
          const due = s.due_date ?? s.fecha_limite;
          if (!due) return;
          const d = typeof due === "string" ? due.split("T")[0] : due;
          const isOverdue = d < todayIso;
          const inRange = d >= todayIso && d <= endIso;
          const item: DueAlertStep = {
            id: `${p.id}-${s.key ?? s.id ?? Math.random()}`,
            type: "accounting_step",
            label: s.label ?? s.key ?? "Paso",
            due_date: d,
            project_name: projectName,
            period_label: periodLabel,
            is_overdue: isOverdue,
          };
          if (isOverdue) stepsOverdue.push(item);
          else if (inRange) stepsDueSoon.push(item);
        });
      });
      stepsOverdue.sort((a, b) => a.due_date.localeCompare(b.due_date));
      stepsDueSoon.sort((a, b) => a.due_date.localeCompare(b.due_date));

      return {
        overdue,
        dueSoon,
        stepsOverdue,
        stepsDueSoon,
      };
    },
    enabled: !!user,
  });
}
