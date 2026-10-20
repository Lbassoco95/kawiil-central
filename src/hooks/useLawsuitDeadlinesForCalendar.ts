import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { collectLawsuitDeadlines, lawsuitDeadlinesAsCalendarTasks } from "@/lib/lawsuits";

/**
 * Audiencias y plazos de juicios abiertos como filas tipo tarea (yyyy-MM-dd, inclusive),
 * para mostrarlos en el calendario junto a las tareas con vencimiento.
 */
export function useLawsuitDeadlinesForCalendar(startDate?: string, endDate?: string) {
  const { user } = useAuth();

  const { data: lawsuits } = useQuery({
    queryKey: ["calendar-lawsuits"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_lawsuits")
        .select(
          "id, name, project_id, status, next_hearing_date, next_hearing_time, next_deadline_date, next_deadline_note, projects(name, clients(name))",
        )
        .not("status", "in", "(concluido,archivado)");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  return useMemo(() => {
    if (!lawsuits || !startDate || !endDate) return [];
    const meta = new Map(
      lawsuits.map((l) => [l.id, { projectName: l.projects?.name, clientName: l.projects?.clients?.name }]),
    );
    return lawsuitDeadlinesAsCalendarTasks(collectLawsuitDeadlines(lawsuits), startDate, endDate, meta);
  }, [lawsuits, startDate, endDate]);
}
