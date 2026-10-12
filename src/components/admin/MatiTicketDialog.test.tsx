import { createContext, useContext, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MatiTicketDialog } from "./MatiTicketDialog";

const updateMutate = vi.fn();
const messageMutate = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("sonner", () => ({ toast: { success: (m: string) => toastSuccess(m), error: (m: string) => toastError(m) } }));

vi.mock("@/hooks/useMatiGateway", () => ({
  ESTADOS_TICKET: ["abierto", "en_progreso", "resuelto", "cerrado"],
  PRIORIDADES_TICKET: ["baja", "media", "alta", "urgente"],
  useMatiTicketUpdate: () => ({ mutateAsync: updateMutate, isPending: false }),
  useMatiTicketMessage: () => ({ mutateAsync: messageMutate, isPending: false }),
}));

// Radix Select no es manejable con fireEvent en jsdom: se sustituye por botones simples.
vi.mock("@/components/ui/select", () => {
  const Ctx = createContext<(v: string) => void>(() => {});
  return {
    Select: ({ onValueChange, children }: { onValueChange: (v: string) => void; children: ReactNode }) => (
      <Ctx.Provider value={onValueChange}>{children}</Ctx.Provider>
    ),
    SelectTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
      const set = useContext(Ctx);
      return (
        <button type="button" data-testid={`opt-${value}`} onClick={() => set(value)}>
          {children}
        </button>
      );
    },
  };
});

const ticket = { id: "3f2b8c1e-5d4a-4e7b-9a10-0c2d3e4f5a6b", asunto: "No puedo entrar", estado: "abierto", prioridad: "media" };

function setup() {
  const onClose = vi.fn();
  render(<MatiTicketDialog ticket={ticket} onClose={onClose} />);
  return { onClose };
}

describe("MatiTicketDialog", () => {
  beforeEach(() => {
    updateMutate.mockReset().mockResolvedValue({});
    messageMutate.mockReset().mockResolvedValue({});
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("no ofrece revisar nada hasta que haya un cambio o un mensaje", () => {
    setup();
    expect((screen.getByText("Revisar cambio") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Revisar mensaje") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "    " } });
    expect((screen.getByText("Revisar mensaje") as HTMLButtonElement).disabled).toBe(true);
  });

  it("cambiar el estado exige confirmar y muestra el antes y el después; solo entonces envía", async () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId("opt-resuelto"));
    fireEvent.click(screen.getByText("Revisar cambio"));

    const confirm = screen.getByTestId("mati-confirm");
    expect(confirm.textContent).toMatch(/Estado:\s*abierto\s*→\s*resuelto/);
    expect(confirm.textContent).toMatch(/en MATI/);
    expect(confirm.textContent).not.toMatch(/Prioridad/);
    expect(updateMutate).not.toHaveBeenCalled(); // revisar no envía nada

    fireEvent.click(screen.getByText("Confirmar y enviar a MATI"));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledTimes(1));
    expect(updateMutate).toHaveBeenCalledWith({ id: ticket.id, estado: "resuelto", prioridad: undefined });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Ticket actualizado en MATI"));
    expect(onClose).toHaveBeenCalled();
  });

  it("estado y prioridad juntos se envían en una sola petición", async () => {
    setup();
    fireEvent.click(screen.getByTestId("opt-cerrado"));
    fireEvent.click(screen.getByTestId("opt-urgente"));
    fireEvent.click(screen.getByText("Revisar cambio"));
    expect(screen.getByTestId("mati-confirm").textContent).toMatch(/Prioridad:\s*media\s*→\s*urgente/);
    fireEvent.click(screen.getByText("Confirmar y enviar a MATI"));
    await waitFor(() => expect(updateMutate).toHaveBeenCalledWith({ id: ticket.id, estado: "cerrado", prioridad: "urgente" }));
  });

  it("responder muestra el texto exacto antes de enviarlo y lo envía recortado", async () => {
    setup();
    fireEvent.change(screen.getByLabelText("Mensaje"), { target: { value: "  Ya lo revisamos.  " } });
    fireEvent.click(screen.getByText("Revisar mensaje"));
    expect(screen.getByTestId("mati-confirm").textContent).toMatch(/Ya lo revisamos\./);
    expect(messageMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Confirmar y enviar a MATI"));
    await waitFor(() => expect(messageMutate).toHaveBeenCalledWith({ id: ticket.id, mensaje: "Ya lo revisamos." }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Mensaje enviado en MATI"));
  });

  it("«Volver» regresa al formulario sin enviar nada", () => {
    setup();
    fireEvent.click(screen.getByTestId("opt-resuelto"));
    fireEvent.click(screen.getByText("Revisar cambio"));
    fireEvent.click(screen.getByText("Volver"));
    expect(screen.queryByTestId("mati-confirm")).toBeNull();
    expect(screen.getByText("Revisar cambio")).toBeTruthy();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it("si el servidor rechaza el cambio muestra su mensaje y el diálogo sigue abierto", async () => {
    updateMutate.mockRejectedValue(new Error("Las escrituras hacia MATI están desactivadas"));
    const { onClose } = setup();
    fireEvent.click(screen.getByTestId("opt-resuelto"));
    fireEvent.click(screen.getByText("Revisar cambio"));
    fireEvent.click(screen.getByText("Confirmar y enviar a MATI"));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Las escrituras hacia MATI están desactivadas"));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("no pasa de 5000 caracteres", () => {
    setup();
    const area = screen.getByLabelText("Mensaje") as HTMLTextAreaElement;
    expect(area.maxLength).toBe(5000);
    fireEvent.change(area, { target: { value: "a".repeat(5000) } });
    expect(screen.getByText("5000/5000")).toBeTruthy();
    expect((screen.getByText("Revisar mensaje") as HTMLButtonElement).disabled).toBe(false);
  });
});
