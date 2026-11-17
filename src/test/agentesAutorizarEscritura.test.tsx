import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { dominiosEscritura } from "../../supabase/functions/_shared/seguimiento";
import { TrabajosAgente } from "@/components/agentes/TrabajosAgente";
import { HiloAgente } from "@/components/agentes/HiloAgente";
import type { AgenteRegistro } from "@/lib/agentes/registro";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

const T = "0b47849a-312c-4ad0-81ce-d173d61f9348";
const DASH = "dashboard.vizum.mx";
const agente = (config: Record<string, unknown>) => ({ id: "a1", name: "vizumi", display_name: "Vizumi", description: "d", role: "r", status: "idle", kind: "consultable", last_heartbeat: null, last_task_at: null, config }) as unknown as AgenteRegistro;
const envolver = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("sitios donde se puede autorizar escribir", () => {
  it("solo los que Dirección habilitó (navegador activo) y bien formados", () => {
    expect(dominiosEscritura({ navegador: { activo: true, escritura: [DASH, "Dashboard.Vizum.MX", "no es dominio", 5, null, "evil", DASH] } })).toEqual([DASH]);
    for (const c of [null, {}, { navegador: { escritura: [DASH] } }, { navegador: { activo: "si", escritura: [DASH] } }, { navegador: { activo: true, escritura: DASH } }]) expect(dominiosEscritura(c)).toEqual([]);
  });
});

describe("Solicitud nueva: autorizar escribir en esta tarea", () => {
  // La lista de solicitudes del agente llega vacía, así que el formulario de solicitud nueva está abierto.
  beforeEach(() => { invoke.mockReset(); invoke.mockImplementation(async (_n: string, o: { body?: Record<string, unknown> }) => {
    const accion = o?.body?.action;
    const data = accion === "listar" ? { tareas: [] }
      : accion === "hilo" ? { hilo: { id: T, titulo: "Cargar oficios aprobados", agent_id: "a1", agente: "Vizumi" }, revisiones: [], en_curso: false, mensajes: [] }
      : accion === "detalle" ? { tarea: { estado: "completed" }, eventos: [], actividad: [] } : { task_id: T };
    return { data, error: null };
  }); });
  const pantalla = (config: Record<string, unknown>) => envolver(<TrabajosAgente agentId="a1" nombre="Vizumi" ahora={new Date()} agente={agente(config)} />);
  const llenar = () => {
    fireEvent.change(screen.getByTestId("trabajos-titulo"), { target: { value: "Cargar oficios aprobados" } });
    fireEvent.change(screen.getByTestId("trabajos-texto"), { target: { value: "Sube al dashboard los nombres que aprobé." } });
  };
  const enviado = () => invoke.mock.calls.find((c) => c[0] === "dispatch-to-agent")?.[1].body;

  it("sin navegador habilitado no aparece la casilla", () => {
    pantalla({});
    llenar();
    expect(screen.queryByTestId("autorizar-escritura")).toBeNull();
  });
  it("la casilla empieza SIN marcar y, sin marcarla, la tarea no lleva autorización", async () => {
    pantalla({ navegador: { activo: true, escritura: [DASH] } });
    llenar();
    expect((screen.getByTestId(`autorizar-escritura-${DASH}`) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId("trabajos-enviar"));
    await waitFor(() => expect(enviado()).toBeTruthy());
    expect(enviado().input_context).toBeUndefined();
  });
  it("marcada, la autorización viaja en input_context solo para esa tarea y se limpia al enviar", async () => {
    pantalla({ navegador: { activo: true, escritura: [DASH] } });
    llenar();
    fireEvent.click(screen.getByTestId(`autorizar-escritura-${DASH}`));
    fireEvent.click(screen.getByTestId("trabajos-enviar"));
    await waitFor(() => expect(enviado()).toBeTruthy());
    expect(enviado().input_context).toEqual({ escrituras_aprobadas: [DASH] });
    await waitFor(() => expect((screen.getByTestId(`autorizar-escritura-${DASH}`) as HTMLInputElement).checked).toBe(false));
  });
});

describe("Seguimiento: aprobar lo que el agente mostró y autorizar que suba", () => {
  beforeEach(() => invoke.mockReset());
  const hilo = (extra: Record<string, unknown>) => ({
    hilo: { id: T, titulo: "Oficios SITI", agent_id: "a1", agente: "Vizumi" }, revisiones: [], en_curso: false,
    mensajes: [{ task_id: T, rol: "agente", texto: "Resumen: 2 altas propuestas.", cuando: "2026-11-13T10:00:00Z", estado: "completed", entregables: [] }], ...extra,
  });
  const servir = (h: unknown) => invoke.mockImplementation(async (...args: unknown[]) => {
    const body = ((args[1] as { body?: Record<string, unknown> } | undefined)?.body ?? {}) as Record<string, unknown>;
    return { data: body.action === "hilo" ? h : body.action === "detalle" ? { tarea: { estado: "completed" }, eventos: [], actividad: [] } : { task_id: "t2" }, error: null };
  });

  it("con sitios habilitados ofrece la casilla; al marcarla y enviar la seguimiento lleva la autorización y el hilo", async () => {
    servir(hilo({ escritura_dominios: [DASH] }));
    envolver(<HiloAgente taskId={T} ahora={new Date("2026-11-13T12:00:00Z")} />);
    fireEvent.change(await screen.findByTestId("hilo-texto"), { target: { value: "Apruebo estos dos nombres. Súbelos." } });
    fireEvent.click(screen.getByTestId(`autorizar-escritura-${DASH}`));
    fireEvent.click(screen.getByTestId("hilo-enviar"));
    await waitFor(() => expect(invoke.mock.calls.some((c) => c[0] === "dispatch-to-agent")).toBe(true));
    expect(invoke.mock.calls.find((c) => c[0] === "dispatch-to-agent")![1].body.input_context).toEqual({ escrituras_aprobadas: [DASH], hilo_id: T });
  });
  it("sin marcarla, el seguimiento no autoriza nada", async () => {
    servir(hilo({ escritura_dominios: [DASH] }));
    envolver(<HiloAgente taskId={T} ahora={new Date("2026-11-13T12:00:00Z")} />);
    fireEvent.change(await screen.findByTestId("hilo-texto"), { target: { value: "Agrega una columna de fechas." } });
    fireEvent.click(screen.getByTestId("hilo-enviar"));
    await waitFor(() => expect(invoke.mock.calls.some((c) => c[0] === "dispatch-to-agent")).toBe(true));
    expect(invoke.mock.calls.find((c) => c[0] === "dispatch-to-agent")![1].body.input_context).toEqual({ hilo_id: T });
  });
  it("sin sitios habilitados no hay casilla", async () => {
    servir(hilo({}));
    envolver(<HiloAgente taskId={T} ahora={new Date("2026-11-13T12:00:00Z")} />);
    await screen.findByTestId("hilo-texto");
    expect(screen.queryByTestId("autorizar-escritura")).toBeNull();
  });
});
