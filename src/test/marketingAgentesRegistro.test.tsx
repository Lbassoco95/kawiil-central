import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { AgentesRegistro } from "@/components/marketing/AgentesRegistro";
import {
  cuandoRelativo, duracionLegible, ordenarAgentes, resumenServicio, senalAgente, tareasRecientes, tasaExito,
  cumplimiento, ultimaTareaDe, type AgenteRegistro, type TareaAgente, type TareaMarketing,
} from "@/components/marketing/agentesRegistro";

const AHORA = new Date("2026-11-03T16:00:00Z");
const ag = (o: Partial<AgenteRegistro> & { id: string; name: string }): AgenteRegistro => ({
  display_name: null, description: null, role: null, status: "idle", kind: "consultable", last_heartbeat: null, last_task_at: null, tasks_completed: 0, tasks_failed: 0, ...o,
});
// Datos como los de producción (3 nov 2026): último latido el 7 de junio, uno "working" desde entonces, uno archivado.
const AGENTES: AgenteRegistro[] = [
  ag({ id: "a1", name: "legal_archivist", last_heartbeat: "2026-06-07T14:02:54Z", last_task_at: "2026-05-29T19:07:52Z", tasks_completed: 1, tasks_failed: 15 }),
  ag({ id: "a2", name: "nelli", description: "Especialista en prevención de lavado de dinero", last_heartbeat: "2026-04-30T15:07:21Z", tasks_completed: 9, tasks_failed: 2 }),
  ag({ id: "a3", name: "legal_dof_watchdog", status: "working", last_heartbeat: "2026-05-29T19:25:38Z", tasks_failed: 2 }),
  ag({ id: "a4", name: "balam" }),
  ag({ id: "a5", name: "researcher", status: "archived" }),
];
const t = (id: string, agent_id: string | null, status: string, created_at: string, started_at: string | null = null, completed_at: string | null = null): TareaAgente =>
  ({ id, agent_id, task_type: "manual", status, created_at, started_at, completed_at });
const TAREAS = [
  t("t1", "a1", "error", "2026-06-07T14:00:00Z"),
  t("t2", "a2", "completed", "2026-04-30T15:00:00Z", "2026-04-30T15:07:00Z", "2026-04-30T15:10:06Z"),
  t("t3", "a1", "error", "2026-11-02T10:00:00Z"),
  t("t4", null, "pending", "2026-11-03T10:00:00Z"),
];

describe("agentesRegistro (lógica)", () => {
  it("señal: latido de hace meses = sin señal; 'working' sin latido reciente = atascado; sin latido; archivado", () => {
    const s = Object.fromEntries(AGENTES.map((a) => [a.name, senalAgente(a, AHORA)]));
    expect(s).toEqual({ legal_archivist: "sin_senal", nelli: "sin_senal", legal_dof_watchdog: "atascado", balam: "sin_latido", researcher: "archivado" });
  });
  it("señal: latido de hace 30 min = en línea; de hace 3 días = inactivo; 'working' con latido reciente no está atascado", () => {
    expect(senalAgente(ag({ id: "x", name: "x", last_heartbeat: "2026-11-03T15:30:00Z" }), AHORA)).toBe("en_linea");
    expect(senalAgente(ag({ id: "x", name: "x", last_heartbeat: "2026-10-31T16:00:00Z" }), AHORA)).toBe("inactivo");
    expect(senalAgente(ag({ id: "x", name: "x", status: "working", last_heartbeat: "2026-11-03T15:45:00Z" }), AHORA)).toBe("en_linea");
  });
  it("resumen del servicio: sin señal desde el 7 de junio, 1 atascado", () => {
    const r = resumenServicio(AGENTES, AHORA);
    expect(r).toMatchObject({ estado: "sin_senal", ultimoLatido: "2026-06-07T14:02:54Z", activos: 4, enLinea: 0, atascados: 1, sinSenal: 3 });
  });
  it("resumen del servicio: con un latido reciente está en línea; sin ningún latido, sin datos", () => {
    expect(resumenServicio([ag({ id: "x", name: "x", last_heartbeat: "2026-11-03T15:50:00Z" })], AHORA).estado).toBe("en_linea");
    expect(resumenServicio([ag({ id: "x", name: "x" })], AHORA).estado).toBe("sin_datos");
    expect(resumenServicio([], AHORA).estado).toBe("sin_datos");
  });
  it("el archivado no cuenta para el resumen ni para el latido", () => {
    expect(resumenServicio([ag({ id: "x", name: "x", status: "archived", last_heartbeat: "2026-11-03T15:59:00Z" })], AHORA).estado).toBe("sin_datos");
  });
  it("tasa de éxito: 1 de 16 = 6 %; sin tareas terminadas = null", () => {
    expect(tasaExito({ tasks_completed: 1, tasks_failed: 15 })).toBe(6);
    expect(tasaExito({ tasks_completed: 0, tasks_failed: 0 })).toBeNull();
    expect(tasaExito({ tasks_completed: null, tasks_failed: null })).toBeNull();
  });
  it("tiempos legibles", () => {
    expect(cuandoRelativo(null, AHORA)).toBe("nunca");
    expect(cuandoRelativo("2026-11-03T15:59:30Z", AHORA)).toBe("ahora");
    expect(cuandoRelativo("2026-11-03T15:30:00Z", AHORA)).toBe("hace 30 min");
    expect(cuandoRelativo("2026-11-03T10:00:00Z", AHORA)).toBe("hace 6 h");
    expect(cuandoRelativo("2026-11-02T10:00:00Z", AHORA)).toBe("hace 1 día");
    expect(cuandoRelativo("2026-06-07T14:00:00Z", AHORA)).toBe("hace 4 meses");
    expect(duracionLegible(186_000)).toBe("3 min");
    expect(duracionLegible(30_000)).toBe("30 s");
  });
  it("orden: atascado primero, archivado al final", () => {
    const o = ordenarAgentes(AGENTES, AHORA).map((a) => a.name);
    expect(o[0]).toBe("legal_dof_watchdog"); expect(o.at(-1)).toBe("researcher");
  });
  it("tareas recientes: 30 días deja solo las de noviembre; null trae todo; filtros por agente y por error; agente desconocido", () => {
    expect(tareasRecientes(TAREAS, AGENTES, AHORA, { dias: 30 }).map((x) => x.id)).toEqual(["t4", "t3"]);
    expect(tareasRecientes(TAREAS, AGENTES, AHORA, { dias: null }).map((x) => x.id)).toEqual(["t4", "t3", "t1", "t2"]);
    expect(tareasRecientes(TAREAS, AGENTES, AHORA, { dias: null, agenteId: "a2" }).map((x) => x.id)).toEqual(["t2"]);
    expect(tareasRecientes(TAREAS, AGENTES, AHORA, { dias: null, soloFallas: true }).map((x) => x.id)).toEqual(["t3", "t1"]);
    const todas = tareasRecientes(TAREAS, AGENTES, AHORA, { dias: null });
    expect(todas.find((x) => x.id === "t4")!.agente).toBe("Agente desconocido");
    expect(todas.find((x) => x.id === "t2")).toMatchObject({ agente: "nelli", etiqueta: "Completada", duracion: "3 min", falla: false });
  });
  it("las tareas no traen título, instrucciones ni mensajes de error (privacidad)", () => {
    const campos = Object.keys(tareasRecientes(TAREAS, AGENTES, AHORA, { dias: null })[0]);
    for (const prohibido of ["title", "titulo", "instructions", "result", "error_message", "description"]) expect(campos).not.toContain(prohibido);
  });
});

const vista = (o: Partial<Parameters<typeof AgentesRegistro>[0]> = {}) =>
  render(<AgentesRegistro agentes={AGENTES} tareas={TAREAS} estadoAgentes="ok" estadoTareas="ok" ahora={AHORA} {...o} />);

describe("vista AgentesRegistro", () => {
  it("avisa que el servicio no da señal y quién lo opera", () => {
    vista();
    const b = screen.getByTestId("registro-servicio").textContent ?? "";
    expect(b).toContain("Servicio sin señal"); expect(b).toContain("kawiil-agents"); expect(b).toContain("hace 4 meses"); expect(b).toContain("1 atascados");
  });
  it("muestra los agentes activos con su estado y oculta el archivado hasta pedirlo", () => {
    vista();
    expect(screen.getByTestId("registro-legal_dof_watchdog").textContent).toContain("Atascado");
    expect(screen.getByTestId("registro-balam").textContent).toContain("Sin latido");
    expect(screen.getByTestId("registro-legal_archivist").textContent).toContain("1 bien · 15 con error (6 %)");
    expect(screen.queryByTestId("registro-researcher")).toBeNull();
    fireEvent.click(screen.getByLabelText("Mostrar archivados"));
    expect(screen.getByTestId("registro-researcher").textContent).toContain("Archivado");
  });
  it("la lista de tareas parte de 30 días y 'Ver todo el historial' la amplía", () => {
    vista();
    const lista = within(screen.getByTestId("registro-tareas-lista"));
    expect(lista.queryByTestId("tarea-t2")).toBeNull();
    expect(lista.getByTestId("tarea-t3").textContent).toContain("Con error");
    fireEvent.click(lista.getByText("Ver todo el historial"));
    expect(lista.getByTestId("tarea-t2").textContent).toContain("3 min");
  });
  it("'Solo con error' deja las tareas con error", () => {
    vista();
    fireEvent.click(screen.getByLabelText("Solo con error"));
    expect(screen.queryByTestId("tarea-t4")).toBeNull(); expect(screen.getByTestId("tarea-t3")).toBeTruthy();
  });
  it("cargando y error no rompen la pantalla", () => {
    const { unmount } = vista({ estadoAgentes: "cargando" });
    expect(screen.getByText(/Leyendo el registro/)).toBeTruthy(); unmount();
    vista({ estadoAgentes: "error" });
    expect(screen.getByText(/No pudimos leer el registro/)).toBeTruthy();
  });
  it("error solo en tareas: los agentes siguen visibles", () => {
    vista({ estadoTareas: "error" });
    expect(screen.getByTestId("registro-nelli")).toBeTruthy();
    expect(screen.getByText(/No pudimos leer las tareas/)).toBeTruthy();
  });
  it("registro vacío", () => {
    vista({ agentes: [], tareas: [] });
    expect(screen.getByText("No hay agentes en el registro.")).toBeTruthy();
    expect(screen.getByTestId("registro-servicio").textContent).toContain("Sin datos del servicio");
  });
});

// ── Agentes de sistema (Marketing): señal por cadencia, servicio y cumplimiento del objetivo ─────────────────────────

const sis = (name: string, o: Partial<AgenteRegistro> = {}): AgenteRegistro =>
  ag({ id: name, name, kind: "system", display_name: name, config: { objetivo: `Objetivo de ${name}`, metas: { colchon_verde_dias: 14, informe_diario_antes_de: "07:30" } }, ...o });
const tm = (id: string, agent_id: string, status: string, completed_at: string, result_summary: string | null = null, result: TareaMarketing["result"] = null): TareaMarketing =>
  ({ id, agent_id, status, completed_at, result_summary, result });

describe("agentes de sistema (Marketing)", () => {
  it("señal por cadencia: corrió hace 9 h = al día; hace 2 días = atrasado; en error = con error; sin latido", () => {
    expect(senalAgente(sis("marketing_vigilante", { last_heartbeat: "2026-11-03T07:00:00Z" }), AHORA)).toBe("al_dia");
    expect(senalAgente(sis("marketing_vigilante", { last_heartbeat: "2026-11-01T07:00:00Z" }), AHORA)).toBe("atrasado");
    expect(senalAgente(sis("marketing_vigilante", { last_heartbeat: "2026-11-03T07:00:00Z", status: "error" }), AHORA)).toBe("con_error");
    expect(senalAgente(sis("marketing_vigilante"), AHORA)).toBe("sin_latido");
  });
  it("los agentes de sistema NO cuentan para el servicio kawiil-agents (su latido viene de Supabase, no de la VM)", () => {
    const r = resumenServicio([...AGENTES, sis("marketing_vigilante", { last_heartbeat: "2026-11-03T15:59:00Z" })], AHORA);
    expect(r.estado).toBe("sin_senal"); expect(r.ultimoLatido).toBe("2026-06-07T14:02:54Z"); expect(r.activos).toBe(4);
  });
  it("Vigilante: cumple con 3 redes en 14+; no cumple con una baja; error; sin datos", () => {
    const a = sis("marketing_vigilante", { last_heartbeat: "2026-11-03T13:00:00Z" });
    const col = (d: number) => ({ colchon: [{ red: "instagram", dias: 22, color: "verde" }, { red: "facebook", dias: d, color: "x" }, { red: "linkedin", dias: 22, color: "verde" }] });
    expect(cumplimiento(a, tm("1", a.id, "completed", "2026-11-03T13:00:05Z", "r", col(22)), AHORA).estado).toBe("cumple");
    const mal = cumplimiento(a, tm("2", a.id, "completed", "2026-11-03T13:00:05Z", "r", col(4)), AHORA);
    expect(mal.estado).toBe("no_cumple"); expect(mal.texto).toContain("facebook (4)");
    expect(cumplimiento(a, tm("3", a.id, "error", "2026-11-03T13:00:05Z", "falla de lectura: HTTP 502"), AHORA)).toMatchObject({ estado: "no_cumple" });
    expect(cumplimiento(a, undefined, AHORA).estado).toBe("sin_datos");
    expect(cumplimiento(a, tm("4", a.id, "completed", "2026-11-03T13:00:05Z", "r", null), AHORA).estado).toBe("sin_datos");
  });
  it("Informe diario: cumple si salió antes de las 7:30 CDMX (13:30 UTC); no cumple si salió después o con error", () => {
    const a = sis("marketing_informe_diario");
    expect(cumplimiento(a, tm("1", a.id, "completed", "2026-11-03T13:00:05Z"), AHORA).estado).toBe("cumple");
    const tarde = cumplimiento(a, tm("2", a.id, "completed", "2026-11-03T14:10:00Z"), AHORA);
    expect(tarde.estado).toBe("no_cumple"); expect(tarde.texto).toContain("08:10");
    expect(cumplimiento(a, tm("3", a.id, "error", "2026-11-03T13:00:05Z"), AHORA).estado).toBe("no_cumple");
  });
  it("Vigía: al día sin tareas = cumple; tarea con error = no encontró la corrida; sin latido = sin datos", () => {
    const a = sis("marketing_vigia", { last_heartbeat: "2026-11-03T13:30:00Z" });
    expect(cumplimiento(a, undefined, AHORA).estado).toBe("cumple");
    expect(cumplimiento(a, tm("1", a.id, "error", "2026-11-03T13:30:00Z", "sin registro de la corrida"), AHORA).estado).toBe("no_cumple");
    expect(cumplimiento(sis("marketing_vigia"), undefined, AHORA).estado).toBe("sin_datos");
  });
  it("ultimaTareaDe toma la más reciente del agente", () => {
    const a = sis("marketing_vigilante");
    expect(ultimaTareaDe(a, [tm("1", a.id, "completed", "2026-11-01T13:00:00Z"), tm("2", a.id, "completed", "2026-11-03T13:00:00Z"), tm("3", "otro", "completed", "2026-11-04T13:00:00Z")])!.id).toBe("2");
  });
  it("la tarjeta de un agente de sistema muestra objetivo y 'Cumple'; la de un consultable no muestra objetivo", () => {
    const v = sis("marketing_vigilante", { last_heartbeat: "2026-11-03T13:00:00Z", display_name: "Vigilante del colchón" });
    render(<AgentesRegistro agentes={[v, ...AGENTES]} tareas={[]} estadoAgentes="ok" estadoTareas="ok" ahora={AHORA}
      tareasMarketing={[tm("1", v.id, "completed", "2026-11-03T13:00:05Z", "r", { colchon: [{ red: "instagram", dias: 22, color: "verde" }] })]} />);
    const o = screen.getByTestId("objetivo-marketing_vigilante").textContent ?? "";
    expect(o).toContain("Objetivo de marketing_vigilante"); expect(o).toContain("Cumple");
    expect(screen.getByTestId("registro-marketing_vigilante").textContent).toContain("Al día");
    expect(screen.queryByTestId("objetivo-nelli")).toBeNull();
  });
  it("sin tareas registradas: dice que todavía no hay corridas (no inventa 'cumple')", () => {
    const v = sis("marketing_vigilante");
    render(<AgentesRegistro agentes={[v]} tareas={[]} estadoAgentes="ok" estadoTareas="ok" ahora={AHORA} />);
    expect(screen.getByTestId("objetivo-marketing_vigilante").textContent).toContain("Todavía no hay corridas registradas");
    expect(screen.getByTestId("objetivo-marketing_vigilante").textContent).not.toContain("Cumple");
  });
});
