import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
const TA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", TB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", TC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc", TA2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const AHORA = new Date("2026-11-25T12:00:00Z");
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const res = (id: string, agent_id: string, agente: string, estado: string, o: Record<string, unknown> = {}) => ({ id, agent_id, agente, titulo: `Solicitud de ${agente}`, estado, tipo: "x", prioridad: "normal", creada: hace(30), inicio: null, fin: null, resumen: "", con_error: false, entregables: 0, hilo: null, ...o });

const est = vi.hoisted(() => ({ todas: [] as unknown[], porAgente: {} as Record<string, unknown[]>, detalle: {} as Record<string, unknown>, instruir: vi.fn(), registro: [] as unknown[], tareas: [] as unknown[] }));
vi.mock("@/components/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useAgentesEnVivo", () => ({ useAgentesEnVivo: () => "en_vivo" }));
vi.mock("@/components/agentes/IndicadorEnVivo", () => ({ IndicadorEnVivo: () => null }));
vi.mock("@/components/agentes/TrabajosAgente", () => ({ TrabajosAgente: ({ agentId }: { agentId: string }) => <div data-testid="stub-una">{agentId}</div> }));
vi.mock("@/components/agentes/HiloAgente", () => ({ HiloAgente: ({ taskId, sinCuadro }: { taskId: string; sinCuadro?: boolean }) => <div data-testid={`stub-hilo-${taskId}`} data-sin-cuadro={String(!!sinCuadro)} /> }));
vi.mock("@/hooks/useSeguimientoAgentes", () => ({
  useTareasSeguimiento: (_g: string, agentId?: string) => ({ data: agentId ? est.porAgente[agentId] ?? [] : est.todas, isLoading: false, isError: false }),
  useDetalleSeguimiento: (id: string) => ({ data: est.detalle[id] }),
}));
vi.mock("@/hooks/useAgenteConstructor", () => ({ useInstruirAgente: () => ({ mutateAsync: est.instruir, isPending: false }) }));
vi.mock("@/hooks/useAgentesRegistro", () => ({
  useAgentesRegistro: () => ({ data: est.registro, isLoading: false, isError: false, dataUpdatedAt: 0 }),
  useTareasAgentes: () => ({ data: est.tareas, isLoading: false, isError: false, dataUpdatedAt: 0 }),
}));

import { alternarVisible, conversacionesEnCurso, avancePorcentaje, leerModo, leerVer, MAX_A_LA_VEZ, ultimaLinea, visiblesAlaVez } from "@/lib/agentes/espacio";
import { PanelEnCurso } from "@/components/agentes/PanelEnCurso";
import AgentesChat from "@/pages/AgentesChat";
import { urlChat } from "@/lib/agentes/chat";

const ag = (id: string, name: string) => ({ id, name, display_name: name, description: null, role: null, status: "idle", kind: "consultable", last_heartbeat: new Date().toISOString(), last_task_at: null, tasks_completed: 0, tasks_failed: 0, config: null });

describe("R3 · lógica de «Varios a la vez»", () => {
  it("el modo y los agentes elegidos se leen de la dirección; lo raro vuelve a «una»", () => {
    expect(leerModo("varios")).toBe("varios");
    expect(leerModo("otra")).toBe("una");
    expect(leerVer(`${A},${A},basura,${B}`)).toEqual([A, B]);
  });
  it("se ven hasta el tope; sin elección, el activo y luego los demás abiertos", () => {
    expect(MAX_A_LA_VEZ).toBe(2);
    expect(visiblesAlaVez([A, B, C], [], B)).toEqual([B, A]);
    expect(visiblesAlaVez([A, B, C], [C, A, B], A)).toEqual([C, A]);
    expect(visiblesAlaVez([A, B], [C], A)).toEqual([A, B]);   // uno elegido que no está abierto no cuenta
  });
  it("marcar uno más del tope saca al que llevaba más tiempo", () => {
    expect(alternarVisible([A, B], C)).toEqual([B, C]);
    expect(alternarVisible([A, B], A)).toEqual([B]);
  });
});

describe("R4 · lógica de «En curso»", () => {
  it("agrupa por solicitud original, deja las activas y pone primero a las que trabajan", () => {
    const l = [res(TA, A, "Vizumi", "completed"), res(TA2, A, "Vizumi", "in_progress", { hilo: TA, creada: hace(5) }), res(TB, B, "Nelli", "waiting_approval"), res(TC, C, "Atl", "pending", { creada: hace(2) }), res("e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1", C, "Atl", "completed")];
    const r = conversacionesEnCurso(l as never);
    expect(r.map((c) => c.conversacion)).toEqual([TA, TB, TC]);
    expect(r[0]).toMatchObject({ tareaId: TA2, estado: "in_progress", titulo: "Solicitud de Vizumi" });   // el título es el de la solicitud original
  });
  it("la última línea es lo más reciente entre eventos y acciones; el avance, el último %", () => {
    const ev = [{ tipo: "started", secuencia: 1, progreso: 10, cuando: "2026-11-25T11:00:00Z", mensaje: "" }, { tipo: "thinking", secuencia: 2, progreso: 40, cuando: "2026-11-25T11:05:00Z", mensaje: "" }, { tipo: "attachment_processed", secuencia: 3, progreso: null, cuando: "2026-11-25T11:09:00Z", mensaje: "" }];
    const ac = [{ accion: "consultar", mensaje: "Leyó SITI AA", nivel: "info", cuando: "2026-11-25T11:07:00Z" }];
    expect(ultimaLinea(ev, ac)).toBe("Leyó SITI AA");
    expect(ultimaLinea(ev, [])).toBe("Analizando");
    expect(ultimaLinea([], [])).toBeNull();
    expect(avancePorcentaje(ev)).toBe(40);
    expect(avancePorcentaje([])).toBeNull();
  });
});

describe("R4 · panel «En curso»", () => {
  beforeEach(() => { est.todas = []; est.detalle = {}; });
  const montar = (abiertos: string[] = []) => render(<MemoryRouter><PanelEnCurso abiertos={abiertos} ahora={AHORA} /></MemoryRouter>);
  it("muestra agente, estado con palabra y marca, última línea y avance; tocar abre su pestaña", () => {
    est.todas = [res(TA, A, "Vizumi", "in_progress")];
    est.detalle[TA] = { tarea: {}, eventos: [{ tipo: "thinking", secuencia: 1, progreso: 40, cuando: "2026-11-25T11:05:00Z", mensaje: "Revisando listas" }], actividad: [] };
    montar([B]);
    expect(screen.getByTestId(`encurso-estado-${TA}`).textContent).toBe("●Trabajando");
    expect(screen.getByTestId(`encurso-linea-${TA}`).textContent).toBe("Revisando listas");
    expect(screen.getByTestId(`encurso-avance-${TA}`).textContent).toBe("Avance 40 %");
    expect(screen.getByTestId(`encurso-${TA}`).querySelector("a")!.getAttribute("href")).toBe(`/agentes/chat/${A}?conv=${TA}&a=${encodeURIComponent(`${A},${B}`)}`);
  });
  it("sin avance lo dice; sin nada en curso también", () => {
    est.todas = [res(TA, A, "Vizumi", "pending")];
    montar();
    expect(screen.getByTestId(`encurso-linea-${TA}`).textContent).toBe("Todavía sin avance registrado.");
    expect(screen.queryByTestId(`encurso-avance-${TA}`)).toBeNull();
  });
  it("vacío", () => { montar(); expect(screen.getByTestId("en-curso-vacio")).toBeTruthy(); });
});

describe("R3 · espacio de trabajo", () => {
  const Ruta = () => { const l = useLocation(); return <span data-testid="ruta">{decodeURIComponent(l.pathname + l.search)}</span>; };
  const montar = (url: string) => render(
    <QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={[url]}><Routes><Route path="/agentes/chat/:agenteId" element={<><AgentesChat /><Ruta /></>} /></Routes></MemoryRouter></QueryClientProvider>);
  const pantalla = (ancha: boolean) => { window.matchMedia = ((q: string) => ({ matches: q.includes("max-width") ? !ancha : ancha, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false })) as never; };
  beforeEach(() => {
    pantalla(true);
    est.registro = [ag(A, "vizumi"), ag(B, "nelli"), ag(C, "atl")]; est.tareas = []; est.todas = []; est.detalle = {};
    est.porAgente = { [A]: [res(TA, A, "vizumi", "completed")], [B]: [res(TB, B, "nelli", "completed")], [C]: [] };
    est.instruir.mockReset(); est.instruir.mockResolvedValue({ task_id: "x" });
  });
  it("«Una conversación» es la vista por defecto; cambiar a «Varios a la vez» conserva los agentes abiertos", () => {
    montar(`/agentes/chat/${A}?a=${A},${B}`);
    expect(screen.getByTestId("stub-una").textContent).toBe(A);
    expect(screen.getByTestId("modo-una").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("modo-varios"));
    expect(screen.getByTestId("espacio-varios")).toBeTruthy();
    expect(screen.getByTestId("ruta").textContent).toContain(`modo=varios&ver=${A},${B}`);
  });
  it("«Varios a la vez» muestra los chats lado a lado, sin cuadro propio, cada uno con su estado y «Abrir en pestaña»", () => {
    montar(`/agentes/chat/${A}?a=${A},${B}&modo=varios`);
    for (const [id, t] of [[A, TA], [B, TB]] as const) {
      expect(screen.getByTestId(`stub-hilo-${t}`).getAttribute("data-sin-cuadro")).toBe("true");
      expect(screen.getByTestId(`varios-estado-${id}`).textContent).toMatch(/Disponible|Trabajando/);
      expect(screen.getByTestId(`varios-pestana-${id}`).getAttribute("target")).toBe("_blank");
    }
    expect(screen.getAllByTestId("varios-texto")).toHaveLength(1);   // un solo cuadro para escribir
  });
  it("un solo mensaje llega a cada agente marcado, en su conversación", async () => {
    montar(`/agentes/chat/${A}?a=${A},${B}&modo=varios`);
    fireEvent.change(screen.getByTestId("varios-texto"), { target: { value: "Revisa los vencimientos de esta semana" } });
    fireEvent.click(screen.getByTestId("varios-enviar"));
    await waitFor(() => expect(est.instruir).toHaveBeenCalledTimes(2));
    expect(est.instruir).toHaveBeenCalledWith(expect.objectContaining({ agent_id: A, hilo_id: TA, instructions: "Revisa los vencimientos de esta semana" }));
    expect(est.instruir).toHaveBeenCalledWith(expect.objectContaining({ agent_id: B, hilo_id: TB }));
    expect(est.instruir.mock.calls.every(([v]) => !("accesos_aprobados" in v) && !("escrituras_aprobadas" in v))).toBe(true);   // sin accesos ni escritura
    await waitFor(() => expect(screen.getByTestId("varios-resultados").textContent).toContain("Enviado"));
  });
  it("también se le puede escribir a uno solo, y a uno sin conversación se le abre una nueva", async () => {
    montar(`/agentes/chat/${C}?a=${C}&modo=varios`);
    fireEvent.change(screen.getByTestId("varios-texto"), { target: { value: "Hola" } });
    fireEvent.click(screen.getByTestId("varios-enviar"));
    await waitFor(() => expect(est.instruir).toHaveBeenCalledTimes(1));
    expect(est.instruir.mock.calls[0][0]).toMatchObject({ agent_id: C, instructions: "Hola" });
    expect(est.instruir.mock.calls[0][0].hilo_id).toBeUndefined();
  });
  it("desmarcar a un agente: el mensaje solo va a los marcados; un fallo de uno no frena al otro", async () => {
    est.instruir.mockImplementation(async (v: { agent_id: string }) => { if (v.agent_id === B) throw new Error("No se pudo enviar."); return { task_id: "x" }; });
    montar(`/agentes/chat/${A}?a=${A},${B},${C}&modo=varios&ver=${A},${B}`);
    fireEvent.change(screen.getByTestId("varios-texto"), { target: { value: "Hola" } });
    fireEvent.click(screen.getByTestId("varios-enviar"));
    await waitFor(() => expect(screen.getByTestId("varios-resultados")).toBeTruthy());
    expect(est.instruir).toHaveBeenCalledTimes(2);
    const r = screen.getByTestId("varios-resultados").textContent!;
    expect(r).toContain("vizumi: Enviado."); expect(r).toContain("nelli: No se pudo enviar.");
    fireEvent.click(screen.getByTestId(`varios-marcar-${A}`));
    expect(screen.getByTestId("varios-cuadro").textContent).toContain("Escribir a: nelli");
  });
  it("no se le encima otra tarea a un agente que está trabajando en esa conversación", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["agentes-seguimiento", "hilo", TA], { en_curso: true }, { updatedAt: Date.now() + 1e10 });
    render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[`/agentes/chat/${A}?a=${A},${B}&modo=varios`]}><Routes><Route path="/agentes/chat/:agenteId" element={<AgentesChat />} /></Routes></MemoryRouter></QueryClientProvider>);
    fireEvent.change(screen.getByTestId("varios-texto"), { target: { value: "Hola" } });
    fireEvent.click(screen.getByTestId("varios-enviar"));
    await waitFor(() => expect(screen.getByTestId("varios-resultados").textContent).toContain("Está trabajando"));
    expect(est.instruir).toHaveBeenCalledTimes(1);
    expect(est.instruir.mock.calls[0][0].agent_id).toBe(B);   // el otro agente sí recibió su mensaje
  });
  it("elegir cuáles se ven respeta el tope", () => {
    montar(`/agentes/chat/${A}?a=${A},${B},${C}&modo=varios&ver=${A},${B}`);
    fireEvent.click(screen.getByTestId(`varios-ver-${C}`));
    expect(screen.getByTestId("ruta").textContent).toContain(`ver=${B},${C}`);
    expect(screen.getByTestId("varios-elegir").textContent).toContain(`hasta ${MAX_A_LA_VEZ} a la vez`);
  });
  it("la lista «En curso» está en las dos vistas", () => {
    montar(`/agentes/chat/${A}`);
    expect(screen.getByTestId("en-curso")).toBeTruthy();
    fireEvent.click(screen.getByTestId("modo-varios"));
    expect(screen.getByTestId("en-curso")).toBeTruthy();
  });
  it("en el celular «Varios a la vez» no aplica: no se ofrece y la dirección con `modo=varios` muestra una conversación", () => {
    pantalla(false);
    montar(`/agentes/chat/${A}?a=${A},${B}&modo=varios`);
    expect(screen.queryByTestId("modo-varios")).toBeNull();
    expect(screen.queryByTestId("espacio-varios")).toBeNull();
    expect(screen.getByTestId("stub-una").textContent).toBe(A);
  });
  it("urlChat conserva la vista «Varios a la vez»", () => {
    expect(decodeURIComponent(urlChat(A, { abiertos: [B], modo: "varios", ver: [A, B] }))).toBe(`/agentes/chat/${A}?a=${A},${B}&modo=varios&ver=${A},${B}`);
    expect(urlChat(A, { modo: "una" })).toBe(`/agentes/chat/${A}`);
  });
});
