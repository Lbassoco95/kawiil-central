import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Las tablas mk_* aún no están en los tipos generados: se consultan sin tipos y se tipan aquí.
// Solo lectura: esta capa no escribe ni llama a Metricool.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mk = (tabla: string) => (supabase as any).from(tabla);

export type Red = "instagram" | "facebook" | "linkedin";
export const REDES: Red[] = ["instagram", "facebook", "linkedin"];
export const RED_LABEL: Record<Red, string> = { instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn" };

export interface PiezaRed {
  id: string;
  red: Red;
  estado: "pendiente" | "publicada" | "con_errores";
  publicada_at: string | null;
  mensaje_error: string | null;
  hora_estimada: boolean;
}
export interface Pieza {
  id: string;
  codigo: string | null;
  titulo: string | null;
  pilar: string | null;
  formato: string | null;
  fecha: string | null;
  proposito: string | null;
  primera_publicacion_at: string | null;
  mk_pieza_red: PiezaRed[];
}
export interface Calibracion {
  id: string;
  semana_inicio: string;
  red: Red;
  piezas_calculadas: number | null;
  promedio_calculado: number | null;
  piezas_calendario: number | null;
  promedio_calendario: number | null;
  color_calculado: "verde" | "amarillo" | "rojo" | "gris" | null;
  motivo_gris: "sin_piezas_publicadas" | "sin_datos_fuente" | null;
  diferencia: number | null;
  nota: string | null;
}
export interface EvidenciaItem { tipo?: string; estado?: string; dato: string; fuente?: string }
export interface Caso {
  id: string;
  numero: number;
  tipo: string;
  red: Red | null;
  titulo: string;
  descripcion: string | null;
  evidencia: EvidenciaItem[];
  estado: string;
  responsable: string;
  detectado_at: string;
  pieza_id: string | null;
}
export interface Regla {
  id: string; codigo: string; nombre: string; descripcion: string | null;
  parametros: Record<string, unknown>; activa: boolean; version: number; updated_at: string;
}
export interface ReglaHistorial {
  id: string; regla_id: string; version: number;
  parametros_anteriores: Record<string, unknown> | null; parametros_nuevos: Record<string, unknown>;
  activa: boolean; motivo: string; cambiado_at: string;
}
export interface Cobertura { red: Red; fuente: string; desde: string; hasta: string; nota: string | null }

function useTabla<T>(clave: string, consulta: () => Promise<{ data: T[] | null; error: unknown }>) {
  return useQuery({
    queryKey: ["marketing", clave],
    queryFn: async () => {
      const { data, error } = await consulta();
      if (error) throw error;
      return (data ?? []) as T[];
    },
    staleTime: 60_000,
  });
}

export const usePiezas = () =>
  useTabla<Pieza>("piezas", () =>
    mk("mk_pieza")
      .select("id,codigo,titulo,pilar,formato,fecha,proposito,primera_publicacion_at,mk_pieza_red(id,red,estado,publicada_at,mensaje_error,hora_estimada)")
      .order("fecha", { ascending: false })
      .order("codigo", { ascending: false }));

export const useCalibracion = () =>
  useTabla<Calibracion>("calibracion", () => mk("mk_calibracion").select("*").order("semana_inicio", { ascending: false }));

export const useCasos = () =>
  useTabla<Caso>("casos", () => mk("mk_caso").select("*").order("numero", { ascending: true }));

export const useReglas = () =>
  useTabla<Regla>("reglas", () => mk("mk_regla").select("*").order("codigo", { ascending: true }));

export const useReglaHistorial = () =>
  useTabla<ReglaHistorial>("regla_historial", () => mk("mk_regla_historial").select("*").order("cambiado_at", { ascending: false }));

export const useCobertura = () =>
  useTabla<Cobertura>("cobertura", () => mk("mk_cobertura_fuente").select("red,fuente,desde,hasta,nota"));
