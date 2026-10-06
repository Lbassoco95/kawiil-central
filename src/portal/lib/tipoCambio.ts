/**
 * Tipo de cambio Banxico para el header del portal.
 *
 * Fuente de verdad: kawiil-central Edge `banxico-fx` (series SF60653 / SF43718).
 * Camino de publicación (Fase 1): central publica → tabla `portal_market_fx` en OS
 * → `portal-api` `v1/mercado.tipo_cambio`. El navegador solo llama a portal-api.
 */
import { callApi, PortalApiError } from "./api";
import { isDesignPreview } from "./designPreview";

export const TC_FETCH_PATH =
  "kawiil-central Edge banxico-fx (SF60653 solventar obligaciones / SF43718 FIX) → publicar a portal_market_fx → portal-api v1/mercado.tipo_cambio";

export type TipoCambioStatus = "ok" | "pending_publish" | "unavailable";

export type TipoCambioPayload = {
  status: TipoCambioStatus;
  valor: number | null;
  fecha: string | null;
  serie: string;
  label: string;
  fetch_path: string;
  source: "banxico" | "portal_market_fx";
  fix_valor?: number | null;
  fix_fecha?: string | null;
};

const PLACEHOLDER: TipoCambioPayload = {
  status: "pending_publish",
  valor: null,
  fecha: null,
  serie: "SF60653",
  label: "Para solventar obligaciones",
  fetch_path: TC_FETCH_PATH,
  source: "banxico",
};

export function formatTcValue(valor: number): string {
  return valor.toLocaleString("es-MX", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

/** Etiqueta compacta del chip: valor real o placeholder claro (sin inventar cifra). */
export function tcChipLabel(tc: TipoCambioPayload | null, loading: boolean): string {
  if (loading) return "TC · …";
  if (tc?.status === "ok" && tc.valor != null) return `TC ${formatTcValue(tc.valor)}`;
  return "TC · —";
}

export function tcChipTitle(tc: TipoCambioPayload | null): string {
  if (tc?.status === "ok" && tc.valor != null && tc.fecha) {
    return `${tc.label}: ${formatTcValue(tc.valor)} MXN/USD · publicado ${tc.fecha} · ${tc.serie}`;
  }
  return `Tipo de cambio Banxico pendiente de publicación. Camino: ${TC_FETCH_PATH}`;
}

let cache: { at: number; data: TipoCambioPayload } | null = null;
const TTL_MS = 1000 * 60 * 30;

export async function fetchTipoCambio(): Promise<TipoCambioPayload> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  try {
    const data = await callApi<TipoCambioPayload>("mercado.tipo_cambio", {});
    const normalized: TipoCambioPayload = {
      ...PLACEHOLDER,
      ...data,
      fetch_path: data.fetch_path || TC_FETCH_PATH,
    };
    cache = { at: Date.now(), data: normalized };
    return normalized;
  } catch (e) {
    // En /diseno o sin edge desplegada: placeholder, no inventar tipo de cambio.
    if (e instanceof PortalApiError || isDesignPreview()) {
      return { ...PLACEHOLDER, status: "unavailable" };
    }
    return { ...PLACEHOLDER, status: "unavailable" };
  }
}
