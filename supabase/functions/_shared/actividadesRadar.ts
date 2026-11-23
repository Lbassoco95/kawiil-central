/**
 * Radar de actividades (Fase 0 del seguimiento proactivo de Donna).
 * Reglas puras, sin IA y sin APIs de Deno, para poder probarlas con vitest.
 * Tono Zen: pocas cosas, claras, agrupadas por momento (ahora / pronto), sin alarma.
 */

export interface RadarActividad {
  id: string;
  name: string;
  /** YYYY-MM-DD o null. */
  event_date: string | null;
  event_time: string | null;
  venue_confirmed: boolean;
  location: string | null;
}
export interface RadarAsistente {
  confirmed: string; // si | no | pendiente
  rsvp_responded_at: string | null;
  extra_guests_status: string; // none | solicitado | aprobado | rechazado
}
export interface RadarProveedor { category: string; status: string; advance: number | null; }
export interface RadarTarea { due_date: string | null; status: string; }

export type Momento = "ahora" | "pronto";
export interface Hallazgo { clave: string; momento: Momento; texto: string; }

const ABIERTAS = new Set(["pendiente", "en_progreso"]);
/** Proveedores que siguen "vivos": no descartados ni sin disponibilidad. */
const VIVOS = new Set(["cotizacion", "elegido", "apartado", "pagado"]);

/** Días enteros de `hoy` a `fecha` (ambas YYYY-MM-DD). Negativo = ya pasó. */
export function diasHasta(fecha: string, hoy: string): number {
  const a = Date.UTC(+fecha.slice(0, 4), +fecha.slice(5, 7) - 1, +fecha.slice(8, 10));
  const b = Date.UTC(+hoy.slice(0, 4), +hoy.slice(5, 7) - 1, +hoy.slice(8, 10));
  return Math.round((a - b) / 86400000);
}

const n = (k: number, uno: string, varios: string) => `${k} ${k === 1 ? uno : varios}`;

export function evaluarActividad(
  a: RadarActividad, asistentes: RadarAsistente[], proveedores: RadarProveedor[], tareas: RadarTarea[], hoy: string,
): Hallazgo[] {
  const out: Hallazgo[] = [];
  const dias = a.event_date ? diasHasta(a.event_date, hoy) : null;
  if (dias !== null && dias < 0) return out; // el evento ya pasó: no se vigila
  const cerca = dias !== null && dias <= 7;
  const pronto = dias !== null && dias <= 21;

  // 1) Solicitudes de invitados extra: siempre requieren una acción de quien aprueba.
  const porAprobar = asistentes.filter((x) => x.extra_guests_status === "solicitado").length;
  if (porAprobar > 0) {
    out.push({ clave: "plus_uno", momento: "ahora", texto: `${n(porAprobar, "solicitud de invitados extra espera", "solicitudes de invitados extra esperan")} tu aprobación` });
  }

  // 2) Datos del evento.
  if (a.event_date === null) {
    out.push({ clave: "sin_fecha", momento: "pronto", texto: "Falta definir la fecha" });
  } else if (pronto && !a.venue_confirmed) {
    out.push({ clave: "sede", momento: cerca ? "ahora" : "pronto", texto: "La sede no está confirmada" });
  }
  if (a.event_date !== null && pronto && !a.event_time) {
    out.push({ clave: "hora", momento: cerca ? "ahora" : "pronto", texto: "Falta la hora" });
  }

  // 3) Invitados sin responder (solo cuando ya se acerca).
  if (dias !== null && dias <= 14) {
    const sinResponder = asistentes.filter((x) => x.confirmed === "pendiente" && !x.rsvp_responded_at).length;
    if (sinResponder > 0) {
      out.push({ clave: "sin_responder", momento: dias <= 7 ? "ahora" : "pronto",
        texto: `${n(sinResponder, "invitado sin responder", "invitados sin responder")}` });
    }
  }

  // 4) Proveedores: algo elegido o apartado pero sin pago/anticipo cuando falta poco.
  if (dias !== null && dias <= 14) {
    const sinPagar = proveedores.filter((p) => (p.status === "elegido" || p.status === "apartado") && !(p.advance && p.advance > 0)).length;
    if (sinPagar > 0) {
      out.push({ clave: "anticipos", momento: dias <= 7 ? "ahora" : "pronto",
        texto: `${n(sinPagar, "proveedor sin anticipo", "proveedores sin anticipo")}` });
    }
  }
  if (dias !== null && dias <= 21) {
    const rubrosCotizando = new Set(
      proveedores.filter((p) => p.status === "cotizacion").map((p) => p.category),
    );
    const rubrosResueltos = new Set(
      proveedores.filter((p) => VIVOS.has(p.status) && p.status !== "cotizacion").map((p) => p.category),
    );
    const sinElegir = [...rubrosCotizando].filter((r) => !rubrosResueltos.has(r)).length;
    if (sinElegir > 0) {
      out.push({ clave: "sin_elegir", momento: dias <= 7 ? "ahora" : "pronto",
        texto: `${n(sinElegir, "rubro sigue en cotización", "rubros siguen en cotización")}` });
    }
  }

  // 5) Tareas de la actividad vencidas.
  const vencidas = tareas.filter((t) => ABIERTAS.has(t.status) && t.due_date && t.due_date.slice(0, 10) < hoy).length;
  if (vencidas > 0) {
    out.push({ clave: "tareas", momento: "ahora", texto: `${n(vencidas, "tarea vencida", "tareas vencidas")}` });
  }
  return out;
}

export interface RadarActividadResumen { id: string; name: string; dias: number | null; hallazgos: Hallazgo[]; }

/**
 * Mensaje agrupado por momento. null = nada que decir (no se molesta).
 * Calma: lunes se incluye lo "pronto"; el resto de los días solo lo que es "ahora".
 */
export function construirMensajeRadar(
  nombre: string, resumenes: RadarActividadResumen[], esLunes: boolean,
): { title: string; body: string } | null {
  const lineas: string[] = [];
  let hayAhora = false;
  for (const r of resumenes) {
    const ahora = r.hallazgos.filter((h) => h.momento === "ahora");
    const pronto = esLunes ? r.hallazgos.filter((h) => h.momento === "pronto") : [];
    if (ahora.length === 0 && pronto.length === 0) continue;
    if (ahora.length > 0) hayAhora = true;
    const cuando = r.dias === null ? "" : r.dias === 0 ? " (hoy)" : r.dias === 1 ? " (mañana)" : ` (en ${r.dias} días)`;
    const partes = [...ahora, ...pronto].slice(0, 4).map((h) => h.texto);
    lineas.push(`${r.name}${cuando}: ${partes.join("; ")}.`);
  }
  if (lineas.length === 0) return null;
  const saludo = nombre ? `${nombre}, ` : "";
  return {
    title: hayAhora ? "Kawiilito · Actividades por atender" : "Kawiilito · Actividades de la semana",
    body: `${saludo}${hayAhora ? "esto pide tu atención" : "para ir viendo con calma"}. ${lineas.join(" ")}`,
  };
}
