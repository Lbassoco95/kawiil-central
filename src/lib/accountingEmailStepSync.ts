import { supabase } from "@/integrations/supabase/client";
import type { AccountingStep, StepStatus } from "@/hooks/useAccountingPeriods";

/**
 * Cierre automático del paso del periodo contable al enviar la plantilla al cliente.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRATO (no romper al tocar la sección de Correo)
 * ─────────────────────────────────────────────────────────────────────────────
 * Cualquier composer que pueda insertar una plantilla contable
 * (`AccountingTemplatePicker`) DEBE, tras un envío exitoso, llamar a
 * `syncAccountingStepAfterEmail(...)` — en la práctica, usando el hook
 * `useAccountingEmailStepSync()` (src/hooks/useAccountingEmailStepSync.ts), que
 * además muestra el aviso, permite deshacer e invalida las queries.
 *
 * Puntos de envío que ya lo cumplen:
 *   - ComposeEmailDialog  → prop `onAfterSend` (cuenta principal, cuentas
 *     vinculadas Outlook/Gmail y respuesta enganchada al hilo).
 *   - ReplyForwardDialog  → prop `onTemplateApplied` + aviso de envío del padre
 *     (EmailView / MailPreview).
 *
 * Si agregas un nuevo composer o una nueva ruta de envío, engánchala aquí; la
 * prueba `accountingEmailStepSync.test.ts` cubre la lógica pura.
 */

/**
 * Categoría de plantilla contable → paso del periodo que se cierra al enviarla.
 * Todas las plantillas de declaraciones cierran "Envío de acuses al cliente":
 * mandar el correo con los acuses ES la evidencia de que el paso terminó.
 */
export const ACCOUNTING_EMAIL_STEP_BY_CATEGORY: Record<string, string> = {
  pagos_provisionales: "envio_acuses",
  declaracion_ceros: "envio_acuses",
  envio_anuales: "envio_acuses",
  previos_provisionales: "envio_acuses",
  isn_imss: "envio_acuses",
  envio_nominas: "envio_acuses",
};

/** Cuántos meses hacia atrás se busca el periodo al que pertenece el envío. */
const PERIOD_LOOKBACK_MONTHS = 3;

export interface SentAccountingEmailInfo {
  /** Categoría de la plantilla contable aplicada (sin ella no se hace nada). */
  templateCategory?: string | null;
  clientId?: string | null;
  clientName?: string | null;
  /** Contexto explícito cuando el correo se compone desde un proyecto. */
  projectId?: string | null;
  /** Contexto explícito cuando se conoce el periodo exacto. */
  periodId?: string | null;
  subject?: string | null;
  /** Destinatarios (para resolver el cliente cuando no se eligió en el picker). */
  recipients?: string[];
  attachmentNames?: string[];
  /** ISO. Default: ahora. */
  sentAt?: string;
}

export interface PeriodLike {
  id: string;
  project_id: string;
  year: number;
  month: number;
  steps: AccountingStep[];
}

export type AccountingStepSyncResult =
  | { status: "not_applicable" }
  | { status: "no_client" }
  | { status: "no_period"; clientName?: string | null }
  | {
      status: "already_completed";
      periodId: string;
      projectId: string;
      year: number;
      month: number;
      stepKey: string;
      stepLabel: string;
    }
  | {
      status: "completed";
      periodId: string;
      projectId: string;
      year: number;
      month: number;
      stepKey: string;
      stepLabel: string;
      /** Estado previo de `steps`, para poder deshacer. */
      previousSteps: AccountingStep[];
      previousStatus: string;
    }
  | { status: "error"; message: string };

/* ────────────────────────────── lógica pura ────────────────────────────── */

/** Paso que cierra el envío de una plantilla, o `null` si la categoría no aplica. */
export function stepKeyForTemplateCategory(category?: string | null): string | null {
  if (!category) return null;
  return ACCOUNTING_EMAIL_STEP_BY_CATEGORY[category] ?? null;
}

/**
 * Periodos candidatos para un envío, en orden de preferencia.
 *
 * Las declaraciones de un mes se presentan y se envían al cliente el mes
 * SIGUIENTE (los acuses de julio se mandan en agosto), así que el candidato
 * más probable es el mes anterior, luego el mes en curso y después los meses
 * previos dentro de la ventana.
 */
export function candidatePeriodKeys(sentAt: Date): { year: number; month: number }[] {
  const shift = (months: number) => {
    const d = new Date(sentAt.getFullYear(), sentAt.getMonth() - months, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  };
  const keys = [shift(1), shift(0)];
  for (let i = 2; i <= PERIOD_LOOKBACK_MONTHS; i++) keys.push(shift(i));
  return keys;
}

/**
 * Elige el periodo al que corresponde el envío: el primer candidato (mes
 * anterior → mes en curso → meses previos) que tenga el paso pendiente. Si
 * ninguno lo tiene pendiente pero alguno ya lo cerró, devuelve ese para poder
 * avisar que ya estaba completado.
 */
export function pickPeriodForSend<T extends PeriodLike>(
  periods: T[],
  stepKey: string,
  sentAt: Date,
): { period: T; alreadyCompleted: boolean } | null {
  const candidates = candidatePeriodKeys(sentAt);
  const matching = (year: number, month: number) =>
    periods.filter((p) => p.year === year && p.month === month);

  let fallback: T | null = null;
  for (const { year, month } of candidates) {
    for (const period of matching(year, month)) {
      const step = (period.steps ?? []).find((s) => s.key === stepKey);
      if (!step) continue;
      if (!step.completed) return { period, alreadyCompleted: false };
      if (!fallback) fallback = period;
    }
  }
  return fallback ? { period: fallback, alreadyCompleted: true } : null;
}

/**
 * Fusiona información parcial de una plantilla aplicada (el picker avisa por
 * partes: primero el cliente elegido, luego la plantilla). Los valores nulos o
 * indefinidos no pisan lo ya capturado.
 */
export function mergeSentAccountingEmailInfo(
  prev: SentAccountingEmailInfo | null | undefined,
  next: SentAccountingEmailInfo,
): SentAccountingEmailInfo {
  const out: SentAccountingEmailInfo = { ...(prev ?? {}) };
  for (const [key, value] of Object.entries(next)) {
    if (value === null || value === undefined) continue;
    (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/** Nota de auditoría que se anexa al paso cerrado por correo. */
export function buildStepNote(info: SentAccountingEmailInfo, sentAt: Date): string {
  const fecha = sentAt.toLocaleString("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const partes = [`Correo enviado el ${fecha}`];
  const destinatarios = (info.recipients ?? []).filter(Boolean);
  if (destinatarios.length) partes.push(`a ${destinatarios.join(", ")}`);
  if (info.subject) partes.push(`— «${info.subject}»`);
  const adjuntos = (info.attachmentNames ?? []).filter(Boolean);
  if (adjuntos.length) partes.push(`(adjuntos: ${adjuntos.join(", ")})`);
  return partes.join(" ");
}

/** Marca el paso como completado por envío de correo, conservando lo demás. */
export function applySentStep(
  steps: AccountingStep[],
  stepKey: string,
  opts: { userId?: string | null; sentAtIso: string; note: string },
): AccountingStep[] {
  return steps.map((s) =>
    s.key === stepKey
      ? {
          ...s,
          completed: true,
          completed_at: opts.sentAtIso,
          completed_by: opts.userId ?? s.completed_by ?? null,
          step_status: "completado" as StepStatus,
          date: s.date ?? opts.sentAtIso.slice(0, 10),
          notes: s.notes ? `${s.notes}\n${opts.note}` : opts.note,
        }
      : s,
  );
}

/** Mismo criterio que `useToggleAccountingStep` para el estatus del periodo. */
export function derivePeriodStatus(steps: AccountingStep[]): string {
  if (steps.length && steps.every((s) => s.completed)) return "completado";
  const anyStarted = steps.some((s) => s.completed || (s.step_status && s.step_status !== "pendiente"));
  return anyStarted ? "en_progreso" : "pendiente";
}

/* ───────────────────────────── orquestación ───────────────────────────── */

/** Resuelve el cliente por los destinatarios cuando no se eligió en el picker. */
async function resolveClientIdFromRecipients(
  recipients: string[],
): Promise<{ id: string; name: string } | null> {
  const emails = recipients
    .map((r) => r.trim().toLowerCase())
    .filter((e) => /^[^\s,@]+@[^\s,@]+$/.test(e));
  if (!emails.length) return null;
  // `ilike` para no depender de mayúsculas/minúsculas en `clients.email`.
  const { data } = await supabase
    .from("clients")
    .select("id, name, email")
    .or(emails.map((e) => `email.ilike.${e}`).join(","));
  const match = (data ?? []).find((c) =>
    c.email ? emails.includes(String(c.email).trim().toLowerCase()) : false,
  );
  return match ? { id: match.id, name: match.name } : null;
}

async function fetchCandidatePeriods(info: SentAccountingEmailInfo, clientId: string | null) {
  if (info.periodId) {
    const { data } = await supabase
      .from("accounting_periods")
      .select("id, project_id, year, month, steps, status")
      .eq("id", info.periodId)
      .maybeSingle();
    return data ? [data] : [];
  }

  let projectIds: string[] = [];
  if (info.projectId) {
    projectIds = [info.projectId];
  } else if (clientId) {
    const { data: projects } = await supabase.from("projects").select("id").eq("client_id", clientId);
    projectIds = (projects ?? []).map((p) => p.id);
  }
  if (!projectIds.length) return [];

  const { data } = await supabase
    .from("accounting_periods")
    .select("id, project_id, year, month, steps, status")
    .in("project_id", projectIds);
  return data ?? [];
}

/**
 * Cierra el paso del periodo que corresponde a la plantilla enviada.
 * No lanza: cualquier fallo se devuelve como `{ status: "error" }` para no
 * interrumpir el flujo de correo.
 */
export async function syncAccountingStepAfterEmail(
  info: SentAccountingEmailInfo,
  opts: { userId?: string | null } = {},
): Promise<AccountingStepSyncResult> {
  const stepKey = stepKeyForTemplateCategory(info.templateCategory);
  if (!stepKey) return { status: "not_applicable" };

  try {
    let clientId = info.clientId ?? null;
    let clientName = info.clientName ?? null;
    if (!clientId && !info.projectId && !info.periodId) {
      const resolved = await resolveClientIdFromRecipients(info.recipients ?? []);
      if (resolved) {
        clientId = resolved.id;
        clientName = clientName ?? resolved.name;
      }
    }
    if (!clientId && !info.projectId && !info.periodId) return { status: "no_client" };

    const rows = await fetchCandidatePeriods(info, clientId);
    const periods: PeriodLike[] = rows.map((r) => ({
      id: r.id,
      project_id: r.project_id,
      year: r.year,
      month: r.month,
      steps: (r.steps ?? []) as unknown as AccountingStep[],
    }));
    if (!periods.length) return { status: "no_period", clientName };

    const sentAt = info.sentAt ? new Date(info.sentAt) : new Date();
    const picked = pickPeriodForSend(periods, stepKey, sentAt);
    if (!picked) return { status: "no_period", clientName };

    const { period, alreadyCompleted } = picked;
    const step = period.steps.find((s) => s.key === stepKey)!;
    if (alreadyCompleted) {
      return {
        status: "already_completed",
        periodId: period.id,
        projectId: period.project_id,
        year: period.year,
        month: period.month,
        stepKey,
        stepLabel: step.label,
      };
    }

    const previousStatus =
      (rows.find((r) => r.id === period.id)?.status as string | undefined) ??
      derivePeriodStatus(period.steps);
    const sentAtIso = sentAt.toISOString();
    const updatedSteps = applySentStep(period.steps, stepKey, {
      userId: opts.userId,
      sentAtIso,
      note: buildStepNote(info, sentAt),
    });

    const { error } = await supabase
      .from("accounting_periods")
      .update({
        steps: updatedSteps as never,
        status: derivePeriodStatus(updatedSteps),
      })
      .eq("id", period.id);
    if (error) return { status: "error", message: error.message };

    return {
      status: "completed",
      periodId: period.id,
      projectId: period.project_id,
      year: period.year,
      month: period.month,
      stepKey,
      stepLabel: step.label,
      previousSteps: period.steps,
      previousStatus,
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : "Error desconocido" };
  }
}

/** Deshace el cierre automático (acción «Deshacer» del aviso). */
export async function revertAccountingStepSync(
  periodId: string,
  previousSteps: AccountingStep[],
  previousStatus: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("accounting_periods")
    .update({ steps: previousSteps as never, status: previousStatus })
    .eq("id", periodId);
  return !error;
}
