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

import { parseStatementItems, type PdfTextItem } from "@/lib/finance/pdfStatement";

const it_ = (str: string, x: number, y: number, width = str.length * 4.5, page = 1): PdfTextItem => ({ str, x, y, width, page });

describe("estado de cuenta en PDF", () => {
  it("lee columnas de cargo/abono, separa la referencia y comprueba la cadena de saldos", () => {
    const hdr = [it_("Fecha", 40, 700), it_("Descripción", 110, 700), it_("Referencia", 300, 700), it_("Cargo", 380, 700), it_("Abono", 450, 700), it_("Saldo", 520, 700)];
    const items = [
      it_("Periodo: 01 oct 2026 al 31 oct 2026", 40, 750), it_("Saldo inicial $10,000.00", 40, 735), ...hdr,
      it_("02 oct 2026", 40, 682), it_("Compra en DLO*UBER RIDES", 110, 682), it_("Uber", 300, 682), it_("119.91", 395, 682), it_("9,880.09", 535, 682),
      it_("03 oct 2026", 40, 664), it_("Depósito de SYLON ASESORES", 110, 664), it_("17,500.00", 455, 664), it_("27,380.09", 535, 664),
      it_("Página 1 de 1", 250, 30),
    ];
    const r = parseStatementItems(items);
    expect(r.mode).toBe("columnas");
    expect(r.sheet?.openingBalance).toBe(10000);
    expect(r.sheet?.movements.map((m) => [m.date, m.debit, m.credit, m.reference])).toEqual([["2026-10-02", 119.91, 0, "Uber"], ["2026-10-03", 0, 17500, null]]);
    expect(r.checked).toBe(2); expect(r.chainOk).toBe(2); expect(r.warnings).toEqual([]);
  });

  it("deduce cargo/abono por el cambio de saldo y ordena un PDF que viene del más nuevo al más viejo", () => {
    const items = [
      it_("Fecha", 40, 720), it_("Concepto", 130, 720), it_("Monto", 430, 720), it_("Saldo", 520, 720),
      it_("04/11/2026", 40, 702), it_("Devolución Uber", 130, 702), it_("299.95", 440, 702), it_("36,267.60", 530, 702),
      it_("03/11/2026", 40, 684), it_("Mensualidad de FONDEADORA", 130, 684), it_("349.00", 440, 684), it_("35,967.65", 530, 684),
      it_("02/11/2026", 40, 666), it_("Depósito de cliente", 130, 666), it_("1,000.00", 440, 666), it_("36,316.65", 530, 666),
    ];
    const r = parseStatementItems(items);
    expect(r.mode).toBe("saldo");
    const m = r.sheet!.movements;
    expect(m.map((x) => x.date)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04"]);
    expect(m.map((x) => [x.debit, x.credit])).toEqual([[0, 1000], [349, 0], [0, 299.95]]);
    expect(r.chainOk).toBe(2); // el primero cronológico no tiene saldo anterior con qué compararse
  });

  it("avisa cuando no hay movimientos legibles (PDF escaneado)", () => {
    const r = parseStatementItems([it_("Página 1", 40, 700)]);
    expect(r.sheet).toBeNull();
    expect(r.warnings[0]).toMatch(/escaneado/);
  });
});

describe("estado de cuenta en PDF: formatos reales (sintéticos)", () => {
  it("fecha de solo día con el mes del periodo (tipo Banregio), descripción en varios renglones y sin pegar el pie de página", () => {
    const items = [
      it_("del 01 al 30 de SEPTIEMBRE 2026", 415, 740), it_("Saldo Inicial", 461, 594), it_("542,887.10", 547, 594),
      it_("DIA", 47, 577), it_("CONCEPTO", 187, 577), it_("CARGOS", 378, 577), it_("ABONOS", 456, 577), it_("SALDO", 538, 577),
      it_("01", 49, 565), it_("INT 2026090140145PE0000013715678 SPEI, BBASE,", 67, 565), it_("5,000.00", 480, 565), it_("547,887.10", 548, 565),
      it_("EBAC ASESORES S.A. DE C.V.,", 67, 556), it_("asesoria julio y agosto", 67, 547),
      it_("02", 49, 520), it_("TRA 0426691N99 Pago servicio: PAGO REFERENCIADO SA", 67, 520), it_("851.00", 402, 520), it_("547,036.10", 548, 520),
      it_("Total", 340, 480), it_("851.00", 402, 480), it_("5,000.00", 480, 480),
      it_("Leyendas del banco sin relación", 67, 300), it_("Página 4 de 6", 520, 40),
      it_("= Saldo Final", 358, 385), it_("547,036.10", 548, 385),
    ];
    const r = parseStatementItems(items);
    const m = r.sheet!.movements;
    expect(m.map((x) => [x.date, x.debit, x.credit])).toEqual([["2026-09-01", 0, 5000], ["2026-09-02", 851, 0]]);
    expect(m[0].description).toBe("INT 2026090140145PE0000013715678 SPEI, BBASE, EBAC ASESORES S.A. DE C.V., asesoria julio y agosto");
    expect(r.sheet!.openingBalance).toBe(542887.1);
    expect(r.checked).toBe(2); expect(r.chainOk).toBe(2);
    expect(r.finalBalance).toBe(547036.1); expect(r.finalOk).toBe(true);
  });

  it("fechas completas dd/mm/aaaa con cargos y abonos en cero (tipo Fondeadora) y saldo final en otro renglón", () => {
    const items = [
      it_("Saldo inicial $16,453.02", 330, 400),
      it_("Fecha", 65, 708), it_("Descripción", 146, 708), it_("Cargos", 391, 708), it_("Abonos", 460, 708), it_("Saldo", 532, 708),
      it_("01/10/2026", 65, 682), it_("Compra con TD Uber en DLO*UBER EATS", 146, 682), it_("910.54", 391, 682), it_("0.00", 471, 682), it_("15,542.48", 512, 682),
      it_("01/10/2026", 65, 657), it_("Depósito SPEI de STRIPE", 146, 657), it_("0.00", 401, 657), it_("763.11", 453, 657), it_("16,305.59", 512, 657),
      it_("Aviso legal que no es un movimiento", 146, 620), it_("Pag 1/20", 500, 30),
      it_("Saldo Final del periodo", 328, 370), it_("$16,305.59", 540, 365),
    ];
    const r = parseStatementItems(items);
    expect(r.sheet!.movements.map((x) => [x.debit, x.credit])).toEqual([[910.54, 0], [0, 763.11]]);
    expect(r.sheet!.movements[1].description).toBe("Depósito SPEI de STRIPE");
    expect(r.chainOk).toBe(2); expect(r.finalOk).toBe(true);
  });
});

import { shotRowsToMovements } from "@/lib/finance/screenshotImport";

describe("captura de pantalla", () => {
  it("convierte los renglones revisados de una captura y omite los incompletos", () => {
    const rows = [
      { id: "1", date: "2026-11-04", description: " Transferencia ", debit: 11520, credit: 0, balance: null, uncertain: false },
      { id: "2", date: null, description: "Sin fecha", debit: 10, credit: 0, balance: null, uncertain: true },
      { id: "3", date: "2026-11-03", description: "Depósito", debit: 0, credit: 5000, balance: 100, uncertain: false },
    ];
    const m = shotRowsToMovements(rows);
    expect(m.map((x) => [x.date, x.description, x.debit, x.credit])).toEqual([["2026-11-03", "Depósito", 0, 5000], ["2026-11-04", "Transferencia", 11520, 0]]);
  });
});

import { planBankImport, planRecordImport, reconcileMonth, type ExistingMovement } from "@/lib/finance/reconcile";

const ex = (id: string, date: string, debit: number, credit: number, extra: Partial<ExistingMovement> = {}): ExistingMovement => ({
  id, date, debit, credit, origin: "contable", bankConfirmed: false, hasRecord: true, category: null, ...extra,
});

describe("conciliación contra el banco", () => {
  it("el banco confirma lo registrado, detecta lo que faltaba y lo que ya estaba cargado", () => {
    const existing = [
      ex("r1", "2026-10-01", 910.54, 0), ex("r2", "2026-10-01", 910.54, 0), // dos compras idénticas registradas
      ex("r3", "2026-10-02", 0, 5000), ex("r4", "2026-10-09", 99, 0),       // r4 no aparece en el banco
      ex("b1", "2026-10-03", 40, 0, { origin: "banco", bankConfirmed: true, hasRecord: false }),
    ];
    const bank = [
      { date: "2026-10-01", debit: 910.54, credit: 0 }, { date: "2026-10-01", debit: 910.54, credit: 0 },
      { date: "2026-10-02", debit: 0, credit: 5000 },
      { date: "2026-10-03", debit: 40, credit: 0 },     // ya cargado del banco
      { date: "2026-10-12", debit: 20.32, credit: 0 },  // el banco trae algo que no estaba registrado
    ];
    const p = planBankImport(bank, existing);
    expect(p.confirm.map((c) => c.id).sort()).toEqual(["r1", "r2", "r3"]);
    expect(p.alreadyLoaded).toEqual([3]);
    expect(p.insert).toEqual([4]);
  });

  it("tolera desfase de fecha pero prefiere la fecha exacta", () => {
    const existing = [ex("a", "2026-10-02", 100, 0), ex("b", "2026-10-05", 100, 0)];
    const p = planBankImport([{ date: "2026-10-03", debit: 100, credit: 0 }, { date: "2026-10-05", debit: 100, credit: 0 }], existing);
    expect(p.confirm.map((c) => [c.index, c.id])).toEqual([[0, "a"], [1, "b"]]);
    expect(planBankImport([{ date: "2026-10-20", debit: 100, credit: 0 }], existing).insert).toEqual([0]);
  });

  it("registro que llega después del banco: se liga al movimiento del banco en vez de duplicarlo", () => {
    const existing = [ex("b1", "2026-10-13", 263, 0, { origin: "banco", bankConfirmed: true, hasRecord: false }), ex("r9", "2026-10-13", 50, 0)];
    const p = planRecordImport([
      { date: "2026-10-14", debit: 263, credit: 0 }, // otro día pero el banco lo tiene: se liga
      { date: "2026-10-13", debit: 50, credit: 0 },  // el mismo registro de antes: duplicado
      { date: "2026-10-13", debit: 77, credit: 0 },  // nuevo
    ], existing);
    expect(p.duplicates).toEqual([{ index: 0, existingId: "b1", linkToBank: true }, { index: 1, existingId: "r9", linkToBank: false }]);
    expect(p.insert).toEqual([2]);
    // un registro NO se empareja con otro registro de otro día
    expect(planRecordImport([{ date: "2026-10-14", debit: 50, credit: 0 }], existing).insert).toEqual([0]);
  });

  it("resume el mes: conciliados, registrados sin respaldo y solo en banco; sin estado de cuenta no marca faltantes", () => {
    const month = [
      ex("1", "2026-10-01", 1, 0, { bankConfirmed: true }), ex("2", "2026-10-02", 2, 0),
      ex("3", "2026-10-03", 3, 0, { origin: "banco", bankConfirmed: true, hasRecord: false }),
    ];
    const r = reconcileMonth(month);
    expect([r.total, r.confirmed, r.unconfirmed.map((m) => m.id), r.bankOnly.map((m) => m.id), r.hasBank]).toEqual([3, 2, ["2"], ["3"], true]);
    const noBank = reconcileMonth([ex("2", "2026-10-02", 2, 0)]);
    expect(noBank.hasBank).toBe(false); expect(noBank.unconfirmed).toEqual([]);
  });
});

import { skipAlreadyConfirmed } from "@/lib/finance/reconcile";

describe("volver a cargar el mismo estado de cuenta", () => {
  it("no confirma el registro duplicado con el mismo renglón del banco", () => {
    // Tu Excel tiene dos «UBER $289.94» el 15 de junio; el banco, uno.
    const records = [ex("r1", "2026-06-15", 289.94, 0), ex("r2", "2026-06-15", 289.94, 0)];
    const bank = [{ date: "2026-06-15", debit: 289.94, credit: 0, dedupeKey: "2026-06-15|compra con td uber en dlo*uber rides||289.94|0.00#1" }];

    // 1ª carga: el banco confirma uno; el otro queda sin respaldo.
    const first = planBankImport(bank, records);
    expect(first.confirm).toHaveLength(1);
    const confirmedId = first.confirm[0].id;

    // 2ª carga del MISMO archivo: el renglón ya confirmó algo, no debe tocar al duplicado.
    const base = "2026-06-15|compra con td uber en dlo*uber rides||289.94|0.00";
    const { remaining, skipped } = skipAlreadyConfirmed(bank, [base, null]);
    expect(skipped).toHaveLength(1); expect(remaining).toHaveLength(0);
    const pool = records.filter((r) => r.id !== confirmedId);
    expect(planBankImport(remaining, pool)).toEqual({ alreadyLoaded: [], confirm: [], insert: [] });
  });

  it("respeta renglones idénticos del banco (dos compras iguales el mismo día)", () => {
    const mk = (n: number) => ({ dedupeKey: `2026-06-15|uber||10.00|0.00#${n}` });
    const { remaining, skipped } = skipAlreadyConfirmed([mk(1), mk(2), mk(3)], ["2026-06-15|uber||10.00|0.00", "2026-06-15|uber||10.00|0.00"]);
    expect(skipped).toHaveLength(2); expect(remaining).toHaveLength(1);
  });
});
