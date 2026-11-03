import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

let filas: Array<{ module_key: string; enabled: boolean }> = [];
let fallar = false;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: async () => (fallar ? { data: null, error: { message: "boom" } } : { data: filas, error: null }),
      }),
    }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "771a10f8-cf4a-480e-9d7c-fd34373ff3ed" } }),
}));

import { useModulePermissions } from "@/hooks/useModulePermissions";

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe("acceso a Marketing (falla cerrado)", () => {
  beforeEach(() => { filas = []; fallar = false; });

  it("usuario con marketing y marketing_decidir habilitados ve el módulo", async () => {
    filas = [
      { module_key: "marketing", enabled: true },
      { module_key: "marketing_decidir", enabled: true },
      { module_key: "rh", enabled: true },
    ];
    const { result } = renderHook(() => useModulePermissions(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasModuleStrict("marketing")).toBe(true);
    expect(result.current.hasModuleStrict("marketing_decidir")).toBe(true);
  });

  it("usuario sin la fila no ve nada", async () => {
    filas = [{ module_key: "rh", enabled: true }];
    const { result } = renderHook(() => useModulePermissions(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasModuleStrict("marketing")).toBe(false);
  });

  it("usuario con la fila deshabilitada no ve nada", async () => {
    filas = [{ module_key: "marketing", enabled: false }];
    const { result } = renderHook(() => useModulePermissions(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.hasModuleStrict("marketing")).toBe(false);
  });

  it("si la consulta falla de verdad, no se muestra", { timeout: 15000 }, async () => {
    fallar = true;
    filas = [{ module_key: "marketing", enabled: true }];
    const { result } = renderHook(() => useModulePermissions(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 8000 });
    expect(result.current.hasModuleStrict("marketing")).toBe(false);
  });
});
