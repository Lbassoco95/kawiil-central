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
    const d = "2026-01-01";
    const b = accountBalances(
      [{ id: "a", opening_balance: 100, counts_as_available: true }, { id: "b", opening_balance: 50, counts_as_available: false }],
      [{ account_id: "a", debit: 30, credit: 0, movement_date: d }, { account_id: "a", debit: 0, credit: 80, movement_date: d }, { account_id: "b", debit: 0, credit: 10, movement_date: d }],
    );
    expect(b.available).toBe(150);
    expect(b.held).toBe(60);
  });

  it("ancla al saldo reportado por el banco y resta el sub-libro de terceros del padre", () => {
    const b = accountBalances(
      [
        { id: "bank", opening_balance: 500, counts_as_available: true },
        { id: "tax", opening_balance: 0, counts_as_available: false, parent_account_id: "bank" },
      ],
      [
        // al banco le falta registrar un cargo: el saldo reportado manda
        { account_id: "bank", debit: 0, credit: 1000, movement_date: "2026-06-01", row_seq: 1, reported_balance: 1500 },
        { account_id: "bank", debit: 300, credit: 0, movement_date: "2026-06-02", row_seq: 2, reported_balance: 700 },
        { account_id: "bank", debit: 50, credit: 0, movement_date: "2026-06-03" }, // pegado después, sin saldo
        { account_id: "tax", debit: 0, credit: 400, movement_date: "2026-06-01", row_seq: 1, reported_balance: 400 },
      ],
    );
    expect(b.byAccount.bank).toBe(650);
    expect(b.computed.bank).toBe(1150);
    expect(b.anchored.bank).toBe(true);
    expect(b.available).toBe(250);
    expect(b.held).toBe(400);
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

import { summarizeCommitments } from "@/lib/finance/planning";
import { detectEntity, summarizeEntities } from "@/lib/finance/thirdParty";

describe("compromisos y terceros", () => {
  it("calcula comprometido a 30 días, libre y faltante", () => {
    const s = summarizeCommitments([
      { direction: "pagar", amount: 20000, due_date: "2026-11-10", status: "pendiente" },
      { direction: "pagar", amount: 11520, due_date: null, status: "pendiente" },
      { direction: "pagar", amount: 72025, due_date: "2026-12-15", status: "pendiente" },
      { direction: "pagar", amount: 999, due_date: "2026-11-01", status: "pagado" },
      { direction: "cobrar", amount: 4000, due_date: "2026-01-01", status: "pendiente" },
    ], "2026-11-05", 25000);
    expect(s.payable30).toBe(31520);
    expect(s.payablePending).toBe(103545);
    expect(s.free).toBe(-6520);
    expect(s.shortfall).toBe(6520);
    expect(s.receivablePending).toBe(4000);
  });

  it("detecta el cliente dueño del dinero y resume la tesorería por entidad", () => {
    expect(detectEntity("SPEI de STP de VIZUM TECHNOLOGIES SAPI DE CV (IMPUESTOS AGO26)")).toBe("Vizum");
    expect(detectEntity("PAGO a PAGO REFERENCIADO SA", "IVA E ISR AGOSTO VIZUM")).toBe("Vizum");
    expect(detectEntity("SPEI de BBVA MEXICO de FUZE LABS SAPI DE CV (ISR 2025)")).toBe("Fuze Labs");
    expect(detectEntity("PAGO DE IMPUESTOS")).toBeNull();
    const r = summarizeEntities([
      { description: "SPEI de STP de VIZUM TECHNOLOGIES", movement_date: "2026-10-15", debit: 0, credit: 1000 },
      { description: "PAGO", notes: "ISR VIZUM", movement_date: "2026-10-30", debit: 400, credit: 0 },
    ]);
    expect(r[0]).toMatchObject({ entity: "Vizum", deposited: 1000, paid: 400, held: 600 });
  });
});

import { monthlyClose } from "@/lib/finance/planning";

describe("cierre mensual", () => {
  it("ubica en qué mes faltan movimientos y marca meses vacíos", () => {
    const rows = monthlyClose(100, [
      { account_id: "a", debit: 0, credit: 50, movement_date: "2026-01-10", row_seq: 1, reported_balance: 150 },
      { account_id: "a", debit: 0, credit: 10, movement_date: "2026-03-05", row_seq: 2, reported_balance: 160 },
      // en abril falta un cargo de 40 en el estado de cuenta: el banco reporta 120 y la suma da 160
      { account_id: "a", debit: 0, credit: 0.01, movement_date: "2026-04-05", row_seq: 3, reported_balance: 120.01 },
    ]);
    expect(rows.map((r) => r.key)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(rows[0].monthDrift).toBe(0);
    expect(rows[1].count).toBe(0);
    expect(rows[3].monthDrift).toBeCloseTo(-40, 1);
  });
});

import { parseBankList, mergeBanks } from "@/lib/finance/banks";
import { analyzeTable, parseDelimitedText, parseWithMapping } from "@/lib/finance/bankImport";

describe("catálogo de bancos y estados de cuenta originales", () => {
  it("lee la lista de Banxico en varios formatos", () => {
    const l = parseBankList("Clave\tNombre\n40012\tBBVA MEXICO\n90646\tSTP\n002 Banamex\nFondeadora");
    expect(l).toEqual([
      { name: "Bbva Mexico", code: "012" }, { name: "Stp", code: "646" }, { name: "Banamex", code: "002" }, { name: "Fondeadora", code: null },
    ]);
    expect(mergeBanks([{ name: "Banregio", code: "058" }]).find((b) => b.name === "Banregio")?.code).toBe("058");
  });

  it("lee un CSV con comillas y punto y coma, y lo ordena cronológicamente si viene al revés", () => {
    const csv = 'Fecha;Descripción;Cargo;Abono;Saldo\n03/11/2026;"Compra, tienda";100,00;;900\n02/11/2026;Depósito;;1000;1000'.replace(/,00/g, ".00");
    const rows = parseDelimitedText(csv);
    expect(rows[1][1]).toBe("Compra, tienda");
    const a = analyzeTable(rows);
    expect(a.detected).toBe(true);
    const sheet = parseWithMapping(rows, a.mapping, a.headerRow)!;
    expect(sheet.movements.map((m) => m.date)).toEqual(["2026-11-02", "2026-11-03"]);
    expect(sheet.movements[1]).toMatchObject({ debit: 100, credit: 0, seq: 1 });
  });

  it("usa un mapeo manual cuando el encabezado no se reconoce", () => {
    const rows = [["Día", "Concepto raro", "Salida", "Entrada"], ["05/11/2026", "Pago X", "250", ""]];
    const a = analyzeTable(rows);
    expect(a.detected).toBe(false);
    const sheet = parseWithMapping(rows, { date: 0, description: 1, debit: 2, credit: 3 }, 0)!;
    expect(sheet.movements[0]).toMatchObject({ date: "2026-11-05", debit: 250 });
  });
});
