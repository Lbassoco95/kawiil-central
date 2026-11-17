import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ListaLpb } from "@/components/agentes/ListaLpb";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

const U1 = "11111111-1111-4111-8111-111111111111";
const P = { id: U1, nombre: "ANA PÉREZ", rfc: "PEAA8001019X0", rfc_dudoso: true, tipo_persona: "fisica", estado: "vigente", fecha_alta: "2026-03-06", fecha_baja: null, datos_incompletos: false,
  origen: "importado_marzo_2026", revisado: false, por_corregir: false, revision_nota: null, notas: null, revisado_en: null,
  revision_agente: "no_coincide", revision_agente_nota: "El oficio dice RFC PEAA800101AB1.", revision_agente_en: "2026-11-17T04:00:00Z" };
const RES = { total: 923, vigentes: 923, eliminadas: 0, por_revisar: 923, por_corregir: 0, dudosos: 34, incompletos: 740, revisadas: 0, agente_coincide: 5, agente_discrepa: 1, agente_no_verificable: 2 };

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ListaLpb /></QueryClientProvider>);
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((_n: string, { body }: { body: Record<string, unknown> }) => {
    if (body.action === "resumen") return Promise.resolve({ data: RES, error: null });
    if (body.action === "listar") return Promise.resolve({ data: { personas: [P], total: 1, pagina: 0, limite: 50 }, error: null });
    if (body.action === "persona") return Promise.resolve({ data: { persona: P, movimientos: [{ id: "m1", tipo: "confirmacion", oficio: "110/K/127/2026", fecha_oficio: "2026-01-09", acuerdo: null, fundamento: null, archivo: "110_K_127_2026_V.pdf", fuente: "importado_marzo_2026" }] }, error: null });
    if (body.action === "revisar") return Promise.resolve({ data: { actualizadas: 1 }, error: null });
    return Promise.resolve({ data: null, error: { message: "x" } });
  });
});

describe("Lista LPB", () => {
  it("muestra las cifras y la persona «por revisar» con su RFC dudoso", async () => {
    montar();
    expect(await screen.findByText("ANA PÉREZ")).toBeTruthy();
    expect((await screen.findAllByText("923")).length).toBeGreaterThan(0);
    expect(screen.getByText("dudoso")).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith("agente-lpb", { body: expect.objectContaining({ action: "listar", filtro: "por_revisar" }) });
  });
  it("el detalle enseña el oficio y el archivo de Dropbox para compararlo con el PDF", async () => {
    montar();
    fireEvent.click(await screen.findByLabelText("Ver detalle"));
    expect(await screen.findByText("110_K_127_2026_V.pdf")).toBeTruthy();
    expect(screen.getByText(/dígito verificador/)).toBeTruthy();
  });
  it("seleccionar abre la revisión: devolver exige nota y aprobar manda solo los ids elegidos", async () => {
    montar();
    fireEvent.click(await screen.findByLabelText("Seleccionar ANA PÉREZ"));
    const devolver = screen.getByRole("button", { name: /Devolver para corregir/ }) as HTMLButtonElement;
    expect(devolver.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Dar visto bueno/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("agente-lpb", { body: { action: "revisar", ids: [U1], decision: "aprobar", nota: "" } }));
    expect(await screen.findByText(/1 persona\(s\) aprobadas/)).toBeTruthy();
  });
  it("muestra el dictamen del agente como opinión, y avisa antes de aprobar algo que discrepa", async () => {
    montar();
    expect(await screen.findByText("Discrepa")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Ver detalle"));
    expect(await screen.findByText(/El oficio dice RFC PEAA800101AB1\./)).toBeTruthy();
    expect(screen.getByText(/es una opinión; el visto bueno es tuyo/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Seleccionar ANA PÉREZ"));
    expect((await screen.findByRole("alert")).textContent).toContain("discrepancia señalada por el agente supervisor");
  });
  it("un filtro distinto vuelve a consultar con ese filtro", async () => {
    montar();
    fireEvent.click(await screen.findByRole("button", { name: "RFC dudoso" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("agente-lpb", { body: expect.objectContaining({ action: "listar", filtro: "dudosos" }) }));
  });
});
