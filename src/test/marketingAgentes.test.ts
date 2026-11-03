import { describe, it, expect } from "vitest";
import { CATALOGO, agenteExiste, cuandoLegible, ejecucionPrevia, estadoAgente, flujo, leerCron, lineaDeTiempo, proximaEjecucion, tarjetas } from "@/components/marketing/agentes";
import type { FilaBitacora, TrabajoCron } from "@/hooks/useMarketing";

const D = (iso: string) => new Date(iso);
const fila = (id: string, agente: string, accion: string, resultado: string, registrado_at: string, caso_id: string | null = null, simulada = false): FilaBitacora =>
  ({ id, agente, accion, resultado, caso_id, detalle: { simulada }, registrado_at });
// Filas reales de la bitácora de producción (3 nov 2026, 7:00 de Ciudad de México = 13:00 UTC)
const FILAS: FilaBitacora[] = [
  fila("a1", "informe_diario", "informe", "informe del 2026-11-03: 4 faltantes, 0 con error, 0 con estado desconocido", "2026-11-03T13:00:04Z"),
  fila("a2", "vigilante", "caso_colchon", "caso #9 actualizado en linkedin: 5 → 4 días", "2026-11-03T13:00:04Z", "c9"),
  fila("a3", "vigilante", "caso_colchon", "caso #8 actualizado en facebook: 5 → 4 días", "2026-11-03T13:00:04Z", "c8"),
  fila("a4", "vigilante", "caso_colchon", "caso #7 actualizado en instagram: 5 → 4 días", "2026-11-03T13:00:04Z", "c7"),
  fila("a5", "vigilante", "colchon", "instagram 4 rojo; facebook 4 rojo; linkedin 4 rojo; 0 casos nuevos, 3 actualizados, 0 cerrados", "2026-11-03T13:00:04Z"),
  fila("a6", "informe_diario", "informe", "informe del 2026-11-02: 4 faltantes, 0 con error, 0 con estado desconocido", "2026-11-03T05:27:15Z"), // 23:27 del 2 nov en CDMX
  fila("a7", "vigilante", "colchon", "instagram 5 rojo; facebook 5 rojo; linkedin 5 rojo; 0 casos nuevos, 3 actualizados, 0 cerrados", "2026-11-03T05:27:15Z"),
];
const CASOS = [{ id: "c7", numero: 7, tipo: "colchon", red: "instagram" as const }, { id: "c8", numero: 8, tipo: "colchon", red: "facebook" as const }, { id: "c9", numero: 9, tipo: "colchon", red: "linkedin" as const }];
const JOBS: TrabajoCron[] = [
  { trabajo: "marketing-colchon-diario-0700-cdmx", horario: "0 13 * * *", activo: true, ultima_ejecucion: "2026-11-03T13:00:00Z", ultima_estado: "succeeded" },
  { trabajo: "marketing-colchon-vigia-0730-cdmx", horario: "30 13 * * *", activo: true, ultima_ejecucion: "2026-11-03T13:30:00Z", ultima_estado: "succeeded" },
];
const AHORA = D("2026-11-03T16:00:00Z"); // 10:00 en Ciudad de México
const def = (id: string) => CATALOGO.find((d) => d.id === id)!;

describe("horarios (cron en UTC → hora de Ciudad de México)", () => {
  it("diario: la próxima de «0 13 * * *» es mañana 13:00 UTC (7:00 CDMX) y la previa es hoy", () => {
    expect(proximaEjecucion("0 13 * * *", AHORA)?.toISOString()).toBe("2026-11-04T13:00:00.000Z");
    expect(ejecucionPrevia("0 13 * * *", AHORA)?.toISOString()).toBe("2026-11-03T13:00:00.000Z");
  });
  it("justo en la hora: la «próxima» es la siguiente, no la actual", () => {
    expect(proximaEjecucion("0 13 * * *", D("2026-11-03T13:00:00Z"))?.toISOString()).toBe("2026-11-04T13:00:00.000Z");
    expect(ejecucionPrevia("0 13 * * *", D("2026-11-03T13:00:00Z"))?.toISOString()).toBe("2026-11-03T13:00:00.000Z");
  });
  it("lunes a viernes y semanal", () => {
    expect(proximaEjecucion("0 23 * * 1-5", D("2026-11-06T23:30:00Z"))?.toISOString()).toBe("2026-11-09T23:00:00.000Z"); // viernes → lunes
    expect(proximaEjecucion("15 14 * * 1", D("2026-11-03T16:00:00Z"))?.toISOString()).toBe("2026-11-09T14:15:00.000Z");
  });
  it("pasos y listas", () => {
    expect(proximaEjecucion("*/15 * * * *", D("2026-11-03T16:07:00Z"))?.toISOString()).toBe("2026-11-03T16:15:00.000Z");
    expect(proximaEjecucion("0 8,20 * * *", D("2026-11-03T16:00:00Z"))?.toISOString()).toBe("2026-11-03T20:00:00.000Z");
  });
  it("una expresión que no se entiende no inventa nada", () => {
    expect(leerCron("cada rato")).toBeNull(); expect(proximaEjecucion("99 99 * * *", AHORA)).toBeNull();
    expect(proximaEjecucion("@daily", AHORA)).toBeNull();
  });
  it("se muestra en hora de Ciudad de México y con hoy/mañana", () => {
    expect(cuandoLegible(D("2026-11-04T13:00:00Z"), AHORA)).toBe("mañana 07:00");
    expect(cuandoLegible(D("2026-11-03T13:00:04Z"), AHORA)).toBe("hoy 07:00");
    expect(cuandoLegible(D("2026-11-03T05:27:15Z"), AHORA)).toBe("ayer 23:27");
  });
});

describe("qué agentes existen", () => {
  it("hoy: Vigilante, Informe diario y Vigía; el Revisor NO aparece", () => {
    const t = tarjetas(FILAS, JOBS, false, AHORA);
    expect(t.map((x) => x.def.id)).toEqual(["vigilante", "informe_diario", "vigia"]);
  });
  it("el Revisor aparece solo cuando tiene filas o hay propuestas", () => {
    expect(agenteExiste(def("revisor"), FILAS, JOBS, false)).toBe(false);
    expect(agenteExiste(def("revisor"), [...FILAS, fila("r1", "revisor", "investigacion", "x", "2026-11-03T14:00:00Z")], JOBS, false)).toBe(true);
    expect(agenteExiste(def("revisor"), FILAS, JOBS, true)).toBe(true);
  });
  it("sin la función de trabajos: el Vigía no aparece (no hay datos suyos) y los demás sí", () => {
    expect(tarjetas(FILAS, [], false, AHORA).map((x) => x.def.id)).toEqual(["vigilante", "informe_diario"]);
  });
});

describe("estado de cada agente", () => {
  it("corrida de hoy a las 7:00: correcta, con su resultado y la próxima mañana 7:00", () => {
    const t = estadoAgente(def("vigilante"), FILAS, JOBS, AHORA);
    expect(t.estado).toBe("correcta"); expect(t.resultado).toContain("instagram 4 rojo"); expect(t.proxima?.toISOString()).toBe("2026-11-04T13:00:00.000Z");
    expect(estadoAgente(def("informe_diario"), FILAS, JOBS, AHORA).resultado).toBe("informe del 2026-11-03: 4 faltantes, 0 con error, 0 con estado desconocido");
  });
  it("lectura fallida: con falla", () => {
    const f = [fila("x", "vigilante", "colchon", "falla de lectura: token rechazado o plan sin acceso", "2026-11-03T13:00:04Z"), ...FILAS.slice(5)];
    expect(estadoAgente(def("vigilante"), f, JOBS, AHORA).estado).toBe("con_falla");
  });
  it("errores al guardar: con falla", () => {
    const f = [fila("x", "vigilante", "colchon", "instagram 4 rojo; 0 casos nuevos, 3 actualizados, 0 cerrados; 2 errores", "2026-11-03T13:00:04Z")];
    expect(estadoAgente(def("vigilante"), f, JOBS, AHORA).estado).toBe("con_falla");
  });
  it("no corrió: la última corrida es de ayer y ya pasó la hora de hoy + 30 min", () => {
    const ayer = FILAS.filter((f) => f.registrado_at < "2026-11-03T12:00:00Z");
    expect(estadoAgente(def("vigilante"), ayer, JOBS, AHORA).estado).toBe("no_corrio");
  });
  it("todavía no es hora de alarmarse: dentro de los 30 min de tolerancia no se marca", () => {
    const ayer = FILAS.filter((f) => f.registrado_at < "2026-11-03T12:00:00Z");
    expect(estadoAgente(def("vigilante"), ayer, JOBS, D("2026-11-03T13:20:00Z")).estado).toBe("correcta");
    expect(estadoAgente(def("vigilante"), ayer, JOBS, D("2026-11-03T13:31:00Z")).estado).toBe("no_corrio");
  });
  it("una corrida de prueba (fecha fija) no cuenta como corrida real", () => {
    const f = [fila("p", "vigilante", "colchon", "instagram 6 rojo", "2026-11-03T13:00:04Z", null, true)];
    const t = estadoAgente(def("vigilante"), f, JOBS, AHORA);
    expect(t.estado).toBe("sin_datos"); expect(t.fueDePrueba).toBe(true);
  });
  it("trabajo pausado: «pausado», aunque haya corrido bien", () => {
    const pausado = JOBS.map((j) => ({ ...j, activo: false }));
    expect(estadoAgente(def("vigilante"), FILAS, pausado, AHORA).estado).toBe("pausado");
  });
  it("trabajo que falló en pg_cron: con falla", () => {
    const roto = JOBS.map((j) => ({ ...j, ultima_estado: "failed" }));
    expect(estadoAgente(def("vigilante"), FILAS, roto, AHORA).estado).toBe("con_falla");
  });
  it("sin la función de trabajos se usa el horario del catálogo y se sigue pudiendo avisar de «no corrió»", () => {
    const ayer = FILAS.filter((f) => f.registrado_at < "2026-11-03T12:00:00Z");
    const t = estadoAgente(def("vigilante"), ayer, [], AHORA);
    expect(t.horario).toBe("0 13 * * *"); expect(t.estado).toBe("no_corrio");
  });
  describe("Vigía (no escribe nada cuando todo está bien)", () => {
    it("trabajo ejecutado hoy y sin aviso: «Sin novedad», correcta, con la hora del trabajo", () => {
      const t = estadoAgente(def("vigia"), FILAS, JOBS, AHORA);
      expect(t.estado).toBe("correcta"); expect(t.resultado).toMatch(/Sin novedad/); expect(t.ultima?.toISOString()).toBe("2026-11-03T13:30:00.000Z"); expect(t.origen).toBe("trabajo");
    });
    it("hay fila SIN CORRIDA de esta vuelta: con falla y con su texto", () => {
      const f = [fila("v", "sistema", "vigia_colchon", "SIN CORRIDA del colchón del 2026-11-03", "2026-11-03T13:30:01Z"), ...FILAS];
      const t = estadoAgente(def("vigia"), f, JOBS, AHORA);
      expect(t.estado).toBe("con_falla"); expect(t.resultado).toBe("SIN CORRIDA del colchón del 2026-11-03");
    });
    it("un aviso de AYER ya no marca la vuelta de hoy como falla", () => {
      const f = [fila("v", "sistema", "vigia_colchon", "SIN CORRIDA del colchón del 2026-11-02", "2026-11-02T13:30:01Z"), ...FILAS];
      expect(estadoAgente(def("vigia"), f, JOBS, AHORA).estado).toBe("correcta");
    });
    it("el trabajo no se ejecutó hoy y ya pasó su hora: no corrió", () => {
      const viejo = JOBS.map((j) => ({ ...j, ultima_ejecucion: "2026-11-02T13:30:00Z" }));
      expect(estadoAgente(def("vigia"), FILAS, viejo, AHORA).estado).toBe("no_corrio");
    });
  });
});

describe("línea de tiempo", () => {
  const T = (f: Partial<Parameters<typeof lineaDeTiempo>[3]> = {}) => lineaDeTiempo(FILAS, CASOS, AHORA, { dias: 7, ...f });
  it("agrupa por día de Ciudad de México (23:27 del 2 nov = 05:27 UTC del 3) y pone lo más reciente arriba", () => {
    const g = T();
    expect(g.map((d) => d.dia)).toEqual(["2026-11-03", "2026-11-02"]); expect(g.map((d) => d.etiqueta)).toEqual(["Hoy", "Ayer"]);
    expect(g[1].eventos.map((e) => e.hora)).toEqual(["23:27", "23:27"]);
  });
  it("cada evento dice qué hizo y a qué caso se refiere", () => {
    const e = T()[0].eventos.find((x) => x.resultado.startsWith("caso #7"))!;
    expect(e.accionEtiqueta).toBe("Caso de colchón"); expect(e.agenteEtiqueta).toBe("Vigilante"); expect(e.caso).toMatchObject({ numero: 7, tipo: "colchon", red: "instagram" });
    expect(T()[0].eventos.find((x) => x.accion === "informe")!.caso).toBeNull();
  });
  it("filtra por agente, por caso y solo fallas", () => {
    expect(T({ agente: "informe_diario" }).flatMap((d) => d.eventos).every((e) => e.agente === "informe_diario")).toBe(true);
    expect(T({ casoNumero: 8 }).flatMap((d) => d.eventos).map((e) => e.caso?.numero)).toEqual([8]);
    expect(T({ soloFallas: true })).toEqual([]);
    const conFalla = lineaDeTiempo([fila("f", "vigilante", "colchon", "falla de lectura: HTTP 502", "2026-11-03T13:00:04Z"), ...FILAS], CASOS, AHORA, { dias: 7, soloFallas: true });
    expect(conFalla.flatMap((d) => d.eventos)).toHaveLength(1);
  });
  it("respeta la ventana de días", () => {
    expect(T({ dias: 1 }).map((d) => d.dia)).toEqual(["2026-11-03"]);
  });
  it("marca las corridas de prueba", () => {
    const g = lineaDeTiempo([fila("p", "vigilante", "colchon", "x", "2026-11-03T13:00:04Z", null, true)], [], AHORA, { dias: 7 });
    expect(g[0].eventos[0].prueba).toBe(true);
  });
  it("acciones desconocidas se muestran legibles, no rotas", () => {
    const g = lineaDeTiempo([fila("n", "revisor", "abrir_propuesta_x", "ok", "2026-11-03T13:00:04Z")], [], AHORA, { dias: 7 });
    expect(g[0].eventos[0].accionEtiqueta).toBe("abrir propuesta x"); expect(g[0].eventos[0].agenteEtiqueta).toBe("Revisor");
  });
});

describe("flujo caso → Revisor → propuesta → decisión", () => {
  it("hoy: 9 casos abiertos, sin Revisor, sin propuestas ni decisiones", () => {
    const casos = [...Array(9)].map(() => ({ estado: "abierto" }));
    const f = flujo(casos, [], [], FILAS);
    expect(f.casos).toMatchObject({ abierto: 9, cerrado: 0, total: 9 }); expect(f.revisor).toBe(false);
    expect(f.propuestas.total).toBe(0); expect(f.decisiones.total).toBe(0);
  });
  it("con propuestas y decisiones, cuenta cada estado y el Revisor aparece", () => {
    const f = flujo([{ estado: "en_investigacion" }, { estado: "en_decision" }, { estado: "cerrado" }], [{ estado: "pendiente" }, { estado: "aprobada" }, { estado: "ajuste_solicitado" }], [{ decision: "aprobada" }, { decision: "ajuste_solicitado" }], FILAS);
    expect(f.casos).toMatchObject({ en_investigacion: 1, en_decision: 1, cerrado: 1 }); expect(f.propuestas).toMatchObject({ pendiente: 1, aprobada: 1, ajuste_solicitado: 1, total: 3 });
    expect(f.decisiones).toMatchObject({ aprobada: 1, ajuste_solicitado: 1, rechazada: 0, total: 2 }); expect(f.revisor).toBe(true);
  });
});
