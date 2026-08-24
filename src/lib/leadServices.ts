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
