import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
vi.mock("@/components/agentes/PanelAgente", () => ({ PanelAgente: ({ figura, pestana }: { figura: { nombre: string }; pestana: string }) => <div data-testid="stub-panel">{figura.nombre}:{pestana}</div> }));
import { VistaOficina } from "@/components/agentes/VistaOficina";
import { figurasOficina } from "@/lib/agentes/oficina";
import type { AgenteRegistro, TareaAgente } from "@/lib/agentes/registro";
import { destinoDePestanaVieja, escribirVista, leerPestanaEscritorio, leerVista, PESTANAS_VIEJAS, VISTA_PLANO } from "@/lib/agentes/vistas";

const AHORA = new Date("2026-11-15T12:00:00Z");
const ID = "123e4567-e89b-12d3-a456-426614174000";
const ag = (id: string, name: string, o: Partial<AgenteRegistro> = {}): AgenteRegistro => ({ id, name, display_name: name, description: null, role: null, status: "idle", kind: "consultable", last_heartbeat: new Date(AHORA.getTime() - 60_000).toISOString(), last_task_at: null, tasks_completed: 0, tasks_failed: 0, ...o } as AgenteRegistro);
const ta = (id: string, agent_id: string, status: string): TareaAgente => ({ id, agent_id, task_type: "consulta", status, created_at: new Date(AHORA.getTime() - 120_000).toISOString(), started_at: new Date(AHORA.getTime() - 100_000).toISOString(), completed_at: null } as TareaAgente);
const AGENTES = [ag("a1", "amatl"), ag("a2", "atl"), ag("a3", "tepantli")];
const TAREAS = [ta("t1", "a1", "in_progress")];

describe("vista de la oficina en la URL", () => {
  it("lee y escribe la vista; los valores raros vuelven al plano", () => {
    expect(leerVista(null)).toEqual(VISTA_PLANO);
    expect(leerVista("isla:fiscal")).toEqual({ tipo: "isla", clave: "fiscal" });
    expect(leerVista("isla:inventada")).toEqual(VISTA_PLANO);
    expect(leerVista(`agente:${ID}`)).toEqual({ tipo: "agente", id: ID });
    expect(leerVista("agente:no-es-uuid")).toEqual(VISTA_PLANO);
    expect(leerVista("<script>")).toEqual(VISTA_PLANO);
    expect(escribirVista(VISTA_PLANO)).toBeNull();
    expect(escribirVista({ tipo: "isla", clave: "fiscal" })).toBe("isla:fiscal");
    expect(leerVista(escribirVista({ tipo: "agente", id: ID }))).toEqual({ tipo: "agente", id: ID });
  });
  it("la pestaña del escritorio viene de ?tab= y lo desconocido abre Conversaciones", () => {
    expect(leerPestanaEscritorio("perfil")).toBe("perfil");
    expect(leerPestanaEscritorio("zzz")).toBe("conversaciones");
    expect(leerPestanaEscritorio(null)).toBe("conversaciones");
  });
  it("las 12 pestañas viejas tienen destino: Oficina (con pestaña del escritorio) o Administrar", () => {
    expect(Object.keys(PESTANAS_VIEJAS)).toHaveLength(13);   // las 12 de antes + «Lista LPB», que se sumó después y vive en Administrar
    expect(destinoDePestanaVieja("lpb")).toEqual({ pestana: "administrar" });
    expect(destinoDePestanaVieja("crear")).toEqual({ pestana: "administrar" });
    expect(destinoDePestanaVieja("tablas")).toEqual({ pestana: "administrar" });
    expect(destinoDePestanaVieja("memoria")).toEqual({ pestana: "oficina", escritorio: "aprendizaje" });
    expect(destinoDePestanaVieja("programar")?.escritorio).toBe("rutinas");
    expect(destinoDePestanaVieja("toString")).toBeUndefined();
    expect(destinoDePestanaVieja(null)).toBeUndefined();
  });
});

describe("VistaOficina", () => {
  const figs = figurasOficina(AGENTES, TAREAS, AHORA);
  const montar = (vista: Parameters<typeof VistaOficina>[0]["vista"], onVista = vi.fn(), onElegirAgente = vi.fn()) =>
    render(<VistaOficina figuras={figs} agentes={AGENTES} tareas={TAREAS} ahora={AHORA} vista={vista} onVista={onVista} onElegirAgente={onElegirAgente} />);
  it("el plano trae la franja «Equipo en vivo» con quien trabaja y cada isla se puede abrir", () => {
    const onVista = vi.fn();
    montar(VISTA_PLANO, onVista);
    expect(screen.getByTestId("franja-resumen").textContent).toContain("1 trabajando ahora");
    expect(screen.getByTestId("franja-a1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("isla-abrir-juridico"));
    expect(onVista).toHaveBeenCalledWith({ tipo: "isla", clave: "juridico" });
    fireEvent.keyDown(screen.getByTestId("isla-abrir-fiscal"), { key: "Enter" });
    expect(onVista).toHaveBeenCalledWith({ tipo: "isla", clave: "fiscal" });
  });
  it("la isla abierta lista a sus agentes, deja volver al plano y elegir un agente", () => {
    const onVista = vi.fn(), onElegirAgente = vi.fn();
    montar({ tipo: "isla", clave: "juridico" }, onVista, onElegirAgente);
    expect(screen.getByTestId("isla-titulo").textContent).toBe("Jurídico");
    expect(screen.getByTestId("sala-juridico")).toBeTruthy();
    expect(screen.queryByTestId("sala-agente-a2")).toBeNull();   // atl es de Fiscal
    fireEvent.click(screen.getByTestId("sala-agente-a3"));
    expect(onElegirAgente).toHaveBeenCalledWith("a3");
    fireEvent.click(screen.getByTestId("volver-plano"));
    expect(onVista).toHaveBeenCalledWith(VISTA_PLANO);
  });
  it("una isla sin agentes dice que está vacía en vez de dejar la pantalla en blanco", () => {
    montar({ tipo: "isla", clave: "gestoria" });
    expect(screen.getByTestId("isla-vacia")).toBeTruthy();
  });
  it("sin nadie trabajando la franja lo dice", () => {
    render(<VistaOficina figuras={figurasOficina(AGENTES, [], AHORA)} agentes={AGENTES} tareas={[]} ahora={AHORA} vista={VISTA_PLANO} onVista={vi.fn()} onElegirAgente={vi.fn()} />);
    expect(screen.getByTestId("franja-resumen").textContent).toContain("nadie trabaja ahora");
  });
  it("la vista de agente muestra la sala de su isla y su escritorio, y deja volver a la isla", () => {
    const onVista = vi.fn();
    render(<VistaOficina figuras={figs} agentes={AGENTES} tareas={TAREAS} ahora={AHORA} vista={{ tipo: "agente", id: "a3" }} onVista={onVista} onElegirAgente={vi.fn()} pestana="perfil" />);
    expect(screen.getByTestId("sala-juridico")).toBeTruthy();
    expect(screen.getByTestId("stub-panel").textContent).toBe("tepantli:perfil");
    expect(screen.getByTestId("agente-titulo").textContent).toBe("tepantli");
    fireEvent.click(screen.getByTestId("volver-isla"));
    expect(onVista).toHaveBeenCalledWith({ tipo: "isla", clave: "juridico" });
  });
  it("un agente que no existe avisa en vez de quedar en blanco", () => {
    render(<VistaOficina figuras={figs} agentes={AGENTES} tareas={TAREAS} ahora={AHORA} vista={{ tipo: "agente", id: "no-existe" }} onVista={vi.fn()} onElegirAgente={vi.fn()} />);
    expect(screen.getByTestId("agente-no-existe")).toBeTruthy();
  });
  it("la franja cuenta lo que te espera (total de pendientes de todos los agentes) y pone la tarea en curso en la actividad", () => {
    const t = [...TAREAS, { ...ta("t9", "a2", "waiting_approval") }, { ...ta("t10", "a2", "waiting_approval") }];
    render(<VistaOficina figuras={figurasOficina(AGENTES, t, AHORA)} agentes={AGENTES} tareas={t} ahora={AHORA} vista={VISTA_PLANO} onVista={vi.fn()} onElegirAgente={vi.fn()} />);
    expect(screen.getByTestId("franja-esperan").textContent).toContain("2 pendientes de ti");   // se cuenta por tarea, no por agente
    expect(screen.getByTestId("franja-a1").textContent).toContain("Trabajando · consulta");
    expect(screen.getByTestId("franja-a2").textContent).toContain("te espera");
  });
  it("el plano cuenta los agentes y las islas y lista aparte a los archivados (sin sala)", () => {
    const todos = [...AGENTES, ag("z1", "viejo_uno", { status: "archived" }), ag("z2", "viejo_dos", { status: "archived" })];
    render(<VistaOficina figuras={figurasOficina(todos, TAREAS, AHORA)} agentes={todos} tareas={TAREAS} ahora={AHORA} vista={VISTA_PLANO} onVista={vi.fn()} onElegirAgente={vi.fn()} />);
    expect(screen.getByTestId("resumen-agentes").textContent).toContain("3 agentes en 2 islas · 2 archivados");
    expect(screen.getByTestId("archivados").textContent).toContain("Agentes archivados (2)");
    expect(screen.getByTestId("archivado-z1").textContent).toContain("viejo_uno");
    expect(screen.queryByTestId("sala-agente-z1")).toBeNull();
  });
  it("sin archivados lo dice y la sala de una isla no muestra la lista", () => {
    render(<VistaOficina figuras={figs} agentes={AGENTES} tareas={TAREAS} ahora={AHORA} vista={{ tipo: "isla", clave: "juridico" }} onVista={vi.fn()} onElegirAgente={vi.fn()} />);
    expect(screen.queryByTestId("archivados")).toBeNull();
  });
});
