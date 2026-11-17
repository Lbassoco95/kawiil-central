import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AvisosEquipo } from "@/components/AvisosEquipo";
import { ComunicacionInterna } from "@/components/agentes/ComunicacionInterna";
import { figurasDeSala, personajes } from "@/components/marketing/oficinaAgentesLogica";
import { distribuirSala } from "@/lib/agentes/salas";
import { hoyEnMexico } from "../../supabase/functions/_shared/avisos";
import type { AgenteRegistro } from "@/lib/agentes/registro";

const invoke = vi.fn();
let filas: unknown[] | Error = [];
const consulta = { select: () => consulta, eq: () => consulta, gte: () => consulta, order: () => consulta, limit: () => Promise.resolve(filas instanceof Error ? { data: null, error: filas } : { data: filas, error: null }) };
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) }, from: () => consulta } }));

const HOY = hoyEnMexico();
const dia = (n: number) => new Date(Date.parse(HOY + "T12:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const A1 = { id: "a1", tipo: "dia_inhabil", titulo: "Hoy no se trabaja", mensaje: "Retomamos mañana.", desde: HOY, hasta: HOY };
const A2 = { id: "a2", tipo: "general", titulo: "Aviso futuro", mensaje: "Más adelante.", desde: dia(3), hasta: dia(4) };
const montar = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{ui}</QueryClientProvider>);

describe("<AvisosEquipo />", () => {
  beforeEach(() => { sessionStorage.clear(); filas = [A1, A2]; });
  afterEach(cleanup);
  it("muestra solo los avisos vigentes hoy, con su título y mensaje", async () => {
    montar(<AvisosEquipo />);
    await waitFor(() => expect(screen.getByTestId("aviso-a1")).toBeTruthy());
    expect(screen.getByTestId("aviso-a1").textContent).toMatch(/Hoy no se trabaja.*Retomamos mañana/);
    expect(screen.getByTestId("aviso-a1").getAttribute("data-tipo")).toBe("dia_inhabil");
    expect(screen.queryByTestId("aviso-a2")).toBeNull();
  });
  it("tiene colores propios para modo oscuro (un fondo claro con texto claro no se leía)", async () => {
    montar(<AvisosEquipo />);
    await waitFor(() => screen.getByTestId("aviso-a1"));
    const clase = screen.getByTestId("aviso-a1").className;
    expect(clase).toMatch(/dark:bg-amber-950/); expect(clase).toMatch(/dark:text-amber-50/); expect(clase).toMatch(/dark:border-amber-400/);
    cleanup(); filas = [A2, { ...A1, id: "a3", tipo: "general" }];
    montar(<AvisosEquipo />);
    await waitFor(() => screen.getByTestId("aviso-a3"));
    expect(screen.getByTestId("aviso-a3").className).toMatch(/dark:bg-sky-950/);
  });
  it("se puede cerrar y no vuelve a salir en la sesión", async () => {
    const { unmount } = montar(<AvisosEquipo />);
    await waitFor(() => screen.getByTestId("aviso-a1"));
    fireEvent.click(screen.getByTestId("aviso-cerrar-a1"));
    expect(screen.queryByTestId("avisos-equipo")).toBeNull();
    unmount(); montar(<AvisosEquipo />);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("aviso-a1")).toBeNull();
  });
  it("sin avisos, o si falla la lectura, no dibuja nada ni rompe", async () => {
    filas = []; const a = montar(<AvisosEquipo />); await new Promise((r) => setTimeout(r, 50)); expect(a.container.innerHTML).toBe(""); a.unmount();
    filas = new Error("no existe la tabla"); const b = montar(<AvisosEquipo />); await new Promise((r) => setTimeout(r, 50)); expect(b.container.innerHTML).toBe("");
  });
});

const ADMIN = { id: "x1", tipo: "dia_inhabil", titulo: "Día sin trabajo", mensaje: "No se trabaja.", desde: HOY, hasta: HOY, estado: "publicado", redactado_por: "agente", aprobado_at: HOY, cancelado_at: null, created_at: HOY };
const BORRADOR = { tipo: "dia_inhabil", titulo: "Hoy no se trabaja", mensaje: "Hoy no se trabaja. Retomamos mañana.", desde: HOY, hasta: HOY };

describe("<ComunicacionInterna />", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (_f: string, { body }: { body: Record<string, unknown> }) => {
      if (body.action === "listar") return { data: { avisos: [ADMIN, { ...ADMIN, id: "x2", estado: "cancelado", titulo: "Viejo" }] }, error: null };
      if (body.action === "redactar") return { data: { borrador: BORRADOR }, error: null };
      if (body.action === "publicar") return { data: { aviso: { ...ADMIN, id: "x3" } }, error: null };
      return { data: { ok: true }, error: null };
    });
  });
  afterEach(cleanup);
  it("el agente redacta un borrador que llena el formulario; nada se publica hasta aprobar", async () => {
    montar(<ComunicacionInterna />);
    const redactar = screen.getByTestId("comunicacion-redactar") as HTMLButtonElement; expect(redactar.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("comunicacion-instruccion"), { target: { value: "El lunes 16 no se trabajará" } });
    fireEvent.click(redactar);
    await waitFor(() => expect((screen.getByTestId("comunicacion-titulo") as HTMLInputElement).value).toBe("Hoy no se trabaja"));
    expect(screen.getByTestId("comunicacion-origen").textContent).toMatch(/Borrador del agente/);
    expect(screen.getByTestId("comunicacion-vista-previa").textContent).toMatch(/Se verá en pantalla a todo el equipo/);
    expect(invoke.mock.calls.some(([, { body }]) => body.action === "publicar")).toBe(false);
    expect(invoke).toHaveBeenCalledWith("comunicacion-interna", { body: { action: "redactar", instruccion: "El lunes 16 no se trabajará" } });
  });
  it("aprobar y publicar manda el aviso validado con quién lo redactó, y avisa; el formulario se limpia", async () => {
    montar(<ComunicacionInterna />);
    fireEvent.change(screen.getByTestId("comunicacion-instruccion"), { target: { value: "El lunes 16 no se trabajará" } });
    fireEvent.click(screen.getByTestId("comunicacion-redactar"));
    await waitFor(() => screen.getByTestId("comunicacion-origen"));
    fireEvent.change(screen.getByTestId("comunicacion-titulo"), { target: { value: "  Hoy   no se trabaja " } });
    fireEvent.click(screen.getByTestId("comunicacion-publicar"));
    await waitFor(() => expect(screen.getByTestId("comunicacion-publicado")).toBeTruthy());
    const llamada = invoke.mock.calls.find(([, { body }]) => body.action === "publicar")![1].body;
    expect(llamada).toMatchObject({ action: "publicar", redactado_por: "agente", aviso: { tipo: "dia_inhabil", titulo: "Hoy no se trabaja", desde: HOY, hasta: HOY } });
    expect((screen.getByTestId("comunicacion-titulo") as HTMLInputElement).value).toBe("");
  });
  it("sin datos válidos no deja publicar y dice qué falta; escribirlo a mano publica como Dirección", async () => {
    montar(<ComunicacionInterna />);
    const publicar = screen.getByTestId("comunicacion-publicar") as HTMLButtonElement; expect(publicar.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("comunicacion-titulo"), { target: { value: "ab" } });
    expect(screen.getByTestId("comunicacion-pendientes").textContent).toMatch(/título de al menos 3/);
    fireEvent.change(screen.getByTestId("comunicacion-titulo"), { target: { value: "Cierre de oficina" } });
    fireEvent.change(screen.getByTestId("comunicacion-mensaje"), { target: { value: "La oficina cierra a las 3." } });
    fireEvent.change(screen.getByTestId("comunicacion-tipo"), { target: { value: "general" } });
    fireEvent.change(screen.getByTestId("comunicacion-desde"), { target: { value: dia(1) } });
    fireEvent.change(screen.getByTestId("comunicacion-hasta"), { target: { value: dia(1) } });
    expect(publicar.disabled).toBe(false);
    fireEvent.click(publicar);
    await waitFor(() => expect(screen.getByTestId("comunicacion-publicado")).toBeTruthy());
    expect(invoke.mock.calls.find(([, { body }]) => body.action === "publicar")![1].body.redactado_por).toBe("direccion");
  });
  it("un aviso con fecha pasada no se puede publicar", () => {
    montar(<ComunicacionInterna />);
    fireEvent.change(screen.getByTestId("comunicacion-titulo"), { target: { value: "Aviso viejo" } });
    fireEvent.change(screen.getByTestId("comunicacion-mensaje"), { target: { value: "Ya pasó." } });
    fireEvent.change(screen.getByTestId("comunicacion-desde"), { target: { value: dia(-5) } });
    fireEvent.change(screen.getByTestId("comunicacion-hasta"), { target: { value: dia(-4) } });
    expect((screen.getByTestId("comunicacion-publicar") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("comunicacion-pendientes").textContent).toMatch(/ya terminó/);
  });
  it("lista los avisos con su estado y permite cancelar solo los vigentes o futuros", async () => {
    montar(<ComunicacionInterna />);
    await waitFor(() => expect(screen.getByTestId("aviso-fila-x1")).toBeTruthy());
    expect(screen.getByTestId("aviso-fila-x1").textContent).toMatch(/Se ve hoy.*redactado por el agente/);
    expect(screen.getByTestId("aviso-fila-x2").textContent).toMatch(/Cancelado/);
    expect(screen.queryByTestId("aviso-cancelar-x2")).toBeNull();
    fireEvent.click(screen.getByTestId("aviso-cancelar-x1"));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("comunicacion-interna", { body: { action: "cancelar", id: "x1" } }));
  });
  it("si falla redactar o publicar, lo dice sin perder lo escrito", async () => {
    montar(<ComunicacionInterna />);
    invoke.mockImplementation(async (_f: string, { body }: { body: Record<string, unknown> }) => (body.action === "listar" ? { data: { avisos: [] }, error: null } : { data: null, error: new Error("x") }));
    fireEvent.change(screen.getByTestId("comunicacion-instruccion"), { target: { value: "El lunes 16 no se trabajará" } });
    fireEvent.click(screen.getByTestId("comunicacion-redactar"));
    await waitFor(() => expect(screen.getByTestId("comunicacion-error-redactar")).toBeTruthy());
    expect((screen.getByTestId("comunicacion-instruccion") as HTMLTextAreaElement).value).toBe("El lunes 16 no se trabajará");
  });
});

describe("Marketing: el agente de Comunicación interna en su oficina", () => {
  const ag = (name: string, o: Partial<AgenteRegistro> = {}): AgenteRegistro => ({ id: name, name, display_name: null, description: null, role: null, status: "idle", kind: "system", last_heartbeat: null, last_task_at: null, tasks_completed: 0, tasks_failed: 0, ...o });
  it("aparece en la oficina después del Investigador, en la zona «Análisis y comunicación» de la sala", () => {
    const p = personajes([ag("marketing_comunicacion_interna"), ag("marketing_investigador"), ag("marketing_analista")], [], new Date());
    expect(p.map((x) => x.aspecto.corto)).toEqual(["Analista", "Investigador", "Comunicación"]);
    const sala = distribuirSala("marketing", figurasDeSala(p), (f) => f.clave);
    expect(sala.zonas.find((z) => z.nombre === "Análisis y comunicación")?.claves).toContain("marketing_comunicacion_interna");
  });
});
