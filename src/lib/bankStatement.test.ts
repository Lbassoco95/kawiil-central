import { describe, expect, it } from "vitest";
import { parseBankDate, parseMoney, parseStatementRows, withDedupeKeys } from "./bankStatement";

describe("parseMoney", () => {
  it("lee formatos comunes", () => {
    expect(parseMoney("$1,234.50")).toBe(1234.5);
    expect(parseMoney("(500.00)")).toBe(-500);
    expect(parseMoney("-1,000")).toBe(-1000);
    expect(parseMoney("1.234,50".replace(".", ""))).toBe(1234.5);
    expect(parseMoney("")).toBeNull();
  });
});

describe("parseBankDate", () => {
  it("usa día/mes/año", () => {
    expect(parseBankDate("05/10/2026")).toBe("2026-10-05");
    expect(parseBankDate("2026-10-05")).toBe("2026-10-05");
    expect(parseBankDate("05 oct 2026")).toBe("2026-10-05");
    expect(parseBankDate("hola")).toBeNull();
  });
});

describe("parseStatementRows", () => {
  it("lee cargos/abonos y calcula saldos", () => {
    const r = parseStatementRows([
      ["Estado de cuenta"],
      ["Fecha", "Concepto", "Cargo", "Abono", "Saldo"],
      ["01/10/2026", "Depósito cliente", "", "10,000.00", "110,000.00"],
      ["03/10/2026", "Renta", "20,000.00", "", "90,000.00"],
    ]);
    expect(r.transactions.map((t) => t.amount)).toEqual([10000, -20000]);
    expect(r.openingBalance).toBe(100000);
    expect(r.closingBalance).toBe(90000);
    expect(r.periodStart).toBe("2026-10-01");
    expect(r.periodEnd).toBe("2026-10-03");
  });

  it("acepta una sola columna de monto y orden descendente", () => {
    const r = parseStatementRows([
      ["Fecha", "Descripción", "Monto", "Saldo"],
      ["03/10/2026", "Renta", "-20000", "90000"],
      ["01/10/2026", "Depósito", "10000", "110000"],
    ]);
    expect(r.closingBalance).toBe(90000);
    expect(r.openingBalance).toBe(100000);
  });

  it("falla con mensaje claro si no hay columnas", () => {
    expect(() => parseStatementRows([["a", "b"]])).toThrow(/columnas/);
  });

  it("distingue movimientos idénticos", () => {
    const keys = withDedupeKeys([
      { date: "2026-10-01", description: "OXXO", amount: -50, balance: null },
      { date: "2026-10-01", description: "OXXO", amount: -50, balance: null },
    ]).map((t) => t.dedupe_key);
    expect(new Set(keys).size).toBe(2);
  });
});
