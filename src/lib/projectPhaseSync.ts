import { supabase } from "@/integrations/supabase/client";
import { getMonthName } from "@/hooks/useAccountingPeriods";

export type SyncPhase = { key: string; name: string; order: number };

/** `phase_key` en tareas del proyecto para un periodo contable. */
export function accountingPeriodPhaseKey(periodId: string) {
  return `acct_period_${periodId}`;
}

/** `phase_key` para fases fijas de gestoría (1–4). */
export function gestoriaPhaseKey(phaseNumber: number) {
  return `gestoria_fase_${phaseNumber}`;
}

async function mergePhasesIntoProject(projectId: string, additions: SyncPhase[]): Promise<boolean> {
  const { data, error } = await supabase.from("projects").select("phases").eq("id", projectId).single();
  if (error) throw error;
  const cur = Array.isArray(data?.phases) ? [...(data.phases as SyncPhase[])] : [];
  const keys = new Set(cur.map((p) => p.key));
  let maxOrder = cur.reduce((m, p) => Math.max(m, p.order ?? 0), -1);
  let changed = false;
  for (const a of additions) {
    if (keys.has(a.key)) continue;
    maxOrder += 1;
    cur.push({ key: a.key, name: a.name, order: maxOrder });
    keys.add(a.key);
    changed = true;
  }
  if (!changed) return false;
  const { error: upErr } = await supabase.from("projects").update({ phases: cur } as any).eq("id", projectId);
  if (upErr) throw upErr;
  return true;
}

/** Asegura una entrada en `projects.phases` por periodo contable (tab Tareas y DnD alineados). */
export async function ensureAccountingPeriodPhasesOnProject(
  projectId: string,
  periods: { id: string; month: number; year: number }[]
): Promise<boolean> {
  const additions = periods.map((p) => ({
    key: accountingPeriodPhaseKey(p.id),
    name: `${getMonthName(p.month)} ${p.year}`,
    order: 0,
  }));
  return mergePhasesIntoProject(projectId, additions);
}

const GESTORIA_PHASE_LABELS = [
  { number: 1, name: "Fase 1: Documentación y requisitos previos" },
  { number: 2, name: "Fase 2: Trámite de RFC" },
  { number: 3, name: "Fase 3: Trámite de e.firma" },
  { number: 4, name: "Fase 4: Entrega" },
];

export async function ensureGestoriaPhasesOnProject(projectId: string): Promise<boolean> {
  const additions = GESTORIA_PHASE_LABELS.map((p) => ({
    key: gestoriaPhaseKey(p.number),
    name: p.name,
    order: 0,
  }));
  return mergePhasesIntoProject(projectId, additions);
}
