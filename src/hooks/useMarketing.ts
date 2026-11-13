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
export interface ColchonLectura {
  id: string; fecha: string; red: Red; ultima_programada: string | null; dias: number;
  color: "verde" | "amarillo" | "rojo"; tope: boolean; programadas: number; simulada: boolean; corrida_at: string;
}
export interface InformeContenido {
  fecha: string; simulada: boolean; ventana_dias: number;
  colchon: Array<{ red: Red; dias: number; color: "verde" | "amarillo" | "rojo"; ultima: string | null; tope: boolean }>;
  faltantes: Array<{ fecha: string; hora: string; codigo: string; pilar: string | null; formato: string | null; redes: Red[] }>;
  con_error: Array<{ red: Red; fecha: string; hora: string; estado: string }>;
  desconocidos: Array<{ red: Red; fecha: string; hora: string; estado: string }>;
  piezas_calendario_en_ventana: number; necesita_direccion: string[];
}
export interface InformeDiario { id: string; fecha: string; contenido: InformeContenido; simulada: boolean; created_at: string }
export interface CorridaVigilante { id: string; agente: string; accion: string; resultado: string; detalle: { simulada?: boolean } | null; registrado_at: string }
export interface FilaBitacora { id: string; agente: string; accion: string; resultado: string; caso_id: string | null; detalle: { simulada?: boolean } | null; registrado_at: string }
export interface TrabajoCron { trabajo: string; horario: string; activo: boolean; ultima_ejecucion: string | null; ultima_estado: string | null }
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

// Colchón de programación y informe diario (los escribe el Vigilante; aquí solo se leen).
export const useColchon = () =>
  useTabla<ColchonLectura>("colchon", () => mk("mk_colchon").select("*").order("fecha", { ascending: false }).order("corrida_at", { ascending: false }).limit(30));

export const useInformeDiario = () =>
  useTabla<InformeDiario>("informe_diario", () => mk("mk_informe_diario").select("*").order("fecha", { ascending: false }).order("created_at", { ascending: false }).limit(1));

// Última corrida del Vigilante del colchón (la fila resumen que deja cada ejecución en la bitácora de agentes).
export const useUltimaCorrida = () =>
  useTabla<CorridaVigilante>("ultima_corrida", () =>
    mk("mk_bitacora").select("id, agente, accion, resultado, detalle, registrado_at").eq("agente", "vigilante").eq("accion", "colchon").order("registrado_at", { ascending: false }).limit(1));

// Vista «Agentes»: todo de solo lectura. La bitácora crece unas 5 filas al día: 500 filas cubren meses.
export const useBitacora = () =>
  useTabla<FilaBitacora>("bitacora", () =>
    mk("mk_bitacora").select("id, agente, accion, resultado, caso_id, detalle, registrado_at").order("registrado_at", { ascending: false }).limit(500));
export const usePropuestas = () => useTabla<{ id: string; estado: string }>("propuestas", () => mk("mk_propuesta").select("id, estado"));
export const useDecisiones = () => useTabla<{ id: string; decision: string }>("decisiones", () => mk("mk_decision").select("id, decision"));

// Estado de los trabajos programados vía mk_agentes_estado(). Si la función aún no está aplicada (o falla), la vista sigue con su
// catálogo fijo y lo dice: nunca se rompe la pestaña por esto.
export const useEstadoTrabajos = () =>
  useQuery({
    queryKey: ["marketing", "trabajos"],
    queryFn: async (): Promise<{ disponible: boolean; trabajos: TrabajoCron[] }> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("mk_agentes_estado");
      if (error) return { disponible: false, trabajos: [] };
      return { disponible: true, trabajos: (data ?? []) as TrabajoCron[] };
    },
    staleTime: 60_000,
  });

// Las lecturas del registro de agentes viven en useAgentesRegistro.ts (compartidas con el módulo Agentes); se reexportan aquí.
export { useAgentesRegistro, useTareasAgentes } from "@/hooks/useAgentesRegistro";

// Tareas de los agentes de Marketing (origen «marketing»): solo números y códigos. El filtro por origen evita traer resultados de otros agentes.
export const useTareasMarketingAgentes = () =>
  useQuery({
    queryKey: ["agentes-registro", "tareas-marketing"],
    queryFn: async (): Promise<import("@/components/marketing/agentesRegistroLogica").TareaMarketing[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("agent_tasks")
        .select("id, agent_id, status, completed_at, result_summary, result").eq("input_context->>origen", "marketing").order("completed_at", { ascending: false }).limit(60);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 60_000,
  });

// ── Analista de resultados (agente con IA, solo lectura) ─────────────────────────────────────────────────────────────
export interface ConsultaAnalista { id: string; pregunta: string; respuesta: string | null; estado: "respondida" | "error" | "rechazada_limite"; verificada: boolean | null; no_verificadas: string[]; created_at: string; seguimiento_id?: string | null }
export interface RespuestaAnalista {
  ok: boolean; respuesta?: string; verificada?: boolean; no_verificadas?: string[]; fuentes?: Array<{ herramienta: string; filas: number | null; corte: string | null }>;
  restantes_hoy?: number; error?: string; limite?: "dia" | "mes";
}

// Historial de preguntas (RLS: solo quien tiene el permiso de ver Marketing, de su organización). Si la tabla aún no existe, no rompe la pantalla.
export const useConsultasAnalista = () =>
  useQuery({
    queryKey: ["analista", "consultas"],
    queryFn: async (): Promise<ConsultaAnalista[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("mk_consulta").select("id, pregunta, respuesta, estado, verificada, no_verificadas, created_at, seguimiento_id").order("created_at", { ascending: false }).limit(10);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
    retry: false,
  });

// Tope de espera: si la función no contesta, la pantalla no se queda en «Pensando…» para siempre.
const ESPERA_MAX_MS = 100_000;
function conTope<T>(trabajo: Promise<T>, vacio: T): Promise<T> {
  return new Promise<T>((resolver) => {
    const reloj = setTimeout(() => resolver(vacio), ESPERA_MAX_MS);
    trabajo.then((v) => { clearTimeout(reloj); resolver(v); }, () => { clearTimeout(reloj); resolver(vacio); });
  });
}
const SIN_RESPUESTA = { ok: false, error: "El Analista tardó demasiado en responder. Inténtalo de nuevo en un momento." };

// Pregunta al Analista por la función marketing-agente. Devuelve siempre un objeto (nunca lanza): los errores llegan con un mensaje para mostrar.
export interface TurnoHistorial { rol: "user" | "assistant"; texto: string }
export function preguntarAlAnalista(pregunta: string, historial?: TurnoHistorial[]): Promise<RespuestaAnalista> {
  return conTope(preguntarSinTope(pregunta, historial), SIN_RESPUESTA);
}
async function preguntarSinTope(pregunta: string, historial?: TurnoHistorial[]): Promise<RespuestaAnalista> {
  try {
    const { data, error } = await supabase.functions.invoke("marketing-agente", { body: historial && historial.length > 0 ? { pregunta, historial } : { pregunta } });
    if (!error) return data as RespuestaAnalista;
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") { try { return (await ctx.json()) as RespuestaAnalista; } catch { /* sin cuerpo */ } }
    return { ok: false, error: "No pudimos hablar con el Analista. Inténtalo de nuevo." };
  } catch {
    return { ok: false, error: "No pudimos hablar con el Analista. Inténtalo de nuevo." };
  }
}


// ── Seguimientos del Analista (preguntas que responde solo, una vez, a diario o cada semana) ──────────────────────────
export type FrecuenciaSeguimiento = "una_vez" | "diaria" | "semanal";
export interface SeguimientoAnalista { id: string; pregunta: string; frecuencia: FrecuenciaSeguimiento; estado: "activo" | "pausado" | "terminado"; proxima_at: string; ultima_at: string | null; corridas: number }

// RLS: solo quien tiene el permiso de ver Marketing, de su organización. Si la tabla aún no existe, no rompe la pantalla.
export const useSeguimientosAnalista = () =>
  useQuery({
    queryKey: ["analista", "seguimientos"],
    queryFn: async (): Promise<SeguimientoAnalista[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).from("mk_seguimiento").select("id, pregunta, frecuencia, estado, proxima_at, ultima_at, corridas").neq("estado", "terminado").order("created_at", { ascending: false }).limit(20);
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 30_000,
    retry: false,
  });

export type AccionSeguimiento =
  | { accion: "crear_seguimiento"; pregunta: string; frecuencia: FrecuenciaSeguimiento }
  | { accion: "cambiar_seguimiento"; id: string; estado: "activo" | "pausado" | "terminado" };

// Crear, pausar, reanudar o terminar un seguimiento por marketing-agente. Devuelve siempre un objeto (nunca lanza).
export function gestionarSeguimiento(cuerpo: AccionSeguimiento): Promise<{ ok: boolean; error?: string }> {
  return conTope(gestionarSinTope(cuerpo), SIN_RESPUESTA);
}
async function gestionarSinTope(cuerpo: AccionSeguimiento): Promise<{ ok: boolean; error?: string }> {
  const generico = { ok: false, error: "No pudimos hablar con el Analista. Inténtalo de nuevo." };
  try {
    const { data, error } = await supabase.functions.invoke("marketing-agente", { body: cuerpo });
    if (!error) return data as { ok: boolean; error?: string };
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") { try { return (await ctx.json()) as { ok: boolean; error?: string }; } catch { /* sin cuerpo */ } }
    return generico;
  } catch { return generico; }
}
