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
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

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
  rating: number;
  status: RhCandidateStatus;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
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
