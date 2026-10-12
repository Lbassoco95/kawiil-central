import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MatiConnectionCard } from "./MatiConnectionCard";

const status = vi.fn();
const list = vi.fn();

vi.mock("@/hooks/useMatiGateway", () => ({
  useMatiStatus: () => status(),
  useMatiList: (...args: unknown[]) => list(...args),
}));

const base = { isLoading: false, isError: false, isFetching: false, refetch: vi.fn(), error: null };

describe("MatiConnectionCard", () => {
  beforeEach(() => {
    status.mockReset();
    list.mockReset();
    list.mockReturnValue({ ...base, data: undefined });
  });

  it("avisa qué secretos faltan cuando no está configurada y no ofrece consultas", () => {
    status.mockReturnValue({
      ...base,
      data: { configured: false, problems: ["MATI_GATEWAY_URL", "MATI_GATEWAY_TOKEN (≥ 32 caracteres)"] },
    });
    render(<MatiConnectionCard />);
    expect(screen.getByText("Conexión no configurada")).toBeTruthy();
    expect(screen.getByText(/MATI_GATEWAY_URL/)).toBeTruthy();
    expect(screen.queryByText("Usuarios")).toBeNull();
    // Sin configuración no se dispara ninguna consulta de datos.
    expect(list).toHaveBeenCalledWith("users", false);
  });

  it("muestra los datos que devuelve el gateway (correo ya enmascarado) y marca Sí/No", () => {
    status.mockReturnValue({ ...base, data: { configured: true, data: { version: "1.2" } } });
    list.mockReturnValue({
      ...base,
      data: { configured: true, data: [{ id: "1", nombre_completo: "Ana", email: "a***@dazon.mx", area: "comercial", nivel: "admin", activo: true }] },
    });
    render(<MatiConnectionCard />);
    fireEvent.click(screen.getByText("Usuarios"));
    expect(screen.getByText("a***@dazon.mx")).toBeTruthy();
    expect(screen.getByText("Sí")).toBeTruthy();
    expect(screen.getByText(/versión 1.2/)).toBeTruthy();
  });

  it("muestra el error del servidor sin romperse", () => {
    status.mockReturnValue({ ...base, isError: true, error: new Error("No tienes permiso para esta acción") });
    render(<MatiConnectionCard />);
    expect(screen.getByText(/No tienes permiso/)).toBeTruthy();
  });
});
