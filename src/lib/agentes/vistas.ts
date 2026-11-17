// Navegación de la Oficina de agentes: plano → isla → agente. La vista vive en la URL (`?vista=`) para poder compartirla y volver con «atrás».
//   ?vista=plano            (o sin parámetro)   todas las islas
//   ?vista=isla:<clave>                          una isla (clave de departamento)
//   ?vista=agente:<id>                           el escritorio de un agente
// Aquí también se traducen las 12 pestañas viejas de /agentes a la nueva organización (Oficina y Administrar), para que los enlaces viejos sigan sirviendo.
import { DEPARTAMENTOS } from "./departamentos";

export type Vista = { tipo: "plano" } | { tipo: "isla"; clave: string } | { tipo: "agente"; id: string };
export const VISTA_PLANO: Vista = { tipo: "plano" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function leerVista(param: string | null | undefined): Vista {
  if (!param) return VISTA_PLANO;
  const [tipo, valor] = param.split(":");
  if (tipo === "isla" && valor && Object.prototype.hasOwnProperty.call(DEPARTAMENTOS, valor)) return { tipo: "isla", clave: valor };
  if (tipo === "agente" && valor && UUID.test(valor)) return { tipo: "agente", id: valor.toLowerCase() };
  return VISTA_PLANO;   // cualquier valor raro vuelve al plano: nunca una pantalla vacía
}
export const escribirVista = (v: Vista): string | null => (v.tipo === "plano" ? null : v.tipo === "isla" ? `isla:${v.clave}` : `agente:${v.id}`);

export type PestanaEscritorio = "conversaciones" | "perfil" | "aprendizaje" | "rutinas" | "documentos";
export interface DestinoViejo { pestana: "oficina" | "administrar"; escritorio?: PestanaEscritorio }
// Las 12 pestañas de antes → dónde viven ahora. Lo que era de un agente pasa a una pestaña de su escritorio.
export const PESTANAS_VIEJAS: Record<string, DestinoViejo> = {
  oficina: { pestana: "oficina" }, departamentos: { pestana: "oficina" },
  seguimiento: { pestana: "oficina", escritorio: "conversaciones" }, instrucciones: { pestana: "oficina", escritorio: "conversaciones" }, comunicacion: { pestana: "oficina", escritorio: "conversaciones" },
  memoria: { pestana: "oficina", escritorio: "aprendizaje" }, ensenar: { pestana: "oficina", escritorio: "aprendizaje" },
  rutinas: { pestana: "oficina", escritorio: "rutinas" }, programar: { pestana: "oficina", escritorio: "rutinas" },
  documentos: { pestana: "oficina", escritorio: "documentos" },
  tablas: { pestana: "administrar" }, crear: { pestana: "administrar" },
};
export const destinoDePestanaVieja = (p: string | null | undefined): DestinoViejo | undefined => (p && Object.prototype.hasOwnProperty.call(PESTANAS_VIEJAS, p) ? PESTANAS_VIEJAS[p] : undefined);
