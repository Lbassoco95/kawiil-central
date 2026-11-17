import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { PlanoDepartamentos } from "@/components/agentes/PlanoDepartamentos";
import { figurasOficina } from "@/lib/agentes/oficina";
import type { AgenteRegistro, TareaAgente } from "@/lib/agentes/registro";
import {
  agruparPorDepartamento, celdasDe, contarTareas, ANCHO_ISLA_MAX, escenaPara, departamentoDe, filasDeTareas, grupoDeEstado, isoPunto, MAX_ISLAS, posicionesIslas, resumenDepartamento,
} from "@/lib/agentes/departamentos";

const AHORA = new Date("2026-11-15T12:00:00Z");
const ag = (id: string, name: string, o: Partial<AgenteRegistro> = {}): AgenteRegistro => ({ id, name, display_name: name, description: `Descripción de ${name}`, role: null, status: "idle", kind: "consultable", last_heartbeat: AHORA.toISOString(), last_task_at: null, tasks_completed: 0, tasks_failed: 0, ...o });
const ta = (id: string, agent_id: string | null, status: string, o: Partial<TareaAgente> = {}): TareaAgente => ({ id, agent_id, task_type: "consulta", status, created_at: "2026-11-14T10:00:00Z", started_at: null, completed_at: null, ...o });
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000).toISOString();

const AGENTES = [ag("a1", "amatl"), ag("a2", "atl"), ag("a3", "nelli"), ag("a4", "legal_sat"), ag("a5", "yollotl"), ag("a6", "tepantli")];
const TAREAS = [
  ta("t1", "a1", "in_progress"), ta("t2", "a1", "pending"), ta("t3", "a2", "queued"), ta("t4", "a2", "waiting_approval"),
  ta("t5", "a3", "completed", { completed_at: hace(2) }), ta("t6", "a3", "completed", { completed_at: hace(45) }),
  ta("t7", "a5", "failed", { completed_at: hace(1) }), ta("t8", null, "pending"), ta("t9", "a4", "cancelled"),
];

describe("departamentos (lógica)", () => {
  it("asigna por configuración, prefijo legal_, nombre conocido, palabras clave y, si no, Otros", () => {
    expect(departamentoDe(ag("x", "cualquiera", { config: { departamento: "fiscal" } })).clave).toBe("fiscal");
    expect(departamentoDe(ag("x", "cualquiera", { config: { departamento: "inventado" } })).clave).toBe("otros");
    expect(departamentoDe(ag("x", "legal_dof")).clave).toBe("acervo");
    expect(departamentoDe(ag("x", "marketing_cmo", { kind: "system" })).clave).toBe("marketing");
    expect(departamentoDe(ag("x", "amatl")).clave).toBe("juridico");
    expect(departamentoDe(ag("x", "nuevo", { description: "Revisa nómina y SAT" })).clave).toBe("fiscal");
    expect(departamentoDe(ag("x", "nuevo", { description: "Prevención de lavado" })).clave).toBe("cumplimiento");
    expect(departamentoDe(ag("x", "toString", { description: null })).clave).toBe("otros");
  });
  it("agrupa con la isla más poblada primero y «Otros» al final, quien trabaja primero en su isla", () => {
    const figs = figurasOficina(AGENTES, TAREAS, AHORA);
    const g = agruparPorDepartamento(figs, AGENTES);
    expect(g.map((x) => x.depto.clave)).toEqual(["juridico", "acervo", "cumplimiento", "fiscal", "gestoria"].sort((a, b) => g.findIndex((x) => x.depto.clave === a) - g.findIndex((x) => x.depto.clave === b)));
    expect(g[0].depto.clave).toBe("juridico");
    expect(g[0].figuras).toHaveLength(2);
    expect(g[0].figuras[0].id).toBe("a1");
    expect(g.reduce((n, x) => n + x.figuras.length, 0)).toBe(AGENTES.length);
  });
  it("con más de 6 departamentos junta los sobrantes en Otros sin perder agentes", () => {
    const claves = ["juridico", "acervo", "fiscal", "cumplimiento", "gestoria", "otros"];
    const lista = claves.map((c, i) => ag("d" + i, "n" + i, { config: { departamento: c } }));
    const figs = figurasOficina(lista, [], AHORA);
    expect(agruparPorDepartamento(figs, lista).length).toBeLessThanOrEqual(MAX_ISLAS);
  });
  it("cuenta haciendo, en cola, hechas (30 días) y con error por departamento, ignorando tareas sin agente", () => {
    expect(resumenDepartamento(["a1"], TAREAS, AHORA)).toEqual({ agentes: 1, haciendo: 1, enCola: 1, hechas: 0, conError: 0 });
    expect(resumenDepartamento(["a2"], TAREAS, AHORA).enCola).toBe(2);
    expect(resumenDepartamento(["a3"], TAREAS, AHORA).hechas).toBe(1);
    expect(resumenDepartamento(["a5"], TAREAS, AHORA).conError).toBe(1);
    expect(resumenDepartamento(["a4"], TAREAS, AHORA)).toEqual({ agentes: 1, haciendo: 0, enCola: 0, hechas: 0, conError: 0 });
  });
  it("clasifica estados y cuenta para los filtros", () => {
    expect(grupoDeEstado("in_progress")).toBe("en_curso");
    expect(grupoDeEstado("cancelled")).toBeNull();
    const c = contarTareas(TAREAS);
    expect(c).toMatchObject({ en_curso: 1, en_cola: 4, terminadas: 2, con_error: 1, todas: 8 });
  });
  it("las filas ponen primero lo en curso, nombran al agente y no llevan textos de tareas", () => {
    const filas = filasDeTareas(TAREAS, AGENTES, "todas");
    expect(filas[0]).toMatchObject({ id: "t1", agente: "amatl", grupo: "en_curso" });
    expect(filas.find((f) => f.id === "t8")?.agente).toBe("Agente desconocido");
    expect(Object.keys(filas[0]).sort()).toEqual(["agente", "agenteId", "creada", "fin", "grupo", "id", "tipo"]);
    expect(filasDeTareas(TAREAS, AGENTES, "con_error").map((f) => f.id)).toEqual(["t7"]);
    expect(filasDeTareas(TAREAS, AGENTES, "todas", 2)).toHaveLength(2);
  });
  it("la geometría reparte celdas e islas dentro de la escena", () => {
    expect(celdasDe(1)).toEqual({ cols: 1, filas: 1 });
    expect(celdasDe(5)).toEqual({ cols: 3, filas: 2 });
    expect(celdasDe(30).cols).toBe(4);
    expect(isoPunto(0.5, 0.5, 1, 1)).toEqual({ x: 0, y: 0 });
    const p = posicionesIslas(5);
    expect(p).toHaveLength(5);
    expect(p.filter((x) => x.fila === "arriba")).toHaveLength(3);
    expect(p.every((x) => x.x >= 0 && x.x <= escenaPara(5).ancho)).toBe(true);
    expect(posicionesIslas(1)[0].y).toBe(escenaPara(1).hub.y);
  });
  it("ninguna isla ni tarjeta queda recortada, con 1 a 8 departamentos (con 4 islas en una fila la escena se ensancha)", () => {
    for (let n = 1; n <= 8; n++) {
      const e = escenaPara(n), pos = posicionesIslas(n);
      expect(e.hub.x).toBe(e.ancho / 2);
      for (const q of pos) { expect(q.x - ANCHO_ISLA_MAX / 2).toBeGreaterThanOrEqual(0); expect(q.x + ANCHO_ISLA_MAX / 2).toBeLessThanOrEqual(e.ancho); expect(q.x - 104).toBeGreaterThanOrEqual(0); expect(q.x + 104).toBeLessThanOrEqual(e.ancho); }
    }
    expect(escenaPara(6).ancho).toBe(1200); expect(escenaPara(7).ancho).toBeGreaterThan(1200);
  });
});

describe("<PlanoDepartamentos />", () => {
  const figs = figurasOficina(AGENTES, TAREAS, AHORA);
  const montar = (onElegir?: (id: string) => void, tareas = TAREAS) => render(<PlanoDepartamentos figuras={figs} agentes={AGENTES} tareas={tareas} ahora={AHORA} onElegir={onElegir} />);

  it("dibuja una isla y una tarjeta por departamento con sus cifras dichas en texto", () => {
    montar();
    expect(screen.getByTestId("isla-juridico")).toBeTruthy();
    const t = screen.getByTestId("tarjeta-juridico");
    expect(t.getAttribute("aria-label")).toBe("Jurídico: 2 agentes, 1 haciendo, 1 en cola, 0 hechas en 30 días, trabajando ahora");
    expect(screen.getByTestId("tarjeta-gestoria").getAttribute("aria-label")).toMatch(/1 con error/);
  });
  it("cada agente es un botón con su estado y departamento, y al elegirlo avisa (clic y teclado)", () => {
    const onElegir = vi.fn();
    montar(onElegir);
    const a = screen.getByTestId("plano-a1");
    expect(a.getAttribute("role")).toBe("button");
    expect(a.getAttribute("aria-label")).toMatch(/^amatl: .+\. Departamento Jurídico$/);
    fireEvent.click(a);
    fireEvent.keyDown(screen.getByTestId("plano-a2"), { key: "Enter" });
    expect(onElegir.mock.calls.map((c) => c[0])).toEqual(["a1", "a2"]);
  });
  it("el panel de tareas filtra por estado y muestra el conteo en cada filtro", () => {
    montar();
    expect(screen.getByTestId("plano-filtro-todas").textContent).toMatch(/7/);
    expect(within(screen.getByTestId("plano-lista")).getAllByRole("button")).toHaveLength(7);
    fireEvent.click(screen.getByTestId("plano-filtro-con_error"));
    expect(screen.getByTestId("plano-filtro-con_error").getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByTestId("plano-lista")).getAllByRole("button")).toHaveLength(1);
    expect(screen.getByTestId("plano-tarea-t7").textContent).toMatch(/yollotl.*Con error/);
  });
  it("una fila de tarea lleva a su agente y no muestra ningún texto de la tarea", () => {
    const onElegir = vi.fn();
    montar(onElegir, [{ ...ta("t1", "a1", "in_progress"), ...({ title: "SECRETO", instructions: "SECRETO" } as object) }]);
    expect(screen.queryByText(/SECRETO/)).toBeNull();
    fireEvent.click(screen.getByTestId("plano-tarea-t1"));
    expect(onElegir).toHaveBeenCalledWith("a1");
  });
  it("sin tareas dice que aún no hay; sin agentes, que no hay agentes", () => {
    montar(undefined, []);
    expect(screen.getByTestId("plano-sin-tareas").textContent).toMatch(/Aún no hay tareas/);
    fireEvent.click(screen.getByTestId("plano-filtro-en_cola"));
    expect(screen.getByTestId("plano-sin-tareas").textContent).toMatch(/Aún no hay tareas/);
  });
  it("con filtro sin coincidencias lo dice distinto", () => {
    montar(undefined, [ta("t1", "a1", "in_progress")]);
    fireEvent.click(screen.getByTestId("plano-filtro-terminadas"));
    expect(screen.getByTestId("plano-sin-tareas").textContent).toMatch(/No hay tareas con este filtro/);
  });
  it("sin agentes muestra un aviso", () => {
    render(<PlanoDepartamentos figuras={[]} agentes={[]} tareas={[]} ahora={AHORA} />);
    expect(screen.getByText(/No hay agentes en el registro/)).toBeTruthy();
  });
});

describe("isla de Marketing", () => {
  const MK = [ag("k1", "marketing_cmo", { kind: "system" }), ag("k2", "marketing_vigilante", { kind: "system" })];
  const TODOS = [...AGENTES, ...MK];
  const TAREAS_MK = [...TAREAS, ta("k-t1", "k1", "completed", { completed_at: hace(1) }), ta("k-t2", "k2", "pending")];
  const figsTodos = figurasOficina(TODOS, TAREAS_MK, AHORA);
  const montar = (o: { onElegir?: (id: string) => void; alAbrirMarketing?: () => void } = {}) => render(<PlanoDepartamentos figuras={figsTodos} agentes={TODOS} tareas={TAREAS_MK} ahora={AHORA} {...o} />);

  it("Marketing es su propio departamento y caben hasta 8 islas sin juntar ninguna en Otros", () => {
    const g = agruparPorDepartamento(figsTodos, TODOS);
    expect(g.map((x) => x.depto.clave)).toContain("marketing");
    expect(g.find((x) => x.depto.clave === "marketing")!.figuras).toHaveLength(2);
    expect(MAX_ISLAS).toBe(8);
    expect(g.length).toBe(6);
  });
  it("dibuja la isla y su tarjeta con cifras propias", () => {
    montar();
    expect(screen.getByTestId("isla-marketing")).toBeTruthy();
    expect(screen.getByTestId("tarjeta-marketing").getAttribute("aria-label")).toBe("Marketing: 2 agentes, 0 haciendo, 1 en cola, 1 hechas en 30 días");
  });
  it("elegir un agente o una tarea de Marketing abre su módulo, no la Oficina; los demás siguen igual", () => {
    const onElegir = vi.fn(), alAbrirMarketing = vi.fn();
    montar({ onElegir, alAbrirMarketing });
    expect(screen.getByTestId("plano-k1").getAttribute("aria-label")).toMatch(/Departamento Marketing \(abre el módulo de Marketing\)$/);
    fireEvent.click(screen.getByTestId("plano-k1"));
    fireEvent.click(screen.getByTestId("plano-tarea-k-t2"));
    expect(alAbrirMarketing).toHaveBeenCalledTimes(2); expect(onElegir).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("plano-a1"));
    expect(onElegir).toHaveBeenCalledWith("a1"); expect(alAbrirMarketing).toHaveBeenCalledTimes(2);
  });
  it("la nota aclara que el módulo sigue aparte y ofrece abrirlo; sin Marketing no hay nota", () => {
    const alAbrirMarketing = vi.fn();
    const { unmount } = montar({ alAbrirMarketing });
    expect(screen.getByTestId("plano-nota-marketing").textContent).toMatch(/su módulo sigue aparte/);
    fireEvent.click(screen.getByTestId("plano-abrir-marketing")); expect(alAbrirMarketing).toHaveBeenCalled();
    unmount();
    render(<PlanoDepartamentos figuras={figurasOficina(AGENTES, TAREAS, AHORA)} agentes={AGENTES} tareas={TAREAS} ahora={AHORA} />);
    expect(screen.queryByTestId("plano-nota-marketing")).toBeNull();
  });
});

describe("islas en vivo", () => {
  const A = [ag("a1", "amatl"), ag("a2", "atl"), ag("a3", "nelli")];
  const montar = (tareas: TareaAgente[]) => render(<PlanoDepartamentos figuras={figurasOficina(A, tareas, AHORA)} agentes={A} tareas={tareas} ahora={AHORA} />);
  it("la isla donde alguien trabaja se ilumina y su tarjeta lo dice; las demás no", () => {
    montar([ta("t1", "a1", "in_progress")]);
    expect(screen.getByTestId("isla-juridico").getAttribute("data-activa")).toBe("true");
    expect(screen.getByTestId("isla-viva-juridico")).toBeTruthy();
    expect(screen.getByTestId("tarjeta-viva-juridico").textContent).toBe("TRABAJANDO");
    expect(screen.queryByTestId("tarjeta-viva-fiscal")).toBeNull();
    expect(screen.getByTestId("tarjeta-juridico").getAttribute("aria-label")).toMatch(/trabajando ahora$/);
    expect(screen.getByTestId("isla-fiscal").getAttribute("data-activa")).toBe("false");
    expect(screen.queryByTestId("isla-viva-fiscal")).toBeNull();
    expect(screen.getByTestId("tarjeta-fiscal").getAttribute("aria-label")).not.toMatch(/trabajando ahora/);
  });
  it("cuando la tarea termina, la isla deja de iluminarse al llegar los datos nuevos", () => {
    const { rerender } = montar([ta("t1", "a1", "in_progress")]);
    expect(screen.getByTestId("isla-juridico").getAttribute("data-activa")).toBe("true");
    const fin = [ta("t1", "a1", "completed", { completed_at: AHORA.toISOString() })];
    rerender(<PlanoDepartamentos figuras={figurasOficina(A, fin, AHORA)} agentes={A} tareas={fin} ahora={AHORA} />);
    expect(screen.getByTestId("isla-juridico").getAttribute("data-activa")).toBe("false");
    expect(screen.getByTestId("plano-a1").getAttribute("data-estado")).toBe("celebrando");
  });
});

describe("isla iluminada por tareas en curso", () => {
  const A = [ag("m1", "marketing_vigilante", { kind: "system" }), ag("a1", "amatl")];
  const recientes = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
  const montar = (tareas: TareaAgente[]) => render(<PlanoDepartamentos figuras={figurasOficina(A, tareas, AHORA)} agentes={A} tareas={tareas} ahora={AHORA} />);
  it("una tarea en curso reciente ilumina la isla aunque el agente no esté «trabajando» (agentes de Marketing, por ejemplo)", () => {
    montar([ta("t1", "m1", "in_progress", { task_type: "scheduled", created_at: recientes(2), started_at: recientes(2), completed_at: null })]);
    expect(screen.getByTestId("isla-marketing").getAttribute("data-activa")).toBe("true");
    expect(screen.getByTestId("tarjeta-viva-marketing").textContent).toBe("TRABAJANDO");
  });
  it("una «en curso» de hace días no ilumina nada (sería un fantasma)", () => {
    montar([ta("t1", "m1", "in_progress", { created_at: recientes(3 * 24 * 60), started_at: recientes(3 * 24 * 60), completed_at: null })]);
    expect(screen.getByTestId("isla-marketing").getAttribute("data-activa")).toBe("false");
    expect(screen.queryByTestId("tarjeta-viva-marketing")).toBeNull();
  });
});

