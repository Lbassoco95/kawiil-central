/**
 * Seguimiento del cierre / baja de clientes.
 *
 * Se persiste en `clients.offboarding` (JSONB). NULL = el cliente no está en
 * proceso de baja. No bloquea nada: es una estructura de seguimiento.
 */

export type OffboardingStage = "en_proceso" | "cerrado";

export interface OffboardingStep {
  key: string;
  label: string;
  done: boolean;
  /** Nota opcional del paso (quién, cómo, referencia). */
  note?: string;
  /** Fecha en que se completó el paso (YYYY-MM-DD), opcional. */
  date?: string | null;
}

export interface ClientOffboarding {
  stage: OffboardingStage;
  /** Motivo de la baja. */
  reason?: string;
  /** Fecha objetivo de salida (YYYY-MM-DD). */
  target_exit_date?: string | null;
  /** Responsable de coordinar el cierre. */
  closing_responsible_user_id?: string | null;
  steps: OffboardingStep[];
  notes?: string;
  started_at?: string;
  started_by?: string | null;
  closed_at?: string | null;
  closed_by?: string | null;
}

/** Pasos por defecto del cierre de un cliente en Kawiil. */
export const DEFAULT_OFFBOARDING_STEP_DEFS: { key: string; label: string }[] = [
  { key: "aviso_cliente", label: "Aviso formal de terminación con el cliente" },
  { key: "entrega_docs", label: "Entrega de documentación e información al cliente" },
  { key: "baja_accesos", label: "Baja de accesos y devolución de e.firma / credenciales" },
  { key: "cobranza", label: "Cobranza pendiente saldada" },
  { key: "respaldo_dropbox", label: "Respaldo / cierre de carpeta en Dropbox" },
  { key: "cierre_savio", label: "Cierre en Savio (cobranza)" },
  { key: "baja_sat", label: "Baja de obligaciones / avisos ante el SAT" },
  { key: "aviso_equipo", label: "Comunicación interna al equipo" },
];

export function buildDefaultOffboardingSteps(): OffboardingStep[] {
  return DEFAULT_OFFBOARDING_STEP_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    done: false,
    note: "",
    date: null,
  }));
}

/** Normaliza el JSON crudo de la columna a un objeto tipado (o null). */
export function parseOffboarding(raw: unknown): ClientOffboarding | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const stage = o.stage === "cerrado" ? "cerrado" : "en_proceso";
  const steps = Array.isArray(o.steps)
    ? (o.steps as Record<string, unknown>[]).map((s) => ({
        key: String(s.key ?? ""),
        label: String(s.label ?? ""),
        done: s.done === true,
        note: typeof s.note === "string" ? s.note : "",
        date: typeof s.date === "string" ? s.date : null,
      }))
    : buildDefaultOffboardingSteps();
  return {
    stage,
    reason: typeof o.reason === "string" ? o.reason : "",
    target_exit_date: typeof o.target_exit_date === "string" ? o.target_exit_date : null,
    closing_responsible_user_id:
      typeof o.closing_responsible_user_id === "string" ? o.closing_responsible_user_id : null,
    steps,
    notes: typeof o.notes === "string" ? o.notes : "",
    started_at: typeof o.started_at === "string" ? o.started_at : undefined,
    started_by: typeof o.started_by === "string" ? o.started_by : null,
    closed_at: typeof o.closed_at === "string" ? o.closed_at : null,
    closed_by: typeof o.closed_by === "string" ? o.closed_by : null,
  };
}

/** Porcentaje de avance del cierre (0–100) según pasos completados. */
export function offboardingProgress(o: ClientOffboarding | null): number {
  if (!o || o.steps.length === 0) return 0;
  const done = o.steps.filter((s) => s.done).length;
  return Math.round((done / o.steps.length) * 100);
}
