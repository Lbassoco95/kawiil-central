import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConstructorAgentes } from "@/components/agentes/ConstructorAgentes";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));

// El chat de «Crear agente» debe pintar la respuesta del asistente con formato (negritas, listas), no con los asteriscos crudos;
// lo que escribe la persona se queda como texto.
describe("chat de Crear agente", () => {
  beforeEach(() => invoke.mockReset());
  it("la respuesta del asistente se ve con formato y lo de la persona queda como texto", async () => {
    invoke.mockResolvedValue({ data: { texto: "Antes de armar la propuesta:\n\n1. **Accesos web** — ¿Qué portal?\n2. **Fuentes internas** — ¿Dónde viven?", propuesta: null, avisos: [] }, error: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><ConstructorAgentes /></QueryClientProvider>);
    fireEvent.change(screen.getByPlaceholderText(/Describe el agente/), { target: { value: "Quiero un agente **coordinador**" } });
    fireEvent.click(screen.getByTestId("constructor-enviar"));
    const resp = await waitFor(() => screen.getByTestId("constructor-msg-assistant"));
    expect(resp.textContent).not.toContain("**");
    expect(resp.querySelectorAll("strong").length).toBe(2);
    expect(resp.textContent).toContain("Accesos web");
    expect(screen.getByTestId("constructor-msg-user").textContent).toBe("Quiero un agente **coordinador**");
  });
  it("no ejecuta HTML que venga en la respuesta", async () => {
    invoke.mockResolvedValue({ data: { texto: "Hola <img src=x onerror=alert(1)> **ok**", propuesta: null, avisos: [] }, error: null });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><ConstructorAgentes /></QueryClientProvider>);
    fireEvent.change(screen.getByPlaceholderText(/Describe el agente/), { target: { value: "hola" } });
    fireEvent.click(screen.getByTestId("constructor-enviar"));
    const resp = await waitFor(() => screen.getByTestId("constructor-msg-assistant"));
    expect(resp.querySelector("img")).toBeNull();
  });
});
