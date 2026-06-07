/** Reclutamiento y selección — tipos y constantes compartidas. */

export type RhProcessStatus = "open" | "paused" | "closed" | "filled";
export type RhCandidateStatus = "active" | "hired" | "rejected" | "withdrawn";
export type RhCandidateActivityType =
  | "note"
  | "email"
  | "stage_change"
  | "status_change"
  | "interview";

export interface RecruitmentProcess {
  id: string;
  organization_id: string;
  title: string;
  area: string | null;
  celula_id: string | null;
  description: string | null;
  status: RhProcessStatus;
  grade: string | null;
  budget: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Grados del modelo de talento (G1–G4). */
export const GRADES = ["G1", "G2", "G3", "G4"];

export interface RecruitmentStage {
  id: string;
  organization_id: string;
  process_id: string;
  name: string;
  position: number;
  created_at: string;
}

export interface RecruitmentState {
  id: string;
  organization_id: string;
  process_id: string;
  name: string;
  color: string;
  position: number;
  is_default: boolean;
  created_at: string;
}

export interface Candidate {
  id: string;
  organization_id: string;
  process_id: string;
  stage_id: string | null;
  state_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  resume_url: string | null;
  assessment_url: string | null;
  rating: number;
  status: RhCandidateStatus;
  notes: string | null;
  // Ficha ampliada (Fase A)
  university: string | null;
  degree: string | null;
  education_status: EducationStatus | null;
  skills: string[];
  years_experience: number | null;
  salary_expectation: number | null;
  available_from: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type EducationStatus = "titulado" | "pasante" | "trunco";

export const EDUCATION_STATUS_LABEL: Record<EducationStatus, string> = {
  titulado: "Titulado",
  pasante: "Pasante",
  trunco: "Trunco",
};

export const EDUCATION_STATUSES: EducationStatus[] = ["titulado", "pasante", "trunco"];

/** Rúbrica (Fase B) */
export interface RecruitmentCriterion {
  id: string;
  organization_id: string;
  process_id: string;
  name: string;
  weight: number;
  position: number;
  created_at: string;
}

export interface CandidateScore {
  id: string;
  organization_id: string;
  candidate_id: string;
  criterion_id: string;
  score: number;
  scored_by: string | null;
  updated_at: string;
}

/** Criterios por defecto al crear una vacante (set genérico, pesos iguales). */
export const DEFAULT_CRITERIA: { name: string; weight: number }[] = [
  { name: "Experiencia", weight: 1 },
  { name: "Habilidades técnicas", weight: 1 },
  { name: "Comunicación", weight: 1 },
  { name: "Cultura / actitud", weight: 1 },
];

/**
 * Promedio ponderado (1..5) de las calificaciones de un candidato.
 * Solo considera criterios con calificación registrada. Devuelve null si no hay.
 */
export function weightedScore(
  criteria: RecruitmentCriterion[],
  scores: CandidateScore[],
): number | null {
  const byCriterion = new Map(scores.map((s) => [s.criterion_id, s.score]));
  let num = 0;
  let den = 0;
  for (const c of criteria) {
    const s = byCriterion.get(c.id);
    if (s == null) continue;
    num += s * c.weight;
    den += c.weight;
  }
  if (den === 0) return null;
  return num / den;
}

/** Semáforo: verde ≥ 4, ámbar ≥ 3, rojo < 3. */
export function scoreSemaphore(score: number | null): "green" | "amber" | "red" | "none" {
  if (score == null) return "none";
  if (score >= 4) return "green";
  if (score >= 3) return "amber";
  return "red";
}

export const SEMAPHORE_DOT: Record<"green" | "amber" | "red" | "none", string> = {
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  none: "bg-muted-foreground/30",
};

export const SEMAPHORE_TEXT: Record<"green" | "amber" | "red" | "none", string> = {
  green: "text-emerald-600 dark:text-emerald-400",
  amber: "text-amber-600 dark:text-amber-400",
  red: "text-red-600 dark:text-red-400",
  none: "text-muted-foreground",
};

/** Plantillas de email (Fase C) */
export interface EmailTemplate {
  id: string;
  organization_id: string;
  name: string;
  subject: string;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Variables disponibles para las plantillas (clave → descripción de ayuda). */
export const TEMPLATE_VARIABLES: { key: string; help: string }[] = [
  { key: "{{nombre}}", help: "Primer nombre del candidato" },
  { key: "{{nombre_completo}}", help: "Nombre completo" },
  { key: "{{vacante}}", help: "Título de la vacante" },
  { key: "{{empresa}}", help: "Nombre de la organización" },
  { key: "{{fase}}", help: "Fase actual del candidato" },
  { key: "{{correo}}", help: "Correo del candidato" },
];

/** Sustituye las variables {{clave}} por sus valores. Las desconocidas quedan vacías. */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => vars[key] ?? "");
}

export interface CandidateActivity {
  id: string;
  organization_id: string;
  candidate_id: string;
  activity_type: RhCandidateActivityType;
  content: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any>;
  created_by: string | null;
  created_at: string;
}

export const PROCESS_STATUS_LABEL: Record<RhProcessStatus, string> = {
  open: "Abierta",
  paused: "En pausa",
  closed: "Cerrada",
  filled: "Cubierta",
};

export const PROCESS_STATUS_STYLE: Record<RhProcessStatus, string> = {
  open: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  paused: "border-amber-300 text-amber-700 dark:text-amber-400",
  closed: "border-border text-muted-foreground",
  filled: "border-sky-300 text-sky-700 dark:text-sky-400",
};

export const CANDIDATE_STATUS_LABEL: Record<RhCandidateStatus, string> = {
  active: "En proceso",
  hired: "Contratado",
  rejected: "Descartado",
  withdrawn: "Declinó",
};

export const CANDIDATE_STATUS_STYLE: Record<RhCandidateStatus, string> = {
  active: "border-sky-300 text-sky-700 dark:text-sky-400",
  hired: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  rejected: "border-red-300 text-red-700 dark:text-red-400",
  withdrawn: "border-border text-muted-foreground",
};

export const ACTIVITY_LABEL: Record<RhCandidateActivityType, string> = {
  note: "Nota",
  email: "Correo",
  stage_change: "Cambio de fase",
  status_change: "Cambio de estado",
  interview: "Entrevista",
};

/** Fases por defecto al crear una vacante. */
export const DEFAULT_STAGES = [
  "Postulado",
  "Entrevista RH",
  "Entrevista técnica",
  "Oferta",
  "Contratado",
];

/** Estados por defecto al crear una vacante (el primero es el inicial). */
export const DEFAULT_STATES: { name: string; color: string }[] = [
  { name: "En proceso", color: "sky" },
  { name: "Contratado", color: "emerald" },
  { name: "Descartado", color: "red" },
  { name: "Declinó", color: "slate" },
];

/** Paleta disponible para estados personalizados. */
export const STATE_COLORS = ["sky", "emerald", "amber", "red", "violet", "slate"] as const;
export type StateColor = (typeof STATE_COLORS)[number];

export const STATE_COLOR_STYLE: Record<string, string> = {
  sky: "border-sky-300 text-sky-700 dark:text-sky-400",
  emerald: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  amber: "border-amber-300 text-amber-700 dark:text-amber-400",
  red: "border-red-300 text-red-700 dark:text-red-400",
  violet: "border-violet-300 text-violet-700 dark:text-violet-400",
  slate: "border-border text-muted-foreground",
};
