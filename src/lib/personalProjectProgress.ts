/**
 * Avance agregado de proyectos para el dashboard personal (responsable).
 */

export type StepCount = { done: number; total: number };

function pct(done: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((done / total) * 100);
}

/** Pasos en constitution_details (constitución / gestoría). */
export function countConstitutionLikeSteps(details: unknown): StepCount | null {
  if (!details || typeof details !== "object") return null;
  const d = details as { steps?: unknown[]; has_foreign_partners?: boolean };
  if (!Array.isArray(d.steps) || d.steps.length === 0) return null;
  const hasForeign = d.has_foreign_partners !== false;
  const visible = d.steps.filter((s: any) => !s?.conditional || hasForeign);
  if (visible.length === 0) return null;
  const done = visible.filter((s: any) => s?.status === "completado").length;
  return { done, total: visible.length };
}

/** Etapas en lawsuit_details.stages. */
export function countLawsuitStages(details: unknown): StepCount | null {
  if (!details || typeof details !== "object") return null;
  const stages = (details as { stages?: unknown[] }).stages;
  if (!Array.isArray(stages) || stages.length === 0) return null;
  const done = stages.filter((s: any) => s?.status === "completado").length;
  return { done, total: stages.length };
}

/** Suma pasos de periodos contables del proyecto. */
export function countAccountingStepsFromPeriods(
  periods: { steps?: unknown }[],
): StepCount | null {
  let done = 0;
  let total = 0;
  for (const p of periods) {
    const steps = p.steps;
    if (!Array.isArray(steps)) continue;
    for (const s of steps) {
      total++;
      const st = (s as any)?.step_status || ((s as any)?.completed ? "completado" : "pendiente");
      if (st === "completado") done++;
    }
  }
  if (total === 0) return null;
  return { done, total };
}

/** Suma pasos de declaraciones anuales del proyecto. */
export function countAnnualDeclarationSteps(
  declarations: { steps?: unknown }[],
): StepCount | null {
  let done = 0;
  let total = 0;
  for (const d of declarations) {
    const steps = d.steps;
    if (!Array.isArray(steps)) continue;
    for (const s of steps) {
      total++;
      const st = (s as any)?.step_status || ((s as any)?.completed ? "completado" : "pendiente");
      if (st === "completado") done++;
    }
  }
  if (total === 0) return null;
  return { done, total };
}

export function countBoardTasksForProject(
  tasks: { status: string }[],
): StepCount | null {
  if (tasks.length === 0) return null;
  if (tasks.every((t) => t.status === "cancelada")) return null;
  const open = tasks.filter((t) => ["pendiente", "en_progreso", "en_revision"].includes(t.status));
  const done = tasks.filter((t) => t.status === "completada").length;
  const total = open.length + done;
  if (total <= 0) return null;
  return { done, total };
}

export type PrimaryPipelineKind =
  | "contabilidad"
  | "constitucion"
  | "gestoria"
  | "juicio"
  | "declaracion_anual"
  | "tareas";

export function resolvePrimaryPipeline(args: {
  area: string | null | undefined;
  constitution: StepCount | null;
  lawsuit: StepCount | null;
  accounting: StepCount | null;
  annual: StepCount | null;
  tasks: StepCount | null;
}): { kind: PrimaryPipelineKind; label: string; count: StepCount } | null {
  const { area, constitution, lawsuit, accounting, annual, tasks } = args;

  if (area === "contabilidad" && accounting && accounting.total > 0) {
    return { kind: "contabilidad", label: "Flujo contable (pasos)", count: accounting };
  }
  if (accounting && accounting.total > 0) {
    return { kind: "contabilidad", label: "Flujo contable (pasos)", count: accounting };
  }
  if (area === "gestoria" && constitution && constitution.total > 0) {
    return { kind: "gestoria", label: "Gestoría (pasos)", count: constitution };
  }
  if (constitution && constitution.total > 0) {
    return { kind: "constitucion", label: "Constitución (pasos)", count: constitution };
  }
  if (lawsuit && lawsuit.total > 0) {
    return { kind: "juicio", label: "Juicio (etapas)", count: lawsuit };
  }
  if (annual && annual.total > 0) {
    return { kind: "declaracion_anual", label: "Declaración anual (pasos)", count: annual };
  }
  if (tasks && tasks.total > 0) {
    return { kind: "tareas", label: "Tareas del tablero", count: tasks };
  }
  return null;
}

export { pct };
