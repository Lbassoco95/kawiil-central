import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const J = "11111111-1111-4111-8111-111111111111", V = "22222222-2222-4222-8222-222222222222";
const TA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AHORA = new Date("2026-11-26T12:00:00Z");
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
const ag = (id: string, name: string, config: Record<string, unknown> | null = null) => ({ id, name, display_name: name, description: null, role: null, status: "idle", kind: "consultable", last_heartbeat: hace(3), last_task_at: null, tasks_completed: 0, tasks_failed: 0, config });
const AGENTES = [ag(J, "vizumi_listas_y_kyc_vizum_vizum"), ag(V, "vigilante_siti", { creado_por: { tipo: "agente", id: J, para: "Revisar SITI" }, creado_en: hace(60) })];
const pendiente = { id: TA, agent_id: J, agente: "Vizumi", titulo: "Cruce de listas", estado: "waiting_approval", tipo: "x", prioridad: "normal", creada: hace(30), inicio: null, fin: null, resumen: "", con_error: false, entregables: 0, hilo: null };

const est = vi.hoisted(() => ({ movil: true }));
const MQ = (q: string) => ({ matches: q.includes("max-width") ? est.movil : !est.movil, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false });

vi.mock("@/components/AppLayout", () => ({ AppLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useAgentesEnVivo", () => ({ useAgentesEnVivo: () => "en_vivo" }));
vi.mock("@/components/agentes/IndicadorEnVivo", () => ({ IndicadorEnVivo: () => null }));
vi.mock("@/components/agentes/TrabajosAgente", () => ({ TrabajosAgente: ({ agentId, claseAlto }: { agentId: string; claseAlto?: string }) => <div data-testid="stub-chat" data-alto={claseAlto}>{agentId}</div> }));
vi.mock("@/components/agentes/PanelAgente", () => ({ SeccionAgente: ({ seccion }: { seccion: string }) => <div data-testid="stub-seccion">{seccion}</div> }));
vi.mock("@/components/agentes/PanelRequerimientos", () => ({ PanelRequerimientos: ({ pantalla }: { pantalla?: boolean }) => <div data-testid="stub-requerimientos" data-pantalla={String(!!pantalla)} /> }));
vi.mock("@/components/agentes/EspacioVarios", () => ({ EspacioVarios: () => <div data-testid="stub-varios" /> }));
vi.mock("@/hooks/useSeguimientoAgentes", () => ({
  useTareasSeguimiento: () => ({ data: [pendiente], isLoading: false, isError: false }),
  useDetalleSeguimiento: () => ({ data: undefined }),
  useHilo: () => ({ data: { mensajes: [] } }),
}));
const registro = vi.hoisted(() => ({ agentes: [] as unknown[] }));
vi.mock("@/hooks/useAgentesRegistro", () => ({
  useAgentesRegistro: () => ({ data: registro.agentes, isLoading: false, isError: false, dataUpdatedAt: 0 }),
  useTareasAgentes: () => ({ data: [], isLoading: false, isError: false, dataUpdatedAt: 0 }),
}));

import AgentesChat from "@/pages/AgentesChat";
import { SalaIsometrica } from "@/components/agentes/SalaIsometrica";
import { VistaOficina } from "@/components/agentes/VistaOficina";
import { DEPARTAMENTOS } from "@/lib/agentes/departamentos";
import { figurasOficina } from "@/lib/agentes/oficina";
import { VISTA_PLANO } from "@/lib/agentes/vistas";

beforeEach(() => { est.movil = true; window.matchMedia = MQ as never; registro.agentes = AGENTES; });
const figs = () => figurasOficina(AGENTES as never, [], AHORA);

describe("R7 · la sala en el celular", () => {
  it("la lista de agentes va primero y el plano de apoyo después; en pantalla ancha todo sigue igual", () => {
    render(<SalaIsometrica depto={DEPARTAMENTOS.cumplimiento} figuras={figs().filter((f) => f.id === J)} onElegir={() => {}} hrefPestana={(id) => `/agentes/chat/${id}`} />);
    expect(screen.getByTestId("sala-zonas").className).toMatch(/\border-1\b/);
    expect(screen.getByTestId("sala-zonas").className).toMatch(/sm:order-none/);
    expect(screen.getByTestId("sala-cumplimiento").className).toContain("flex-col");
    expect(screen.getByTestId(`sala-pestana-${J}`).className).toContain("hidden");     // «Abrir en pestaña» no se ofrece en el celular
    expect(screen.getByTestId(`sala-pestana-${J}`).className).toContain("sm:inline");
  });
  it("cada agente de la lista mide al menos 44 px de alto en el celular", () => {
    render(<SalaIsometrica depto={DEPARTAMENTOS.cumplimiento} figuras={figs().filter((f) => f.id === J)} onElegir={() => {}} />);
    expect(screen.getByTestId(`sala-lista-${J}`).className).toContain("min-h-11");
  });
  it("tocar a un agente abre su chat a pantalla completa; en pantalla ancha abre el panel de la sala", () => {
    const chat = vi.fn(), panel = vi.fn();
    const { unmount } = render(<MemoryRouter><VistaOficina figuras={figs()} agentes={AGENTES as never} tareas={[]} ahora={AHORA} vista={{ tipo: "isla", clave: "cumplimiento" }} onVista={() => {}} onElegirAgente={panel} onAbrirChat={chat} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId(`sala-lista-${J}`));
    expect(chat).toHaveBeenCalledWith(J); expect(panel).not.toHaveBeenCalled();
    unmount();
    est.movil = false; chat.mockReset();
    render(<MemoryRouter><VistaOficina figuras={figs()} agentes={AGENTES as never} tareas={[]} ahora={AHORA} vista={{ tipo: "isla", clave: "cumplimiento" }} onVista={() => {}} onElegirAgente={panel} onAbrirChat={chat} /></MemoryRouter>);
    fireEvent.click(screen.getByTestId(`sala-lista-${J}`));
    expect(panel).toHaveBeenCalledWith(J); expect(chat).not.toHaveBeenCalled();
  });
  it("la oficina de un equipo aparece como una sección con su nombre y se abre en su propia pantalla", () => {
    const abrir = vi.fn();
    render(<MemoryRouter><VistaOficina figuras={figs()} agentes={AGENTES as never} tareas={[]} ahora={AHORA} vista={{ tipo: "isla", clave: "cumplimiento" }} onVista={abrir} onElegirAgente={() => {}} /></MemoryRouter>);
    const sec = screen.getByTestId(`lista-oficina-${J}`);
    expect(sec.textContent).toContain("Oficina de");
    const b = within(sec).getByTestId(`lista-oficina-abrir-${J}`);
    expect(b.className).toContain("min-h-11");
    fireEvent.click(b);
    expect(abrir).toHaveBeenCalledWith({ tipo: "oficina", id: J });
    void VISTA_PLANO;
  });
});

describe("R7 · el chat en el celular", () => {
  const Ruta = () => { const l = useLocation(); return <span data-testid="ruta">{decodeURIComponent(l.pathname + l.search)}</span>; };
  const montar = (url: string) => render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/agentes/chat/:agenteId" element={<><AgentesChat /><Ruta /></>} /></Routes></MemoryRouter>);

  it("ocupa toda la pantalla: barra con «‹ Sala», el nombre del agente y el botón «Requerimientos» con su total; sin «Varios a la vez»", () => {
    montar(`/agentes/chat/${V}?a=${V},${J}`);
    expect(screen.getByTestId("agentes-chat").getAttribute("data-movil")).toBe("true");
    expect(screen.getByTestId("chat-volver-sala").textContent).toBe("‹ Sala");
    expect(screen.getByTestId("chat-titulo-movil").textContent).toBe("vigilante_siti");
    expect(screen.getByTestId("boton-requerimientos-total").textContent).toBe("1");
    expect(screen.queryByTestId("modo-varios")).toBeNull();
    expect(screen.getByTestId("stub-chat").getAttribute("data-alto")).toContain("100dvh");   // el chat llena la pantalla: el cuadro para escribir queda abajo
    expect(screen.getByTestId("agentes-chat").className).toContain("fixed inset-0");        // pantalla completa
  });
  it("las secciones del agente se recorren de lado (Conversaciones, Perfil, Aprendizaje, Rutinas y Documentos)", () => {
    montar(`/agentes/chat/${V}`);
    expect(within(screen.getByTestId("chat-secciones")).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Conversaciones", "Perfil", "Aprendizaje", "Rutinas", "Documentos"]);
    expect(screen.getByTestId("chat-secciones").className).toContain("overflow-x-auto");
    expect(screen.getByTestId("stub-chat")).toBeTruthy();
    fireEvent.click(screen.getByTestId("seccion-perfil"));
    expect(screen.getByTestId("stub-seccion").textContent).toBe("perfil");
    expect(screen.queryByTestId("stub-chat")).toBeNull();
    fireEvent.click(screen.getByTestId("seccion-conversaciones"));
    expect(screen.getByTestId("stub-chat")).toBeTruthy();
  });
  it("con varias conversaciones abiertas se cambia de agente con un toque en las pestañas de arriba", () => {
    montar(`/agentes/chat/${V}?a=${V},${J}`);
    const nav = screen.getByTestId("chat-pestanas");
    expect(nav.className).toContain("overflow-x-auto");
    const link = within(screen.getByTestId(`pestana-chat-${J}`)).getByRole("link");
    expect(link.className).toContain("min-h-11");
    expect(link.getAttribute("href")).toContain(`/agentes/chat/${J}`);
    expect(screen.getByTestId(`cerrar-pestana-${J}`).className).toMatch(/h-11 w-11/);
  });
  it("los requerimientos se abren en una pantalla propia desde el chat y se vuelve al chat", () => {
    montar(`/agentes/chat/${V}?conv=${TA}`);
    fireEvent.click(screen.getByTestId("boton-requerimientos"));
    expect(screen.getByTestId("pantalla-requerimientos")).toBeTruthy();
    expect(screen.getByTestId("stub-requerimientos").getAttribute("data-pantalla")).toBe("true");
    expect(screen.queryByTestId("stub-chat")).toBeNull();
    expect(screen.getByTestId("ruta").textContent).toContain("req=1");
    fireEvent.click(screen.getByTestId("requerimientos-volver"));
    expect(screen.queryByTestId("pantalla-requerimientos")).toBeNull();
    expect(screen.getByTestId("stub-chat")).toBeTruthy();
  });
  it("los controles táctiles del chat miden al menos 44 px", () => {
    montar(`/agentes/chat/${V}`);
    for (const id of ["chat-volver-sala", "boton-requerimientos", "seccion-perfil", "en-curso-alternar"]) expect(screen.getByTestId(id).className).toContain("min-h-11");
  });
  it("«En curso» empieza plegada para no quitarle pantalla al chat", () => {
    montar(`/agentes/chat/${V}`);
    expect(screen.queryByTestId(`encurso-${TA}`)).toBeNull();
    fireEvent.click(screen.getByTestId("en-curso-alternar"));
    expect(screen.getByTestId(`encurso-${TA}`)).toBeTruthy();
  });
  it("un agente en Solo lectura lo dice con su aclaración también en el celular", () => {
    montar(`/agentes/chat/${V}`);
    expect(screen.getByTestId(`aclaracion-solo_lectura-${V}`).textContent).toContain("Qué significa «Solo lectura»");
  });
  it("en pantalla ancha el chat conserva su diseño: título de página, sin barra móvil ni secciones", () => {
    est.movil = false;
    montar(`/agentes/chat/${V}`);
    expect(screen.getByTestId("agentes-chat").getAttribute("data-movil")).toBe("false");
    expect(screen.queryByTestId("chat-secciones")).toBeNull();
    expect(screen.queryByTestId("boton-requerimientos")).toBeNull();
    expect(screen.getByTestId("modo-varios")).toBeTruthy();
  });
});
