/** Onboarding — checklist de bienvenida del colaborador. */

export interface OnboardingTemplateItem {
  id: string;
  organization_id: string;
  label: string;
  position: number;
  created_at: string;
}

export interface OnboardingItem {
  id: string;
  organization_id: string;
  user_id: string;
  label: string;
  done: boolean;
  done_by: string | null;
  done_at: string | null;
  position: number;
  created_at: string;
}

/** Rol inicial sugerido para un colaborador recién contratado. */
export const CONVERT_ROLES: { value: string; label: string }[] = [
  { value: "ejecutor", label: "Ejecutor (colaborador)" },
  { value: "en_formacion", label: "En formación" },
  { value: "referente", label: "Referente" },
];

export function onboardingProgress(items: OnboardingItem[]): { done: number; total: number; pct: number } {
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0 };
}
