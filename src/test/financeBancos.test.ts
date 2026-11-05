import { describe, expect, it } from "vitest";
import { parseMovementDate, parseMoney, parsePastedMovements } from "@/lib/finance/bankImport";
import { buildRuleIndex, categoryFromReference, extractPatterns, proposeNewCategories, suggestCategory } from "@/lib/finance/classifier";
import { accountBalances, monthlyFlow, newClientsNeeded, project, stageProbabilities } from "@/lib/finance/planning";

describe("importación bancaria", () => {
  it("lee fechas y montos en formatos mexicanos", () => {
    expect(parseMovementDate("01 de ene 2026")).toBe("2026-01-01");
    expect(parseMovementDate("4 de nov 2026")).toBe("2026-11-04");
    expect(parseMovementDate("31/01/2026")).toBe("2026-01-31");
    expect(parseMovementDate(new Date(2026, 4, 27))).toBe("2026-05-27");
    expect(parseMoney("$1,234.50")).toBe(1234.5);
    expect(parseMoney("(500.00)")).toBe(-500);
    expect(parseMoney("-")).toBeNull();
  });

  it("pega movimientos con encabezado y distingue repetidos del mismo día", () => {
    const txt = "Fecha\tDescripción\tReferencia\tCargo\tAbono\tSaldo\n" +
      "04 de nov 2026\tCompra en DLO*SERV UBER RIDES\tUber **3824\t119.91\t\t100\n" +
      "04 de nov 2026\tCompra en DLO*SERV UBER RIDES\tUber **3824\t119.91\t\t80\n" +
      "05 de nov 2026\tDepósito de SYLON ASESORES\t\t\t17500\t17580";
    const r = parsePastedMovements(txt)!;
    expect(r.movements).toHaveLength(3);
    expect(new Set(r.movements.map((m) => m.dedupeKey)).size).toBe(3);
    expect(r.movements[2].credit).toBe(17500);
  });

  it("pega sin encabezado", () => {
    const r = parsePastedMovements("04/11/2026\tPago renta\t5000\t\n05/11/2026\tDepósito cliente\t\t9000")!;
    expect(r.movements.map((m) => [m.debit, m.credit])).toEqual([[5000, 0], [0, 9000]]);
  });
});

describe("clasificación que aprende", () => {
  it("usa la columna Referencia del contable como categoría", () => {
    expect(categoryFromReference("Uber **3824")).toBe("Transporte (Uber/Didi)");
    expect(categoryFromReference("Plataformas **9215")).toBe("Software y plataformas");
    expect(categoryFromReference("Fernando **3295")).toBe("Fernando");
    expect(categoryFromReference("260527123044501606685332020953")).toBeNull();
  });

  it("sugiere con evidencia y no auto-aplica con poca evidencia", () => {
    const train = (desc: string, cat: string, n: number) =>
      Array.from({ length: n }, () => ({ pattern: extractPatterns({ description: desc, debit: 10, credit: 0 })[0], category: cat, hits: 1 }));
    const idx = buildRuleIndex([...train("Compra en DLO*SERV UBER RIDES", "Transporte (Uber/Didi)", 6), ...train("Compra en FACEBK *8NGWC9M9", "Publicidad", 1)]);
    const uber = suggestCategory({ description: "Compra en DLO*UBER RIDES", debit: 90, credit: 0 }, idx)!;
    expect(uber.category).toBe("Transporte (Uber/Didi)");
    expect(uber.autoApply).toBe(true);
    const fb = suggestCategory({ description: "Compra en FACEBK *XXXX1111", debit: 90, credit: 0 }, idx)!;
    expect(fb.autoApply).toBe(false);
    expect(suggestCategory({ description: "Gasolinera Shell", debit: 1, credit: 0 }, idx)).toBeNull();
  });

  it("propone categorías nuevas para comercios recurrentes", () => {
    const ms = Array.from({ length: 4 }, (_, i) => ({ id: String(i), description: "Compra en CROQUETERA EXPRESS", debit: 740, credit: 0 }));
    const p = proposeNewCategories(ms);
    expect(p[0].suggestedName).toBe("Croquetera Express");
    expect(p[0].count).toBe(4);
  });
});

describe("planeación", () => {
  it("calcula saldos disponibles y excluye dinero de terceros", () => {
    const b = accountBalances(
      [{ id: "a", opening_balance: 100, counts_as_available: true }, { id: "b", opening_balance: 50, counts_as_available: false }],
      [{ account_id: "a", debit: 30, credit: 0 }, { account_id: "a", debit: 0, credit: 80 }, { account_id: "b", debit: 0, credit: 10 }],
    );
    expect(b.available).toBe(150);
    expect(b.held).toBe(60);
  });

  it("flujo mensual ignora traspasos", () => {
    const f = monthlyFlow([
      { movement_date: "2026-01-05", debit: 0, credit: 1000, excluded_from_flow: false },
      { movement_date: "2026-01-06", debit: 400, credit: 0, excluded_from_flow: false },
      { movement_date: "2026-01-07", debit: 9999, credit: 0, excluded_from_flow: true },
    ]);
    expect(f).toEqual([{ key: "2026-01", income: 1000, expense: 400, net: 600 }]);
  });

  it("proyecta con clientes nuevos y calcula los que faltan", () => {
    const p = project({ history: [], startKey: "2026-11", months: 3, baseIncome: 100, baseExpense: 80, newClientsPerMonth: 2, avgNewClientMonthly: 10, pipelineWeighted: 0, pipelineIsMonthly: false, pipelineMonthsToClose: 1, openingCash: 0 });
    expect(p.map((m) => m.income)).toEqual([100, 120, 140]);
    expect(p[2].cash).toBe(20 + 40 + 60);
    const n = newClientsNeeded({ targetIncome: 200, projectedIncome: 100, avgMonthly: 10, closeRate: 0.25, pipelineExpectedWins: 4 });
    expect(n).toMatchObject({ clients: 10, remaining: 6, leadsToGenerate: 24 });
  });

  it("probabilidad por etapa", () => {
    const p = stageProbabilities([
      { id: "1", slug: "nuevo", position: 1, is_terminal: false },
      { id: "2", slug: "propuesta", position: 2, is_terminal: false },
      { id: "3", slug: "convertido", position: 3, is_terminal: true },
      { id: "4", slug: "perdido", position: 4, is_terminal: true },
    ]);
    expect(p["1"]).toBeLessThan(p["2"]); expect(p["3"]).toBe(1); expect(p["4"]).toBe(0);
  });
});
