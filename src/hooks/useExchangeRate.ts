import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Una serie de tipo de cambio publicada por Banxico. */
export interface FxSeries {
  idSerie: string;
  label: string;
  titulo: string | null;
  valor: number;
  /** Fecha de la publicación en formato ISO (yyyy-MM-dd). */
  fecha: string;
  valorPrevio: number | null;
  fechaPrevia: string | null;
  cambio: number | null;
  cambioPct: number | null;
}

export interface ExchangeRateData {
  /** SF60653 — tipo de cambio para solventar obligaciones (el que publica el DOF). */
  obligaciones?: FxSeries;
  /** SF43718 — tipo de cambio FIX, como referencia. */
  fix?: FxSeries;
  consultadoEn: string;
}

/** Error con la causa que reporta la edge function, para poder distinguirla en la UI. */
export class ExchangeRateError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ExchangeRateError";
    this.code = code;
  }
}

/** Intenta leer el cuerpo JSON del error de una edge function (FunctionsHttpError). */
async function readErrorBody(error: unknown): Promise<{ error?: string; message?: string } | null> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx instanceof Response) {
    try {
      return await ctx.clone().json();
    } catch {
      return null;
    }
  }
  if (ctx && typeof ctx === "object") return ctx as { error?: string; message?: string };
  return null;
}

async function fetchExchangeRate(): Promise<ExchangeRateData> {
  const { data, error } = await supabase.functions.invoke("banxico-fx", { body: {} });
  if (error) {
    const body = await readErrorBody(error);
    if (body?.error) {
      throw new ExchangeRateError(body.error, body.message || "No se pudo obtener el tipo de cambio.");
    }
    const msg = String((error as Error)?.message || error);
    if (/failed to send|failed to fetch|not found/i.test(msg)) {
      throw new ExchangeRateError("not_deployed", "La función de tipo de cambio aún no está desplegada.");
    }
    throw new ExchangeRateError("invoke_error", "No se pudo obtener el tipo de cambio.");
  }
  if (data?.error) {
    throw new ExchangeRateError(String(data.error), data.message || "No se pudo obtener el tipo de cambio.");
  }
  return data as ExchangeRateData;
}

/**
 * Tipo de cambio oficial de Banxico. Banxico publica una sola vez al día
 * (días hábiles, ~12:00 h CT), así que refrescamos cada 30 min: suficiente para
 * ver el dato del día en cuanto sale sin castigar la cuota del token.
 */
export function useExchangeRate() {
  return useQuery({
    queryKey: ["banxico-fx"],
    queryFn: fetchExchangeRate,
    staleTime: 1000 * 60 * 30,
    refetchInterval: 1000 * 60 * 30,
    retry: 1,
  });
}

/** 18.4321 → "18.4321" con 4 decimales, como lo publica Banxico. */
export function formatFxValue(valor: number): string {
  return valor.toLocaleString("es-MX", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

/** "2026-08-24" → "24 ago" (o "24 ago 2026" si es de otro año). */
export function formatFxDate(iso: string, withYear = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  const label = new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    ...(withYear || y !== new Date().getFullYear() ? { year: "numeric" } : {}),
  })
    .format(date)
    .replace(/\./g, "");
  return label;
}

/** true si la publicación corresponde al día de hoy (hora local). */
export function isToday(iso: string): boolean {
  const now = new Date();
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  return iso === local;
}
