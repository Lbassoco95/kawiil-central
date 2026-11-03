import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let respuesta: () => Promise<{ data: unknown; error: unknown }>;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => respuesta() }) }) },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "persona@kawiil.mx" }, loading: false }),
}));

import { MarketingGate } from "@/components/marketing/MarketingGate";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/marketing"]}>
        <Routes>
          <Route path="/" element={<div>inicio</div>} />
          <Route path="/marketing" element={<MarketingGate><div>contenido-marketing</div></MarketingGate>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MarketingGate: diagnóstico de acceso (sigue fallando cerrado)", () => {
  beforeEach(() => {
    respuesta = async () => ({ data: [], error: null });
  });

  it("causa 1: permisos cargando → muestra 'Verificando', sin contenido", async () => {
    respuesta = () => new Promise(() => {});
    montar();
    expect(await screen.findByTestId("marketing-acceso-cargando")).toBeTruthy();
    expect(screen.getByText(/Verificando tus permisos/)).toBeTruthy();
    expect(screen.queryByText("contenido-marketing")).toBeNull();
  });

  it("causa 2: error de consulta → muestra 'No pudimos leer', botón Reintentar, sin contenido", { timeout: 15000 }, async () => {
    respuesta = async () => ({ data: null, error: { message: "boom" } });
    montar();
    // el hook reintenta 2 veces con espera antes de declarar el error
    expect(await screen.findByTestId("marketing-acceso-error", {}, { timeout: 10000 })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reintentar/ })).toBeTruthy();
    expect(screen.queryByText("contenido-marketing")).toBeNull();
  });

  it("causa 3: sin permiso → muestra el correo de la sesión, sin contenido", async () => {
    respuesta = async () => ({ data: [{ module_key: "rh", enabled: true }], error: null });
    montar();
    expect(await screen.findByTestId("marketing-acceso-sin-permiso")).toBeTruthy();
    expect(screen.getByText("persona@kawiil.mx")).toBeTruthy();
    expect(screen.queryByText("contenido-marketing")).toBeNull();
    await waitFor(() => expect(screen.queryByText("inicio")).toBeNull());
  });

  it("permiso desactivado (enabled=false) cuenta como sin permiso", async () => {
    respuesta = async () => ({ data: [{ module_key: "marketing", enabled: false }], error: null });
    montar();
    expect(await screen.findByTestId("marketing-acceso-sin-permiso")).toBeTruthy();
  });
});
