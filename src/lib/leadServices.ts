import type { Database } from "@/integrations/supabase/types";
import { SERVICE_LABELS } from "@/lib/serviceLabels";

/**
 * Servicios que puede contratar un prospecto.
 *
 * Un lead puede buscar VARIOS servicios, así que la fuente de verdad es
 * `leads.service_types` (arreglo). `leads.service_type` (singular) se conserva
 * sincronizado con el servicio principal para lo que ya lo lee.
 *
 * "Backoffice" es un PAQUETE, no un servicio: se expande a Legal +
 * Contabilidad. Así los reportes suman por servicio real y un lead de
 * backoffice cuenta en ambos, sin una categoría ambigua de por medio.
 */

export type ServiceArea = Database["public"]["Enums"]["service_area"];

/** Orden de captura y de despliegue; también define el servicio principal. */
export const SERVICE_ORDER: readonly ServiceArea[] = [
  "softlanding",
  "constitucion_nacional",
  "contabilidad",
  "legal",
  "gestoria",
  "pld_ft",
  "cumplimiento",
  "representacion",
  "juicios",
] as const;

export interface ServiceBundle {
  key: string;
  label: string;
  hint: string;
  services: readonly ServiceArea[];
}

/** Paquetes comerciales que se capturan con un clic y se guardan expandidos. */
export const SERVICE_BUNDLES: readonly ServiceBundle[] = [
  {
    key: "backoffice",
    label: "Backoffice",
    hint: "Legal + Contabilidad",
    services: ["legal", "contabilidad"],
  },
] as const;

const SERVICE_SET = new Set<string>(SERVICE_ORDER);

export function isServiceArea(value: unknown): value is ServiceArea {
  return typeof value === "string" && SERVICE_SET.has(value);
}

/** Limpia lo que venga de la base o del formulario: válidos, sin duplicados y en orden. */
export function normalizeServices(input: unknown): ServiceArea[] {
  const raw = Array.isArray(input) ? input : input == null ? [] : [input];
  const picked = new Set<ServiceArea>();
  for (const v of raw) {
    if (isServiceArea(v)) picked.add(v);
  }
  return SERVICE_ORDER.filter((s) => picked.has(s));
}

export function toggleService(current: readonly ServiceArea[], service: ServiceArea): ServiceArea[] {
  const next = new Set(normalizeServices(current));
  if (next.has(service)) next.delete(service);
  else next.add(service);
  return SERVICE_ORDER.filter((s) => next.has(s));
}

/** El paquete está activo cuando TODOS sus servicios están seleccionados. */
export function isBundleSelected(
  current: readonly ServiceArea[],
  bundle: ServiceBundle,
): boolean {
  const set = new Set(normalizeServices(current));
  return bundle.services.length > 0 && bundle.services.every((s) => set.has(s));
}

/**
 * Activa o desactiva un paquete completo. Desactivarlo quita sus servicios;
 * si además se habían elegido por separado, igual se van (es lo esperado al
 * apagar el paquete: se puede volver a marcar el que sí aplique).
 */
export function toggleBundle(
  current: readonly ServiceArea[],
  bundle: ServiceBundle,
): ServiceArea[] {
  const set = new Set(normalizeServices(current));
  if (isBundleSelected(current, bundle)) {
    for (const s of bundle.services) set.delete(s);
  } else {
    for (const s of bundle.services) set.add(s);
  }
  return SERVICE_ORDER.filter((s) => set.has(s));
}

/** Servicio principal (el primero según SERVICE_ORDER); alimenta `service_type`. */
export function primaryService(current: readonly ServiceArea[]): ServiceArea | null {
  return normalizeServices(current)[0] ?? null;
}

/** Etiquetas legibles, ya normalizadas: "Soft Landing, Contabilidad". */
export function formatServices(current: readonly ServiceArea[]): string {
  const list = normalizeServices(current).map((s) => SERVICE_LABELS[s]);
  return list.join(", ");
}

/** Paquetes que quedan cubiertos por la selección actual (para mostrarlos como chip). */
export function activeBundles(current: readonly ServiceArea[]): ServiceBundle[] {
  return SERVICE_BUNDLES.filter((b) => isBundleSelected(current, b));
}

// ─── Modelo de cobro y proyección ─────────────────────────────────────

/**
 * Cómo se cobra cada servicio. Es lo que separa el pago único del ingreso
 * recurrente en las proyecciones: un Soft Landing se cobra una vez, mientras
 * el backoffice (legal + contabilidad) es mensualidad.
 */
export type BillingModel = "one_time" | "monthly";

export const SERVICE_BILLING: Record<ServiceArea, BillingModel> = {
  softlanding: "one_time",
  constitucion_nacional: "one_time",
  gestoria: "one_time",
  juicios: "one_time",
  contabilidad: "monthly",
  legal: "monthly",
  pld_ft: "monthly",
  cumplimiento: "monthly",
  representacion: "monthly",
};

/**
 * Servicios que normalmente acompañan a otro. Un Soft Landing (o una
 * constitución) casi siempre sigue con el backoffice de seguimiento mensual,
 * así que la captura lo sugiere en vez de dejar el recurrente sin registrar.
 */
export const SERVICE_COMPANIONS: Partial<Record<ServiceArea, readonly ServiceArea[]>> = {
  softlanding: ["legal", "contabilidad"],
  constitucion_nacional: ["legal", "contabilidad"],
};

/** Meses de compromiso por defecto para proyectar el recurrente. */
export const DEFAULT_CONTRACT_MONTHS = 12;

export interface ValueBreakdown {
  oneTime: number | null;
  monthly: number | null;
  months: number | null;
}

/** Separa los servicios elegidos según cómo se cobran. */
export function splitByBilling(current: readonly ServiceArea[]): {
  oneTime: ServiceArea[];
  monthly: ServiceArea[];
} {
  const list = normalizeServices(current);
  return {
    oneTime: list.filter((s) => SERVICE_BILLING[s] === "one_time"),
    monthly: list.filter((s) => SERVICE_BILLING[s] === "monthly"),
  };
}

/** Servicios que suelen acompañar a la selección y todavía no están marcados. */
export function suggestedCompanions(current: readonly ServiceArea[]): ServiceArea[] {
  const selected = new Set(normalizeServices(current));
  const out = new Set<ServiceArea>();
  for (const s of selected) {
    for (const companion of SERVICE_COMPANIONS[s] ?? []) {
      if (!selected.has(companion)) out.add(companion);
    }
  }
  return SERVICE_ORDER.filter((s) => out.has(s));
}

export function contractMonths(months: number | null | undefined): number {
  if (months == null || !Number.isFinite(months)) return DEFAULT_CONTRACT_MONTHS;
  return Math.max(1, Math.trunc(months));
}

/**
 * Valor total del contrato: pago único + mensualidad × meses. Es lo que se
 * guarda en `estimated_value` para que el tablero y Savio sigan cuadrando.
 */
export function computeTcv(breakdown: ValueBreakdown): number {
  const oneTime = Number.isFinite(breakdown.oneTime as number) ? Number(breakdown.oneTime) : 0;
  const monthly = Number.isFinite(breakdown.monthly as number) ? Number(breakdown.monthly) : 0;
  const months = monthly > 0 ? contractMonths(breakdown.months) : 0;
  return Math.round((oneTime + monthly * months) * 100) / 100;
}
