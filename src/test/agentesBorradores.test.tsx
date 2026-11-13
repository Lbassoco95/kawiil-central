import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { borradorDeFila, guardable, tituloBorrador } from "@/lib/agentes/borradores";
import { ConstructorAgentes } from "@/components/agentes/ConstructorAgentes";

// Tabla simulada: lo que se guarda se puede volver a leer, como en la base.
const filas: Record<string, any>[] = [];
const llamadas: string[] = [];
const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: (t: string) => {
      expect(t).toBe("agent_creation_drafts");
      return {
        select: () => ({ order: () => ({ limit: async () => ({ data: [...filas].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))), error: null }) }) }),
        upsert: async (f: Record<string, any>) => { llamadas.push("upsert"); const i = filas.findIndex((x) => x.id === f.id); const fila = { ...f, updated_at: new Date().toISOString() }; if (i >= 0) filas[i] = fila; else filas.push(fila); return { error: null }; },
        delete: () => ({ eq: async (_c: string, id: string) => { llamadas.push("delete"); const i = filas.findIndex((x) => x.id === id); if (i >= 0) filas.splice(i, 1); return { error: null }; } }),
      };
    },
  },
}));

const PROPUESTA = { nombre_visible: "Vizumi", rol: "Oficial de cumplimiento", cliente: "Vizum", descripcion: "Vigila documentos de Vizum.", mision: "Revisar el padrón y reportar.", capacidades: ["Revisar documentos"], entregables: ["Informe semanal"],
  informes: "", fuentes: [], cadencia: "bajo_demanda", dominios_permitidos: [], paginas: [], credenciales: [], limites: ["No presenta nada ante autoridades"] };
const envolver = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><ConstructorAgentes /></QueryClientProvider>);
const escribir = (t: string) => { fireEvent.change(screen.getByPlaceholderText(/Describe el agente/), { target: { value: t } }); fireEvent.click(screen.getByTestId("constructor-enviar")); };

describe("reglas de los borradores", () => {
  it("título: el primer mensaje de la persona, en una línea y acotado", () => {
    expect(tituloBorrador([{ role: "user", content: "  Un oficial\n de cumplimiento " }])).toBe("Un oficial de cumplimiento");
    expect(tituloBorrador([{ role: "user", content: "x".repeat(200) }]).length).toBe(70);
    expect(tituloBorrador([])).toBe("Agente sin nombre");
  });
  it("solo se guarda si hay algo dicho y nada parece un secreto", () => {
    expect(guardable([])).toBe(false);
    expect(guardable([{ role: "assistant", content: "hola" }])).toBe(false);
    expect(guardable([{ role: "user", content: "Quiero un coordinador" }])).toBe(true);
    expect(guardable([{ role: "user", content: "mi llave es sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789" }])).toBe(false);
  });
  it("una fila dañada no rompe: se descarta o se limpia", () => {
    expect(borradorDeFila(null)).toBeNull(); expect(borradorDeFila({ id: "a", messages: "x" })).toBeNull(); expect(borradorDeFila({ messages: [{ role: "user", content: "hola" }] })).toBeNull();
    const b = borradorDeFila({ id: "a", titulo: "", messages: [{ role: "user", content: "hola" }, { role: "hacker", content: "x" }, 5], propuesta: { nombre_visible: "x" }, updated_at: "2026-11-10T10:00:00Z" })!;
    expect(b.mensajes).toEqual([{ role: "user", content: "hola" }]); expect(b.propuesta).toBeNull(); expect(b.titulo).toBe("hola");
    expect(borradorDeFila({ id: "a", messages: [{ role: "user", content: "hola" }], propuesta: PROPUESTA })!.propuesta?.nombre_visible).toBe("Vizumi");
  });
});

describe("chat de Crear agente con borradores", () => {
  beforeEach(() => { filas.length = 0; llamadas.length = 0; invoke.mockReset(); });

  it("se guarda solo cuando el asistente responde, y al volver se puede continuar con la conversación y la propuesta", async () => {
    invoke.mockResolvedValue({ data: { texto: "Listo, aquí está la propuesta.", propuesta: PROPUESTA, avisos: [] }, error: null });
    const a = envolver();
    escribir("Quiero un oficial de cumplimiento para Vizum");
    await screen.findByTestId("constructor-propuesta");
    await waitFor(() => expect(filas).toHaveLength(1));
    expect(filas[0].titulo).toBe("Quiero un oficial de cumplimiento para Vizum");
    expect(filas[0].messages).toHaveLength(2); expect(filas[0].propuesta.nombre_visible).toBe("Vizumi");
    expect(await screen.findByText("Borrador guardado")).toBeTruthy();
    a.unmount();                                              // «se quedó a la mitad»: sale de la pantalla

    envolver();                                               // vuelve (otro dispositivo o más tarde)
    const tarjeta = await screen.findByTestId("borradores");
    expect(tarjeta.textContent).toContain("Quiero un oficial de cumplimiento para Vizum"); expect(tarjeta.textContent).toContain("Con propuesta lista");
    fireEvent.click(screen.getByTestId(`continuar-${filas[0].id}`));
    expect(screen.getAllByTestId(/constructor-msg-/)).toHaveLength(2);
    expect(screen.getByTestId("constructor-propuesta").textContent).toContain("Vizumi");
    expect(screen.queryByTestId("borradores")).toBeNull();
  });

  it("al seguir la conversación se actualiza el mismo borrador, no se crean más", async () => {
    invoke.mockResolvedValue({ data: { texto: "¿Qué cadencia?", propuesta: null, avisos: [] }, error: null });
    envolver();
    escribir("Un coordinador");
    await waitFor(() => expect(filas).toHaveLength(1));
    escribir("Diario");
    await waitFor(() => expect(filas[0].messages).toHaveLength(4));
    expect(filas).toHaveLength(1);
  });

  it("crear el agente borra el borrador", async () => {
    invoke.mockImplementation(async (_n: string, { body }: { body: Record<string, unknown> }) =>
      body.action === "crear" ? { data: { agente: { id: "a1", name: "vizumi", display_name: "Vizumi", role: "r", status: "idle" } }, error: null }
        : { data: { texto: "Propuesta lista", propuesta: PROPUESTA, avisos: [] }, error: null });
    envolver();
    escribir("Un oficial para Vizum");
    await screen.findByTestId("constructor-propuesta"); await waitFor(() => expect(filas).toHaveLength(1));
    fireEvent.click(screen.getByTestId("constructor-crear"));
    await screen.findByTestId("constructor-creado");
    await waitFor(() => expect(filas).toHaveLength(0));
    expect(llamadas).toContain("delete");
  });

  it("un secreto nunca llega al modelo ni se guarda", async () => {
    envolver();
    escribir("la clave es sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789");
    await screen.findByTestId("constructor-error");
    await act(async () => { await new Promise((r) => setTimeout(r, 900)); });
    expect(invoke).not.toHaveBeenCalled(); expect(filas).toHaveLength(0);
  });

  it("Descartar borrador lo elimina y limpia la pantalla; Empezar otro lo deja guardado", async () => {
    invoke.mockResolvedValue({ data: { texto: "¿Qué más?", propuesta: null, avisos: [] }, error: null });
    envolver();
    escribir("Primer agente");
    await waitFor(() => expect(filas).toHaveLength(1));
    await screen.findByText("Borrador guardado");
    fireEvent.click(screen.getByTestId("constructor-otro"));
    expect(screen.queryAllByTestId(/constructor-msg-/)).toHaveLength(0);
    expect(filas).toHaveLength(1);                                          // el anterior sigue guardado
    expect(await screen.findByTestId("borradores")).toBeTruthy();
    fireEvent.click(screen.getByTestId(`eliminar-${filas[0].id}`));
    await waitFor(() => expect(filas).toHaveLength(0));
  });
});
