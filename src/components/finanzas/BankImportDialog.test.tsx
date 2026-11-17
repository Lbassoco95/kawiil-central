import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BankImportDialog } from "./BankImportDialog";

vi.mock("@/hooks/useFinanceBank", () => ({
  useFinanceAccounts: () => ({ data: [{ id: "acc-1", name: "Fondeadora", is_active: true, kind: "banco", parent_account_id: null }] }),
  useFinanceCategories: () => ({ categories: [] }),
  useRuleIndex: () => new Map(),
  useCreateAccount: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useImportMovements: () => ({ mutateAsync: vi.fn() }),
  useImportCommitments: () => ({ mutateAsync: vi.fn() }),
  useFinanceBanks: () => ({ data: [] }),
  useImportBanks: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const lista = [
  "Hoy",
  "movement img",
  "Compra en GAMMA.APP",
  "17/11/26・12:54 pm",
  "-$472.50",
  "Plataformas",
  "**9215",
  "・",
  "L",
  "movement img",
  "Depósito de MARIO ALBERTO LOPEZ",
  "17/11/26・12:00 pm",
  "+$1,000.00",
].join("\n");

describe("pegar movimientos de la app", () => {
  it("habilita la carga cuando el pegado es la lista de Fondeadora", () => {
    render(<BankImportDialog open onOpenChange={() => {}} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Pegar movimientos/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: lista } });
    expect(screen.getByText(/Leí 2 movimientos/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cargar movimientos pegados/ })).toBeEnabled();
  });

  it("explica por qué no deja cargar un pegado que no parece movimientos", () => {
    render(<BankImportDialog open onOpenChange={() => {}} />);
    fireEvent.mouseDown(screen.getByRole("tab", { name: /Pegar movimientos/ }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "hola\nesto no es un movimiento" } });
    expect(screen.getByText(/No reconocí movimientos/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cargar movimientos pegados/ })).toBeDisabled();
  });
});
