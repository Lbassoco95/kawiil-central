import { useMemo } from "react";
import { useProjects, type Project } from "@/hooks/useProjects";

interface RawStage {
  status?: string;
}

interface RawLawsuitDetails {
  stages?: RawStage[];
  deadlines?: LitigioDeadline[];
  jurisdiction?: string | null;
  instancia?: string | null;
  lawsuit_type?: string;
  case_number?: string | null;
  court?: string | null;
}

type ProjectRow = Project & { clients?: { name?: string | null } | null };

export interface LitigioDeadline {
  id: string;
  title: string;
  date: string;
  time?: string;
  type: string;
  completed: boolean;
  notes?: string;
  assigned_to?: string | null;
  attendees?: string[];
}

export interface LitigioCase {
  id: string;
  name: string;
  clientName: string | null;
  jurisdiction: string | null;
  instancia: string | null;
  materia: string;
  caseNumber: string | null;
  court: string | null;
  responsibleUserId: string | null;
  status: string;
  stagesTotal: number;
  stagesDone: number;
  deadlines: LitigioDeadline[];
}

export interface LitigioAgendaItem extends LitigioDeadline {
  projectId: string;
  projectName: string;
  clientName: string | null;
  jurisdiction: string | null;
  materia: string;
  responsibleUserId: string | null;
}

/**
 * Agenda transversal de litigio: aplana los expedientes (projects.area = "juicios")
 * y sus términos/audiencias en una sola lista para el cockpit de Litigio.
 * Reutiliza useProjects (no hace queries extra).
 */
export function useLitigationAgenda() {
  const { data: projects = [], isLoading } = useProjects();

  const cases = useMemo<LitigioCase[]>(() => {
    return (projects as ProjectRow[])
      .filter((p) => p.area === "juicios")
      .map((p) => {
        const d = (p.lawsuit_details || {}) as RawLawsuitDetails;
        const stages: RawStage[] = Array.isArray(d.stages) ? d.stages : [];
        const deadlines: LitigioDeadline[] = Array.isArray(d.deadlines) ? d.deadlines : [];
        return {
          id: p.id,
          name: p.name,
          clientName: p.clients?.name ?? null,
          jurisdiction: d.jurisdiction ?? null,
          instancia: d.instancia ?? null,
          materia: d.lawsuit_type ?? "",
          caseNumber: d.case_number ?? null,
          court: d.court ?? null,
          responsibleUserId: p.responsible_user_id ?? null,
          status: p.status,
          stagesTotal: stages.filter((s) => s.status !== "no_aplica").length,
          stagesDone: stages.filter((s) => s.status === "completado").length,
          deadlines,
        };
      });
  }, [projects]);

  const agendaItems = useMemo<LitigioAgendaItem[]>(() => {
    return cases.flatMap((c) =>
      c.deadlines.map((dl) => ({
        ...dl,
        projectId: c.id,
        projectName: c.name,
        clientName: c.clientName,
        jurisdiction: c.jurisdiction,
        materia: c.materia,
        responsibleUserId: c.responsibleUserId,
      })),
    );
  }, [cases]);

  return { cases, agendaItems, isLoading };
}
