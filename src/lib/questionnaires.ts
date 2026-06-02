/** Cuestionarios (NOM-035 y clima) — tipos y helpers. */

export interface ScaleOption { label: string; value: number; }
export interface Band { level: string; label: string; color: string; min: number; }

export interface Questionnaire {
  id: string;
  organization_id: string;
  type: "nom035" | "clima" | "custom";
  title: string;
  description: string | null;
  scale: ScaleOption[];
  bands: Band[];
  higher_is_better: boolean;
  active: boolean;
  created_at: string;
}

export interface Question {
  id: string;
  organization_id: string;
  questionnaire_id: string;
  category: string | null;
  domain: string | null;
  text: string;
  reverse: boolean;
  position: number;
}

export interface SurveyResponse {
  id: string;
  organization_id: string;
  questionnaire_id: string;
  user_id: string;
  submitted_at: string;
}

export interface CategoryResult { category: string; avg: number; max: number; pct: number; }
export interface QuestionnaireResults {
  respondents: number;
  total_avg: number;
  total_max: number;
  categories: CategoryResult[];
}

/** Banda (nivel) en la que cae un puntaje total, según la tabla del cuestionario. */
export function bandFor(bands: Band[], total: number): Band | null {
  if (!bands?.length) return null;
  const sorted = [...bands].sort((a, b) => a.min - b.min);
  let match: Band | null = null;
  for (const b of sorted) if (total >= b.min) match = b;
  return match;
}

export const BAND_COLOR_STYLE: Record<string, string> = {
  emerald: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  amber: "border-amber-300 text-amber-700 dark:text-amber-400",
  red: "border-red-300 text-red-700 dark:text-red-400",
  slate: "border-border text-muted-foreground",
};

/**
 * Semáforo de una categoría según su porcentaje. En cuestionarios de riesgo
 * (higher_is_better=false) un % alto es malo; en clima, un % alto es bueno.
 */
export function categoryTone(pct: number, higherIsBetter: boolean): "emerald" | "amber" | "red" {
  const good = higherIsBetter ? pct >= 67 : pct < 34;
  const mid = pct >= 34 && pct < 67;
  if (good) return "emerald";
  if (mid) return "amber";
  return "red";
}
