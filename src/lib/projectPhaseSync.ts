import { supabase } from "@/integrations/supabase/client";
import { getMonthName } from "@/hooks/useAccountingPeriods";
import { COMPLIANCE_CATEGORY_LABELS, COMPLIANCE_CATEGORY_ORDER } from "@/lib/compliancePhaseCatalog";
import { getGestoriaPhases } from "@/lib/gestoriaTramiteCatalog";

export type SyncPhase = { key: string; name: string; order: number };

/** `phase_key` en tareas del proyecto para un periodo contable. */
export function accountingPeriodPhaseKey(periodId: string) {
  return `acct_period_${periodId}`;
}

/** `phase_key` para fases fijas de gestoría (1–4). */
export function gestoriaPhaseKey(phaseNumber: number) {
  return `gestoria_fase_${phaseNumber}`;
}

/** Fusiona fases en `projects.phases` sin duplicar `key` (nuevas van al final). */
export async function appendProjectPhases(projectId: string, additions: SyncPhase[]): Promise<boolean> {
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
  return appendProjectPhases(projectId, additions);
}

/**
 * Asegura las fases de gestoría en `projects.phases` según el tipo de trámite
 * (RPC/COFEPRIS/IMPI). Sin `tramiteType` usa el fallback legacy (SAT) para no
 * romper gestorías creadas antes del catálogo.
 */
export async function ensureGestoriaPhasesOnProject(
  projectId: string,
  tramiteType?: string | null,
): Promise<boolean> {
  const additions = getGestoriaPhases(tramiteType).map((p) => ({
    key: gestoriaPhaseKey(p.number),
    name: `Fase ${p.number}: ${p.label}`,
    order: 0,
  }));
  return appendProjectPhases(projectId, additions);
}

/** Asegura entradas en `projects.phases` por categoría de cumplimiento (alineado con tab Tareas). */
export async function ensureCompliancePhasesOnProject(projectId: string): Promise<boolean> {
  const additions = COMPLIANCE_CATEGORY_ORDER.map((key) => ({
    key,
    name: COMPLIANCE_CATEGORY_LABELS[key] || key,
    order: 0,
  }));
  return appendProjectPhases(projectId, additions);
}
