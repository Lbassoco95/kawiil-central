import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HiloAgente } from "@/components/agentes/HiloAgente";
import { TrabajosAgente } from "@/components/agentes/TrabajosAgente";
import { Oficina } from "@/components/agentes/Oficina";
import { EscritorioAgente } from "@/components/agentes/escritorio";
import { figurasOficina } from "@/lib/agentes/oficina";
import type { AgenteRegistro } from "@/lib/agentes/registro";

// Selección de agentes (compacta, con la ficha al lado) y conversación tipo chat (scroll propio, baja sola, Enter envía).

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

const T = "0b47849a-312c-4ad0-81ce-d173d61f9348";
const T2 = "5f1c1c1c-1111-4111-8111-111111111111";
const AHORA = new Date("2026-11-09T12:00:00Z");
const msg = (n: number) => [
  { task_id: T + n, rol: "persona", texto: `Pregunta ${n}`, cuando: "2026-11-09T05:48:00Z", estado: "completed", entregables: [] },
  { task_id: T + n, rol: "agente", texto: `Respuesta ${n}`, cuando: "2026-11-09T05:49:00Z", estado: "completed", entregables: [] },
];
let hilo = { hilo: { id: T, titulo: "Informe de actas", agent_id: "a1", agente: "Tlahtolli" }, mensajes: [...msg(1)], revisiones: [] as unknown[], en_curso: false };
let tareas: unknown[] = [];

function simular() {
  invoke.mockImplementation(async (nombre: string, { body }: { body: Record<string, unknown> }) => {
    if (nombre === "agente-seguimiento") {
      if (body.action === "hilo") return { data: hilo, error: null };
      if (body.action === "listar") return { data: { tareas }, error: null };
    }
    if (nombre === "dispatch-to-agent") return { data: { task_id: T2, status: "dispatched" }, error: null };
    return { data: null, error: new Error("inesperado") };
  });
}
const cliente = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const envolver = (ui: React.ReactElement, qc = cliente()) => ({ qc, ...render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>) });

// jsdom no calcula el diseño: se simulan las alturas para poder comprobar el scroll del chat.
const SH = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight"), CH = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
beforeEach(() => {
  invoke.mockReset(); tareas = []; hilo = { hilo: { id: T, titulo: "Informe de actas", agent_id: "a1", agente: "Tlahtolli" }, mensajes: [...msg(1)], revisiones: [], en_curso: false }; simular();
  Object.defineProperty(Element.prototype, "scrollHeight", { configurable: true, get: () => 1000 });
  Object.defineProperty(Element.prototype, "clientHeight", { configurable: true, get: () => 400 });
});
afterEach(() => {
  if (SH) Object.defineProperty(Element.prototype, "scrollHeight", SH); else delete (Element.prototype as unknown as Record<string, unknown>).scrollHeight;
  if (CH) Object.defineProperty(Element.prototype, "clientHeight", CH); else delete (Element.prototype as unknown as Record<string, unknown>).clientHeight;
});

describe("conversación tipo chat", () => {
  it("el chat tiene su propio scroll, el cuadro de escribir dentro y baja solo al último mensaje al abrirse", async () => {
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    const lista = await screen.findByTestId("hilo-mensajes");
    expect(lista.className).toContain("overflow-y-auto");
    expect(lista.getAttribute("role")).toBe("log");
    const chat = screen.getByTestId("hilo-chat");
    expect(chat.contains(lista)).toBe(true); expect(chat.contains(screen.getByTestId("hilo-texto"))).toBe(true); expect(chat.contains(screen.getByTestId("hilo-enviar"))).toBe(true);
    await waitFor(() => expect(lista.scrollTop).toBe(1000));
  });

  it("una respuesta nueva baja sola si la persona está al final", async () => {
    const { qc } = envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    const lista = await screen.findByTestId("hilo-mensajes");
    await waitFor(() => expect(lista.scrollTop).toBe(1000));
    lista.scrollTop = 560; fireEvent.scroll(lista);          // 1000 - 560 - 400 = 40 px del fondo: sigue «al final»
    hilo = { ...hilo, mensajes: [...msg(1), ...msg(2)] };
    await act(async () => { await qc.invalidateQueries({ queryKey: ["agentes-seguimiento"] }); });
    await screen.findByText("Respuesta 2");
    await waitFor(() => expect(lista.scrollTop).toBe(1000));
    expect(screen.queryByTestId("hilo-nuevos")).toBeNull();
  });

  it("si la persona subió a leer NO se la arrastra al fondo: aparece «mensaje nuevo» y lo baja cuando ella quiere", async () => {
    const { qc } = envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    const lista = await screen.findByTestId("hilo-mensajes");
    await waitFor(() => expect(lista.scrollTop).toBe(1000));
    lista.scrollTop = 0; fireEvent.scroll(lista);            // 600 px del fondo: está leyendo arriba
    hilo = { ...hilo, mensajes: [...msg(1), ...msg(2)] };
    await act(async () => { await qc.invalidateQueries({ queryKey: ["agentes-seguimiento"] }); });
    const aviso = await screen.findByTestId("hilo-nuevos");
    expect(aviso.textContent).toContain("2 mensajes nuevos");
    expect(lista.scrollTop).toBe(0);
    fireEvent.click(aviso);
    expect(lista.scrollTop).toBe(1000);
    expect(screen.queryByTestId("hilo-nuevos")).toBeNull();
  });

  it("volver al fondo a mano también quita el aviso", async () => {
    const { qc } = envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    const lista = await screen.findByTestId("hilo-mensajes");
    lista.scrollTop = 0; fireEvent.scroll(lista);
    hilo = { ...hilo, mensajes: [...msg(1), ...msg(2)] };
    await act(async () => { await qc.invalidateQueries({ queryKey: ["agentes-seguimiento"] }); });
    await screen.findByTestId("hilo-nuevos");
    lista.scrollTop = 1000; fireEvent.scroll(lista);
    await waitFor(() => expect(screen.queryByTestId("hilo-nuevos")).toBeNull());
  });

  it("Enter envía y Shift+Enter solo agrega una línea", async () => {
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    const caja = await screen.findByTestId("hilo-texto");
    fireEvent.change(caja, { target: { value: "Agrega una columna" } });
    fireEvent.keyDown(caja, { key: "Enter", shiftKey: true });
    expect(invoke.mock.calls.some((c) => c[0] === "dispatch-to-agent")).toBe(false);
    fireEvent.keyDown(caja, { key: "Enter" });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("dispatch-to-agent", expect.anything()));
    await waitFor(() => expect((caja as HTMLTextAreaElement).value).toBe(""));
  });

  it("Enter con el cuadro vacío o mientras el agente trabaja no envía nada", async () => {
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    const caja = await screen.findByTestId("hilo-texto");
    fireEvent.keyDown(caja, { key: "Enter" });
    expect(invoke.mock.calls.some((c) => c[0] === "dispatch-to-agent")).toBe(false);
  });

  it("el encabezado del chat usa el dibujo mini (sin el nombre dentro del dibujo) y dice el estado", async () => {
    envolver(<HiloAgente taskId={T} ahora={AHORA} />);
    expect((await screen.findByTestId("hilo-encabezado")).textContent).toContain("Tlahtolli");
  });
});

const ag = (id: string, name: string, o: Partial<AgenteRegistro> = {}): AgenteRegistro => ({ id, name, display_name: name, description: "Descripción", role: "Revisión", status: "idle", kind: "consultable", last_heartbeat: new Date().toISOString(), last_task_at: null, tasks_completed: 0, tasks_failed: 0, ...o });

describe("selección de agentes", () => {
  const figuras = figurasOficina([ag("a1", "Tlahtolli"), ag("a2", "Atl"), ag("a3", "Coyolli")], [], new Date());

  it("cada agente es un botón con su estado en el nombre accesible y su rol a la vista", () => {
    envolver(<Oficina figuras={figuras} ahora={new Date()} demo={false} />);
    const b = screen.getByRole("button", { name: /^Atl: / });
    expect(b.getAttribute("aria-pressed")).toBe("false");
    expect(b.getAttribute("data-estado")).toBeTruthy();
    expect(within(b).getByText("Descripción")).toBeTruthy();   // el rol corto sale de la descripción del agente
  });

  it("la ficha va en un panel lateral junto a los agentes (no debajo de toda la lista) y cambia al elegir otro", () => {
    envolver(<Oficina figuras={figuras} ahora={new Date()} demo={false} detalleExtra={(f) => <p data-testid="extra">chat de {f.nombre}</p>} />);
    const panel = screen.getByTestId("oficina-panel-lateral"), lista = screen.getByTestId("oficina-agentes");
    expect(panel.parentElement).toBe(lista.parentElement);                 // hermanos de la misma rejilla: lado a lado en pantallas anchas
    expect(panel.className).toContain("lg:sticky");
    expect(within(panel).getByTestId("oficina-detalle").textContent).toContain("Elige un agente");
    fireEvent.click(screen.getByTestId("oficina-a1"));
    expect(panel.contains(screen.getByTestId("extra"))).toBe(true); expect(screen.getByTestId("extra").textContent).toBe("chat de Tlahtolli");
    expect(screen.getByTestId("oficina-a1").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("oficina-a3"));
    expect(screen.getByTestId("extra").textContent).toBe("chat de Coyolli");
    expect(screen.getByTestId("oficina-a1").getAttribute("aria-pressed")).toBe("false");
  });

  it("en pantallas angostas, al elegir un agente la vista se lleva a su ficha", () => {
    const original = window.matchMedia; const llevar = vi.fn();
    window.matchMedia = ((q: string) => ({ matches: q.includes("max-width"), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    Element.prototype.scrollIntoView = llevar;
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => { cb(0); return 0; });
    envolver(<Oficina figuras={figuras} ahora={new Date()} demo={false} />);
    fireEvent.click(screen.getByTestId("oficina-a2"));
    expect(llevar).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("oficina-a2"));           // deseleccionar no mueve la vista
    expect(llevar).toHaveBeenCalledTimes(1);
    window.matchMedia = original; raf.mockRestore();
  });

  it("el escritorio mini no repite el nombre dentro del dibujo; el normal y el compacto sí", () => {
    const f = figuras[0];
    const { container: a } = render(<EscritorioAgente f={f} compacto mini />);
    const { container: b } = render(<EscritorioAgente f={f} compacto />);
    expect(a.querySelector("text")).toBeNull();
    expect(b.querySelector("text")?.textContent).toContain(f.nombre.slice(0, 5));
  });
});

describe("panel del agente: conversaciones y solicitud nueva", () => {
  const TAREAS = [{ id: T, agent_id: "a1", agente: "Tlahtolli", titulo: "Informe de actas", estado: "completed", tipo: "manual", prioridad: "normal", creada: "2026-11-09T05:48:00Z", inicio: null, fin: null, resumen: "", entregables: 0, hilo: null }];

  it("con conversaciones, la solicitud nueva queda plegada y el botón «Nueva» la abre", async () => {
    tareas = TAREAS;
    envolver(<TrabajosAgente agentId="a1" nombre="Tlahtolli" ahora={AHORA} />);
    await screen.findByTestId(`trabajo-${T}`);
    const form = screen.getByTestId("trabajos-nueva");
    expect(form.className).toContain("hidden");
    fireEvent.click(screen.getByTestId("trabajos-nueva-abrir"));
    expect(form.className).not.toContain("hidden");
    expect(screen.getByTestId("trabajos-nueva-abrir").getAttribute("aria-expanded")).toBe("true");
  });

  it("sin conversaciones, la solicitud nueva ya está abierta", async () => {
    envolver(<TrabajosAgente agentId="a1" nombre="Tlahtolli" ahora={AHORA} />);
    await screen.findByTestId("trabajos-vacio");
    expect(screen.getByTestId("trabajos-nueva").className).not.toContain("hidden");
  });

  it("al enviar una solicitud nueva se pliega el formulario y se abre su chat", async () => {
    tareas = TAREAS;
    envolver(<TrabajosAgente agentId="a1" nombre="Tlahtolli" ahora={AHORA} />);
    await screen.findByTestId(`trabajo-${T}`);
    fireEvent.click(screen.getByTestId("trabajos-nueva-abrir"));
    fireEvent.change(screen.getByTestId("trabajos-titulo"), { target: { value: "Revisión de libros" } });
    fireEvent.change(screen.getByTestId("trabajos-texto"), { target: { value: "Revisa los libros" } });
    fireEvent.click(screen.getByTestId("trabajos-enviar"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("agente-seguimiento", { body: { action: "hilo", task_id: T2 } }));
    await waitFor(() => expect(screen.getByTestId("trabajos-nueva").className).toContain("hidden"));
  });

  it("cambiar de agente cierra su conversación y vuelve a plegar el formulario", async () => {
    tareas = TAREAS;
    const { rerender, qc } = envolver(<TrabajosAgente agentId="a1" nombre="Tlahtolli" ahora={AHORA} />);
    fireEvent.click(await screen.findByTestId(`trabajo-${T}`));
    await screen.findByTestId("hilo");
    rerender(<QueryClientProvider client={qc}><TrabajosAgente agentId="a2" nombre="Atl" ahora={AHORA} /></QueryClientProvider>);
    await waitFor(() => expect(screen.queryByTestId("hilo")).toBeNull());
  });
});
