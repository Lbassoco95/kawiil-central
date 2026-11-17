import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FiguraOficina } from "@/lib/agentes/oficina";
import { FigurasContext } from "@/components/agentes/BandaEquipo";
import { HiloAgente } from "@/components/agentes/HiloAgente";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

const fig = (id: string, nombre: string, estado: FiguraOficina["estado"]): FiguraOficina => ({
  id, nombre, rol: null, descripcion: null, estado, ultimoLatido: null, ultimaTareaAt: null, tareasBien: 0, tareasMal: 0,
}) as FiguraOficina;

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
