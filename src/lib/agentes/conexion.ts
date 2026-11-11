import type { AgenteRegistro } from "@/lib/agentes/registro";

// Pasos para conectar un agente recién creado, leídos de su configuración real (reglas puras, sin red).
export interface PasoConexion { id: "documentos" | "cuentas" | "programar" | "instruir"; titulo: string; detalle: string; hecho: boolean; pestana: string; boton: string }
type Cfg = Record<string, unknown>;
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function pasosDeConexion(a: Pick<AgenteRegistro, "config"> | undefined): PasoConexion[] {
  const c = ((a?.config ?? {}) as Cfg);
  const docs = lista(c.fuentes_docs).length;
  const cuentas = (c.cuentas as { activa?: unknown } | undefined)?.activa === true;
  const cadencia = typeof c.cadencia === "string" ? c.cadencia : "bajo_demanda";
  const programada = (c.programacion as { activa?: unknown } | undefined)?.activa === true;
  const pasos: PasoConexion[] = [
    { id: "documentos", titulo: "Documentos", pestana: "documentos", boton: "Conectar documentos", hecho: docs > 0,
      detalle: docs > 0 ? `${docs} ${docs === 1 ? "fuente conectada" : "fuentes conectadas"} (Dropbox, Google Drive o Microsoft).` : "Sin esto no puede leer expedientes ni carpetas del cliente: elige la carpeta de Dropbox, Drive o Microsoft que podrá leer." },
    { id: "cuentas", titulo: "Correo y calendario", pestana: "documentos", boton: "Activar", hecho: cuentas,
      detalle: cuentas ? "Puede buscar y leer (solo leer) el correo y los eventos de las cuentas vinculadas." : "Que pueda buscar y leer (solo leer) el correo y los eventos de las cuentas vinculadas en Kawiil Central." },
  ];
  if (cadencia !== "bajo_demanda") {
    pasos.push({ id: "programar", titulo: `Programar su revisión ${cadencia === "diaria" ? "diaria" : "semanal"}`, pestana: "programar", boton: "Programar", hecho: programada,
      detalle: programada ? "Tiene una tarea programada activa." : "Quedó sin programar a propósito: actívala para que corra sola a su hora." });
  }
  pasos.push({ id: "instruir", titulo: "Primera instrucción", pestana: "instrucciones", boton: "Darle una instrucción", hecho: false,
    detalle: "Pruébalo con una tarea pequeña y revisa su respuesta en Seguimiento." });
  return pasos;
}
