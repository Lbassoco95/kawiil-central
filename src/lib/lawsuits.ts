import { toDateStringMX } from "@/lib/dateUtils";

export const LAWSUIT_STATUS_OPTIONS = [
  { value: "en_tramite", label: "En trámite", className: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
  { value: "en_apelacion", label: "En apelación", className: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  { value: "amparo", label: "Amparo", className: "bg-purple-500/10 text-purple-700 border-purple-500/30" },
  { value: "suspendido", label: "Suspendido", className: "bg-slate-500/10 text-slate-700 border-slate-500/30" },
  { value: "concluido", label: "Concluido", className: "bg-green-500/10 text-green-700 border-green-500/30" },
  { value: "archivado", label: "Archivado", className: "bg-muted text-muted-foreground border-border" },
];

export const LAWSUIT_TYPE_OPTIONS = [
  { value: "laboral", label: "Laboral" },
  { value: "mercantil", label: "Mercantil" },
  { value: "civil", label: "Civil" },
  { value: "fiscal", label: "Fiscal" },
  { value: "penal", label: "Penal" },
  { value: "administrativo", label: "Administrativo" },
  { value: "familiar", label: "Familiar" },
];

export const CLOSED_LAWSUIT_STATUSES = ["concluido", "archivado"];

export interface LawsuitStage {
  key: string;
  label: string;
  completed: boolean;
  completed_at: string | null;
}

export const DEFAULT_LAWSUIT_STAGES: LawsuitStage[] = [
  { key: "demanda", label: "Demanda" },
  { key: "emplazamiento", label: "Emplazamiento" },
  { key: "contestacion", label: "Contestación de demanda" },
  { key: "pruebas", label: "Ofrecimiento y admisión de pruebas" },
  { key: "desahogo", label: "Desahogo de pruebas" },
  { key: "alegatos", label: "Alegatos" },
  { key: "sentencia", label: "Sentencia" },
  { key: "apelacion", label: "Apelación" },
  { key: "amparo", label: "Amparo" },
  { key: "ejecucion", label: "Ejecución de sentencia" },
].map((s) => ({ ...s, completed: false, completed_at: null }));

/** Normaliza el JSON `stages` de la BD a una lista tipada (descarta basura). */
export function parseLawsuitStages(raw: unknown): LawsuitStage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (s): s is Record<string, unknown> =>
        !!s && typeof s === "object" && typeof (s as Record<string, unknown>).label === "string",
    )
    .map((s, i) => ({
      key: typeof s.key === "string" && s.key ? s.key : `etapa-${i}`,
      label: s.label as string,
      completed: s.completed === true,
      completed_at: typeof s.completed_at === "string" ? s.completed_at : null,
    }));
}

/** Etapa en curso: la primera sin completar (null si todas están completas o no hay etapas). */
export function currentStageLabel(stages: LawsuitStage[]): string | null {
  return stages.find((s) => !s.completed)?.label ?? null;
}

export interface LawsuitDateSource {
  id: string;
  name: string;
  project_id: string;
  status: string;
  next_hearing_date: string | null;
  next_deadline_date: string | null;
  next_deadline_note: string | null;
}

export interface LawsuitDeadline {
  lawsuitId: string;
  projectId: string;
  lawsuitName: string;
  kind: "audiencia" | "plazo";
  label: string;
  date: string;
  overdue: boolean;
}

/**
 * Aplana audiencias y plazos de juicios abiertos en una lista ordenada por fecha
 * (vencidos primero, luego los más próximos). Ignora juicios concluidos/archivados.
 */
export function collectLawsuitDeadlines(lawsuits: LawsuitDateSource[], today = toDateStringMX()): LawsuitDeadline[] {
  const out: LawsuitDeadline[] = [];
  for (const l of lawsuits) {
    if (CLOSED_LAWSUIT_STATUSES.includes(l.status)) continue;
    const base = { lawsuitId: l.id, projectId: l.project_id, lawsuitName: l.name };
    if (l.next_hearing_date) {
      out.push({ ...base, kind: "audiencia", label: "Audiencia", date: l.next_hearing_date, overdue: l.next_hearing_date < today });
    }
    if (l.next_deadline_date) {
      out.push({
        ...base,
        kind: "plazo",
        label: l.next_deadline_note?.trim() || "Plazo",
        date: l.next_deadline_date,
        overdue: l.next_deadline_date < today,
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
