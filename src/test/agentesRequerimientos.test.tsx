import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const A1 = "11111111-1111-4111-8111-111111111111", A2 = "22222222-2222-4222-8222-222222222222";
const T1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", T2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", T3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const hoy = "2026-11-25T12:00:00Z";
const resumen = (id: string, agent_id: string, agente: string, estado: string, o: Record<string, unknown> = {}) => ({ id, agent_id, agente, titulo: `Solicitud ${id.slice(0, 2)}`, estado, tipo: "x", prioridad: "normal", creada: hoy, inicio: null, fin: null, resumen: "", con_error: false, entregables: 0, hilo: null, ...o });

const estado = vi.hoisted(() => ({ lista: [] as unknown[], hilos: {} as Record<string, unknown>, aprobar: vi.fn() }));
vi.mock("@/hooks/useSeguimientoAgentes", () => ({
  useTareasSeguimiento: () => ({ data: estado.lista, isLoading: false, isError: false }),
  useHilo: (id: string) => ({ data: estado.hilos[id] }),
  useAprobarPlan: () => ({ mutate: estado.aprobar, isPending: false, isError: false }),
  useDescargarEntregable: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

import { PanelRequerimientos } from "@/components/agentes/PanelRequerimientos";
import { pendientesDeTi, totalPendientes, textoPendientes } from "@/lib/agentes/pendientes";
import { FranjaEnVivo } from "@/components/agentes/FranjaEnVivo";
import { figurasOficina } from "@/lib/agentes/oficina";

const AHORA = new Date(hoy);
const montar = (mensajes: unknown[] = []) => render(<MemoryRouter><PanelRequerimientos mensajes={mensajes as never} ahora={AHORA} /></MemoryRouter>);

describe("R6 · pendientes de ti (lógica)", () => {
  it("solo cuentan las tareas que esperan aprobación, la más antigua primero; una cumplida sale de la lista", () => {
    const l = [resumen(T1, A1, "Vizumi", "waiting_approval", { creada: "2026-11-25T10:00:00Z" }), resumen(T2, A2, "Nelli", "waiting_approval", { creada: "2026-11-24T10:00:00Z" }), resumen(T3, A1, "Vizumi", "completed")];
    expect(pendientesDeTi(l as never).map((p) => p.tareaId)).toEqual([T2, T1]);
    expect(pendientesDeTi(l.map((t) => (t.id === T1 ? { ...t, estado: "completed" } : t)) as never).map((p) => p.tareaId)).toEqual([T2]);
  });
  it("el total se cuenta por tarea y se dice en palabras", () => {
    expect(totalPendientes([{ status: "waiting_approval" }, { status: "waiting_approval" }, { status: "completed" }])).toBe(2);
    expect(textoPendientes(1)).toBe("1 pendiente de ti");
    expect(textoPendientes(0)).toBe("0 pendientes de ti");
  });
});

describe("R6 · franja «Equipo en vivo»", () => {
  const ag = (id: string, name: string) => ({ id, name, display_name: name, description: null, role: null, status: "idle", kind: "consultable", last_heartbeat: new Date().toISOString(), last_task_at: null, tasks_completed: 0, tasks_failed: 0 });
  const figs = figurasOficina([ag(A1, "vizumi"), ag(A2, "nelli")] as never, [], new Date());
  it("muestra el total de pendientes de todos los agentes", () => {
    render(<FranjaEnVivo figuras={figs} departamentoDe={() => "x"} pendientes={3} esperan={new Set([A1, A2])} />);
    expect(screen.getByTestId("franja-esperan").textContent).toContain("3 pendientes de ti");
  });
  it("sin pendientes no dice nada de espera", () => {
    render(<FranjaEnVivo figuras={figs} departamentoDe={() => "x"} pendientes={0} />);
    expect(screen.queryByTestId("franja-esperan")).toBeNull();
  });
});

describe("R6 · panel «Requerimientos» de la conversación", () => {
  beforeEach(() => { estado.lista = []; estado.hilos = {}; estado.aprobar.mockReset(); });
  it("tiene tres pestañas y resume pendientes y documentos", () => {
    estado.lista = [resumen(T1, A1, "Vizumi", "waiting_approval")];
    montar([{ task_id: T3, rol: "agente", texto: "ok", cuando: hoy, estado: "completed", entregables: [{ nombre: "a.pdf", formato: "pdf", bytes: 1, titulo: "a", creado: hoy }] }]);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Pendientes de ti · 1", "De la autoridad", "Documentos · 1"]);
    expect(screen.getByTestId("requerimientos-resumen").textContent).toContain("1 pendiente de ti · 1 documento");
  });
  it("cada pendiente dice el agente y el motivo; sin plan solo ofrece abrir el chat", () => {
    estado.lista = [resumen(T1, A1, "Vizumi", "waiting_approval")];
    montar();
    const f = screen.getByTestId(`pendiente-${T1}`).textContent!;
    expect(f).toContain("Vizumi");
    expect(f).toContain("Espera tu aprobación");
    expect(screen.queryByTestId(`pendiente-aprobar-${T1}`)).toBeNull();
    expect(screen.getByTestId(`pendiente-chat-${T1}`).getAttribute("href")).toBe(`/agentes/chat/${A1}?conv=${T1}`);
  });
  it("si el agente propuso un plan, «Aprobar» lo aprueba desde el pendiente", () => {
    estado.lista = [resumen(T1, A1, "Vizumi", "waiting_approval")];
    estado.hilos[T1] = { mensajes: [{ task_id: T1, rol: "agente", texto: "plan", cuando: hoy, estado: "waiting_approval", entregables: [], plan: { fase: "propuesto" } }] };
    montar();
    fireEvent.click(screen.getByTestId(`pendiente-aprobar-${T1}`));
    expect(estado.aprobar).toHaveBeenCalledWith(T1);
  });
  it("un seguimiento abre el chat de la solicitud original", () => {
    estado.lista = [resumen(T2, A1, "Vizumi", "waiting_approval", { hilo: T1 })];
    montar();
    expect(screen.getByTestId(`pendiente-chat-${T2}`).getAttribute("href")).toBe(`/agentes/chat/${A1}?conv=${T1}`);
  });
  it("sin pendientes lo dice", () => {
    montar();
    expect(screen.getByTestId("pendientes-vacio").textContent).toBe("Nada pendiente de ti.");
  });
  it("«De la autoridad» no muestra datos ni ejemplos ni campos entre corchetes, y explica lo pendiente", () => {
    const { container } = montar();
    fireEvent.click(screen.getByTestId("req-tab-autoridad"));
    const t = screen.getByTestId("autoridad-sin-datos").textContent!;
    expect(t).toContain("Aún no hay requerimientos de la autoridad");
    expect(t).toContain("Sin plazo leído");
    expect(container.textContent).not.toMatch(/\[[^\]]+\]/);
    expect(container.textContent).not.toMatch(/Folio|Plazo \d/);
  });
  it("«Documentos» reubica la lista con Ver (PDF) y Descargar", () => {
    montar([{ task_id: T3, rol: "agente", texto: "ok", cuando: hoy, estado: "completed", entregables: [{ nombre: "a.pdf", formato: "pdf", bytes: 1000, titulo: "a", creado: hoy }, { nombre: "b.docx", formato: "docx", bytes: 1000, titulo: "b", creado: hoy }] }]);
    fireEvent.click(screen.getByTestId("req-tab-documentos"));
    expect(screen.getByTestId(`doc-ver-${T3}-0`)).toBeTruthy();
    expect(screen.queryByTestId(`doc-ver-${T3}-1`)).toBeNull();
    expect(screen.getByTestId(`doc-descargar-${T3}-1`)).toBeTruthy();
  });
  it("se puede plegar", () => {
    montar();
    fireEvent.click(screen.getByTestId("requerimientos-resumen"));
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
