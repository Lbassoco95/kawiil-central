import { describe, expect, it } from "vitest";
import type { Expense } from "@/hooks/useExpenses";
import { cashPosition, goalMonthlyNeed, latestBalances, monthlyFlow } from "./bankCashPosition";

const exp = (o: Partial<Expense>): Expense =>
  ({ id: Math.random().toString(), amount: 0, status: "solicitado", reimbursement_type: null, reimbursement_status: null, ...o }) as Expense;

describe("cashPosition", () => {
  it("no cuenta dos veces un gasto aprobado que además es reembolso", () => {
    const p = cashPosition({
      balances: [{ accountId: "a", balance: 100000, asOf: null }],
      expenses: [
        exp({ id: "1", amount: 1000, status: "aprobado", reimbursement_type: "reembolsar_trabajador", reimbursement_status: "pendiente" }),
        exp({ id: "2", amount: 500, status: "pagado", reimbursement_type: "reembolsar_trabajador", reimbursement_status: "pendiente" }),
        exp({ id: "3", amount: 300, status: "solicitado" }),
        exp({ id: "4", amount: 900, status: "rechazado" }),
      ],
      goals: [{ target_amount: 10000, saved_amount: 4000, target_date: null }],
    });
    expect(p.committed).toBe(1500);
    expect(p.tentative).toBe(300);
    expect(p.free).toBe(100000 - 1500 - 4000);
  });
});

describe("goalMonthlyNeed", () => {
  it("reparte lo que falta entre los meses restantes", () => {
    const now = new Date(2026, 9, 22);
    expect(goalMonthlyNeed({ target_amount: 12000, saved_amount: 0, target_date: "2027-10-22" }, now)).toBe(1000);
    expect(goalMonthlyNeed({ target_amount: 100, saved_amount: 100, target_date: "2027-10-22" }, now)).toBe(0);
  });
});

describe("latestBalances / monthlyFlow", () => {
  it("toma el estado más reciente por cuenta", () => {
    const r = latestBalances([
      { account_id: "a", period_end: "2026-09-30", closing_balance: 1, created_at: "x" },
      { account_id: "a", period_end: "2026-10-31", closing_balance: 2, created_at: "x" },
    ]);
    expect(r).toEqual([{ accountId: "a", balance: 2, asOf: "2026-10-31" }]);
  });
  it("agrupa por mes", () => {
    const f = monthlyFlow([{ tx_date: "2026-10-02", amount: 100 }, { tx_date: "2026-10-03", amount: -40 }], 2, new Date(2026, 9, 22));
    expect(f[1]).toMatchObject({ inflow: 100, outflow: 40, net: 60 });
  });
});
