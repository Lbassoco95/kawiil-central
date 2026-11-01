import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const filas = [
  { module_key: "marketing", enabled: true },
  { module_key: "marketing_decidir", enabled: true },
];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: filas, error: null }) }) }) },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }));

import { MarketingGate } from "@/components/marketing/MarketingGate";

describe("MarketingGate", () => {
  it("deja pasar a quien tiene el permiso", async () => {
    const qc = new QueryClient();
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
    await waitFor(() => expect(screen.queryByText("contenido-marketing") ?? screen.queryByText("inicio")).toBeTruthy(), { timeout: 5000 });
    expect(screen.queryByText("contenido-marketing")).toBeTruthy();
  });
});
