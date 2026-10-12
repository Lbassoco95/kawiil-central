import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MatiConnectionCard } from "./MatiConnectionCard";

const status = vi.fn();
const list = vi.fn();

vi.mock("@/hooks/useMatiGateway", () => ({
  useMatiStatus: () => status(),
  useMatiList: (...args: unknown[]) => list(...args),
  ESTADOS_TICKET: ["abierto", "en_progreso", "resuelto", "cerrado"],
  PRIORIDADES_TICKET: ["baja", "media", "alta", "urgente"],
  useMatiTicketUpdate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMatiTicketMessage: () => ({ mutateAsync: vi.fn(), isPending: false }),
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

  describe("escrituras de tickets (Fase 3)", () => {
    const tickets = {
      ...base,
      data: { configured: true, data: [{ id: "3f2b8c1e-5d4a-4e7b-9a10-0c2d3e4f5a6b", asunto: "No entra", estado: "abierto", prioridad: "media", area: "comercial" }] },
    };

    it("sin escrituras activas es de solo lectura: ni botón «Gestionar» ni columna extra", () => {
      status.mockReturnValue({ ...base, data: { configured: true, writes_enabled: false, data: {} } });
      list.mockReturnValue(tickets);
      render(<MatiConnectionCard />);
      fireEvent.click(screen.getByText("Tickets"));
      expect(screen.getByText("Solo lectura")).toBeTruthy();
      expect(screen.queryByText("Gestionar")).toBeNull();
    });

    it("si el gateway no informa writes_enabled, se trata como apagado", () => {
      status.mockReturnValue({ ...base, data: { configured: true, data: {} } });
      list.mockReturnValue(tickets);
      render(<MatiConnectionCard />);
      fireEvent.click(screen.getByText("Tickets"));
      expect(screen.queryByText("Gestionar")).toBeNull();
    });

    it("con escrituras activas ofrece «Gestionar» solo en tickets y abre el diálogo de confirmación", () => {
      status.mockReturnValue({ ...base, data: { configured: true, writes_enabled: true, data: {} } });
      list.mockReturnValue(tickets);
      render(<MatiConnectionCard />);
      expect(screen.getByText("Lectura y tickets")).toBeTruthy();
      fireEvent.click(screen.getByText("Tickets"));
      fireEvent.click(screen.getByText("Gestionar"));
      expect(screen.getByText("Gestionar ticket de MATI")).toBeTruthy();
      expect(screen.getByText(/Los cambios en tickets piden confirmación/)).toBeTruthy();
    });

    it("en usuarios o módulos nunca hay botón de gestión, aunque las escrituras estén activas", () => {
      status.mockReturnValue({ ...base, data: { configured: true, writes_enabled: true, data: {} } });
      list.mockReturnValue({ ...base, data: { configured: true, data: [{ id: "1", nombre_completo: "Ana", email: "a***@x.mx", area: "comercial", nivel: "admin", activo: true }] } });
      render(<MatiConnectionCard />);
      fireEvent.click(screen.getByText("Usuarios"));
      expect(screen.queryByText("Gestionar")).toBeNull();
    });
  });
});
