import { describe, it, expect, beforeAll } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { OficinaAgentes } from "@/components/marketing/OficinaAgentes";
import { estadoVisual, personajeEn, personajes, aspectoDe, VENTANA_RECIENTE_MS } from "@/components/marketing/oficinaAgentesLogica";
import type { AgenteRegistro, TareaMarketing } from "@/components/marketing/agentesRegistroLogica";

// jsdom no implementa el lienzo: se simula su ausencia (el componente lo tolera y deja funcionando la lista y el panel).
beforeAll(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext; });

// Datos como los de producción el 5 nov 2026 (7:00 y 7:30 CDMX = 13:00 y 13:30 UTC).
const ag = (name: string, o: Partial<AgenteRegistro> = {}): AgenteRegistro => ({
  id: name, name, display_name: name, description: `Descripción de ${name}`, role: name, status: "idle", kind: "system", last_heartbeat: null, last_task_at: null,
  tasks_completed: 0, tasks_failed: 0, config: { objetivo: `Objetivo de ${name}`, metas: { colchon_verde_dias: 14, informe_diario_antes_de: "07:30" } }, ...o,
});
const tm = (id: string, agent_id: string, status: string, completed_at: string, result_summary: string | null = null, result: TareaMarketing["result"] = null): TareaMarketing =>
  ({ id, agent_id, status, completed_at, result_summary, result });
const col = (d: number) => ({ colchon: [{ red: "instagram", dias: 23, color: "verde" }, { red: "facebook", dias: d, color: "x" }, { red: "linkedin", dias: 23, color: "verde" }] });
const AGENTES = [
  ag("marketing_vigia", { display_name: "Vigía del colchón", last_heartbeat: "2026-11-05T13:30:00Z" }),
  ag("marketing_vigilante", { display_name: "Vigilante del colchón", last_heartbeat: "2026-11-05T13:00:05Z", tasks_completed: 2 }),
  ag("marketing_informe_diario", { display_name: "Informe diario", last_heartbeat: "2026-11-05T13:00:05Z", tasks_completed: 2 }),
];
const TAREAS = [
  tm("v1", "marketing_vigilante", "completed", "2026-11-05T13:00:05Z", "instagram 23 verde; facebook 23 verde; linkedin 23 verde", col(23)),
  tm("v0", "marketing_vigilante", "completed", "2026-11-04T17:09:00Z", "instagram 21 verde; facebook 21 verde; linkedin 21 verde", col(21)),
  tm("i1", "marketing_informe_diario", "completed", "2026-11-05T13:00:06Z", "0 faltantes, 0 con error, 0 con estado desconocido"),
];
const T = (iso: string) => new Date(iso);
const A10 = T("2026-11-05T17:00:00Z"); // 11:00 CDMX: las corridas fueron hace 4 h

describe("estadoVisual (lógica de la oficina)", () => {
  it("entre corridas y con todo bien: descansando, al día, sin burbuja", () => {
    const e = estadoVisual(AGENTES[1], TAREAS[0], A10);
    expect(e).toMatchObject({ animacion: "descansando", etiqueta: "Al día", color: "verde", burbuja: null });
  });
  it("acaba de correr (≤30 min): el Vigilante escribe y el Informe lee", () => {
    const justo = T("2026-11-05T13:10:00Z");
    expect(estadoVisual(AGENTES[1], TAREAS[0], justo)).toMatchObject({ animacion: "escribiendo", etiqueta: "Acaba de trabajar" });
    expect(estadoVisual(AGENTES[2], TAREAS[2], justo)).toMatchObject({ animacion: "leyendo", etiqueta: "Acaba de trabajar" });
  });
  it("el límite de 'reciente' es exacto: 30 min sí, 31 min no", () => {
    const base = new Date(TAREAS[0].completed_at!).getTime();
    expect(estadoVisual(AGENTES[1], TAREAS[0], new Date(base + VENTANA_RECIENTE_MS)).animacion).toBe("escribiendo");
    expect(estadoVisual(AGENTES[1], TAREAS[0], new Date(base + VENTANA_RECIENTE_MS + 60_000)).animacion).toBe("descansando");
  });
  it("el Vigía (sin tareas) usa su latido: a las 7:30 lee, después descansa", () => {
    expect(estadoVisual(AGENTES[0], undefined, T("2026-11-05T13:40:00Z")).animacion).toBe("leyendo");
    expect(estadoVisual(AGENTES[0], undefined, A10)).toMatchObject({ animacion: "descansando", etiqueta: "Al día" });
  });
  it("sin latido: sin datos (gris) y sin burbuja; no inventa actividad", () => {
    expect(estadoVisual(ag("marketing_vigia"), undefined, A10)).toMatchObject({ animacion: "sin_datos", etiqueta: "Sin datos", color: "gris", burbuja: null });
  });
  it("con error o atrasado: personaje en error con burbuja '!' en rojo", () => {
    expect(estadoVisual(ag("marketing_vigilante", { status: "error", last_heartbeat: "2026-11-05T13:00:00Z" }), undefined, A10)).toMatchObject({ animacion: "error", etiqueta: "Con error", color: "rojo", burbuja: "!" });
    expect(estadoVisual(ag("marketing_vigilante", { last_heartbeat: "2026-11-03T13:00:00Z" }), undefined, A10)).toMatchObject({ animacion: "error", etiqueta: "Atrasado", burbuja: "!" });
  });
  it("meta sin cumplir (colchón bajo): 'Atención' en amarillo con burbuja, sin marcarlo como error", () => {
    const e = estadoVisual(AGENTES[1], tm("v2", "marketing_vigilante", "completed", "2026-11-05T13:00:05Z", "r", col(4)), A10);
    expect(e).toMatchObject({ etiqueta: "Atención", color: "amarillo", burbuja: "!" }); expect(e.animacion).toBe("descansando");
    expect(e.cumple.estado).toBe("no_cumple");
  });
});

describe("personajes", () => {
  it("solo los 3 de Marketing, en orden fijo (Vigilante, Informe, Vigía), sin archivados ni ajenos", () => {
    const otros = [ag("nelli", { kind: "consultable" }), ag("marketing_viejo", { status: "archived" }), ag("otro_sistema")];
    expect(personajes([...AGENTES, ...otros], TAREAS, A10).map((p) => p.aspecto.corto)).toEqual(["Vigilante", "Informe", "Vigía"]);
  });
  it("el historial trae las últimas corridas del agente, la más reciente primero, máximo 5", () => {
    const muchas = Array.from({ length: 8 }, (_, i) => tm(`m${i}`, "marketing_vigilante", "completed", `2026-10-2${i}T13:00:00Z`));
    const p = personajes(AGENTES, muchas, A10).find((x) => x.aspecto.corto === "Vigilante")!;
    expect(p.historial.length).toBe(5); expect(p.historial[0].id).toBe("m7");
  });
  it("hit-test: clic sobre un personaje lo elige; fuera, ninguno", () => {
    const lista = personajes(AGENTES, TAREAS, A10), v = aspectoDe(AGENTES[1]);
    expect(personajeEn(v.x + 6, v.y, lista)?.aspecto.corto).toBe("Vigilante");
    expect(personajeEn(2, 2, lista)).toBeUndefined();
  });
});

describe("OficinaAgentes (pantalla)", () => {
  const vista = (o: Partial<Parameters<typeof OficinaAgentes>[0]> = {}) =>
    render(<OficinaAgentes agentes={AGENTES} tareasMarketing={TAREAS} estadoAgentes="ok" estadoTareas="ok" ahora={A10} {...o} />);
  it("muestra los 3 agentes con su estado y el primero (Vigilante) elegido", () => {
    vista();
    for (const n of ["Vigilante", "Informe", "Vigía"]) expect(screen.getByTestId(`oficina-agente-${n}`).textContent).toContain("Al día");
    expect(screen.getByTestId("oficina-agente-Vigilante").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("oficina-resultado").textContent).toContain("instagram 23 verde");
  });
  it("el panel muestra objetivo, cumplimiento e historial; cambia al elegir otro agente", () => {
    vista();
    const p = within(screen.getByTestId("oficina-panel"));
    expect(p.getByText("Objetivo de marketing_vigilante")).toBeTruthy(); expect(screen.getByTestId("oficina-cumple").textContent).toContain("Cumple");
    expect(within(screen.getByTestId("oficina-historial")).getAllByRole("listitem").length).toBe(2);
    fireEvent.click(screen.getByTestId("oficina-agente-Informe"));
    expect(screen.getByTestId("oficina-agente-Informe").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("oficina-resultado").textContent).toContain("0 faltantes");
  });
  it("el Vigía sin tareas: 'Sin novedad' y sin historial (no inventa corridas)", () => {
    vista(); fireEvent.click(screen.getByTestId("oficina-agente-Vigía"));
    expect(screen.getByTestId("oficina-resultado").textContent).toBe("Sin novedad"); expect(screen.getByTestId("oficina-sin-historial")).toBeTruthy();
  });
  it("avisa que preguntar y dejar tareas llegan después (no promete lo que no existe)", () => {
    vista(); expect(screen.getByTestId("oficina-proximamente").textContent).toContain("siguiente fase");
    expect(screen.queryByText("Dejar tarea")).toBeNull(); expect(screen.queryByRole("textbox")).toBeNull();
  });
  it("el lienzo tiene descripción accesible con el estado de cada agente", () => {
    vista(); expect(screen.getByTestId("oficina-lienzo").getAttribute("aria-label")).toContain("Vigilante del colchón, Al día");
  });
  it("cargando, error y vacío no rompen la pantalla; error solo en el historial deja ver los agentes", () => {
    const { unmount } = vista({ estadoAgentes: "cargando" }); expect(screen.getByText(/Preparando la oficina/)).toBeTruthy(); unmount();
    const r2 = vista({ estadoAgentes: "error" }); expect(screen.getByText(/No pudimos leer los agentes de Marketing/)).toBeTruthy(); r2.unmount();
    const r3 = vista({ agentes: [] }); expect(screen.getByText(/Todavía no hay agentes de Marketing/)).toBeTruthy(); r3.unmount();
    vista({ estadoTareas: "error" }); expect(screen.getByTestId("oficina-agente-Vigilante")).toBeTruthy(); expect(screen.getByText(/No pudimos leer el historial/)).toBeTruthy();
  });
  it("no muestra agentes de Cerebro ni agentes propuestos que aún no existen", () => {
    vista({ agentes: [...AGENTES, ag("nelli", { kind: "consultable" })] });
    expect(screen.queryByTestId("oficina-agente-Agente")).toBeNull(); expect(screen.queryByText(/Analista|Estratega|Creativo|Revisor/)).toBeNull();
  });
});
