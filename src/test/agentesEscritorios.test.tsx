import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { figurasDeLaBanda, type FiguraOficina } from "@/lib/agentes/oficina";
import { BandaEquipo, FigurasContext } from "@/components/agentes/BandaEquipo";
import { HiloAgente } from "@/components/agentes/HiloAgente";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

const fig = (id: string, nombre: string, estado: FiguraOficina["estado"]): FiguraOficina => ({
  id, nombre, rol: null, descripcion: null, estado, ultimoLatido: null, ultimaTareaAt: null, tareasBien: 0, tareasMal: 0,
}) as FiguraOficina;

describe("quién se ve en la banda", () => {
  const F = [fig("a", "Amatl", "sentado"), fig("v", "Vizumi", "trabajando"), fig("t", "Tlahtolli", "sentado"), fig("x", "Xolotl", "con_error"), fig("l", "Legal DOF", "sentado")];
  it("primero quien trabaja o necesita atención, luego el equipo; los demás agentes en reposo no", () => {
    const r = figurasDeLaBanda(F, new Set(["a", "t"]));
    expect(r.map((f) => f.id)).toEqual(["v", "x", "a", "t"]);          // «l» no es del equipo y está en reposo
  });
  it("un agente de fuera del equipo aparece cuando trabaja", () => {
    expect(figurasDeLaBanda([fig("l", "Legal DOF", "trabajando")], new Set()).map((f) => f.id)).toEqual(["l"]);
  });
  it("máximo de escritorios", () => {
    const muchos = Array.from({ length: 20 }, (_, i) => fig(`id${i}`, `Agente ${String(i).padStart(2, "0")}`, "sentado"));
    expect(figurasDeLaBanda(muchos, new Set(muchos.map((f) => f.id)), 8)).toHaveLength(8);
  });
});

describe("banda del equipo", () => {
  it("dice con texto quién trabaja y dibuja a cada agente en su escritorio con su estado real", () => {
    render(<BandaEquipo figuras={[fig("v", "Vizumi", "trabajando"), fig("a", "Amatl", "sentado")]} />);
    expect(screen.getByTestId("banda-resumen").textContent).toContain("1 trabajando ahora: Vizumi");
    expect(screen.getByTestId("escritorio-v").getAttribute("data-estado")).toBe("trabajando");
    expect(screen.getByTestId("escritorio-v").querySelector(".of-trabajando")).toBeTruthy();       // el que trabaja teclea (animación de la Oficina)
    expect(screen.getByTestId("escritorio-a").getAttribute("aria-label")).toContain("Amatl");
  });
  it("sin nadie trabajando lo dice; sin agentes no pinta nada", () => {
    const { rerender } = render(<BandaEquipo figuras={[fig("a", "Amatl", "sentado")]} />);
    expect(screen.getByTestId("banda-resumen").textContent).toContain("ninguno trabajando ahora");
    rerender(<BandaEquipo figuras={[]} />);
    expect(screen.queryByTestId("banda-equipo")).toBeNull();
  });
  it("un clic en un escritorio avisa cuál", () => {
    const onElegir = vi.fn();
    render(<BandaEquipo figuras={[fig("v", "Vizumi", "trabajando")]} onElegir={onElegir} />);
    fireEvent.click(screen.getByTestId("escritorio-boton-v"));
    expect(onElegir).toHaveBeenCalledWith("v");
  });
});

describe("el agente en su escritorio dentro de la conversación", () => {
  beforeEach(() => invoke.mockReset());
  const hilo = (enCurso: boolean) => ({
    hilo: { id: "0b47849a-312c-4ad0-81ce-d173d61f9348", titulo: "Revisar Vizum", agent_id: "v", agente: "Vizumi" }, revisiones: [], en_curso: enCurso,
    mensajes: [{ task_id: "0b47849a-312c-4ad0-81ce-d173d61f9348", rol: "persona", texto: "Revisa todo", cuando: "2026-11-11T21:00:00Z", estado: "in_progress", entregables: [] }],
  });
  const servir = (h: unknown) => invoke.mockImplementation(async (...args: unknown[]) => {
    const body = ((args[1] as { body?: Record<string, unknown> } | undefined)?.body ?? {}) as Record<string, unknown>;
    return { data: body.action === "hilo" ? h : { tarea: { estado: "in_progress" }, eventos: [], actividad: [] }, error: null };
  });
  const ver = (figuras: FiguraOficina[]) => render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FigurasContext.Provider value={figuras}><HiloAgente taskId="0b47849a-312c-4ad0-81ce-d173d61f9348" ahora={new Date("2026-11-11T21:05:00Z")} /></FigurasContext.Provider>
    </QueryClientProvider>);

  it("mientras trabaja se ve en su escritorio, trabajando", async () => {
    servir(hilo(true));
    ver([fig("v", "Vizumi", "trabajando")]);
    expect((await screen.findByTestId("hilo-estado-agente")).textContent).toContain("trabajando en esto ahora");
    expect(screen.getByTestId("escritorio-v").getAttribute("data-estado")).toBe("trabajando");
  });
  it("si la tarea espera turno no finge que ya trabaja", async () => {
    servir(hilo(true));
    ver([fig("v", "Vizumi", "sentado")]);
    expect((await screen.findByTestId("hilo-estado-agente")).textContent).toContain("Esperando su turno");
  });
  it("sin la figura (otra pantalla) la conversación se ve igual que antes", async () => {
    servir(hilo(false));
    ver([]);
    expect(await screen.findByText(/Revisar Vizum/)).toBeTruthy();
    expect(screen.queryByTestId("hilo-estado-agente")).toBeNull();
  });
});
