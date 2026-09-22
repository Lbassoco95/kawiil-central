import { describe, expect, it } from "vitest";
import {
  autoVerifyUserAmounts,
  buildArithmeticCorrectionFooter,
  collectRecentUserTexts,
  executeMoneyCalc,
  extractAmountsFromText,
  extractClaimedTotal,
  formatCalcForUser,
  formatCents,
  formatMxn,
  parseMoneyToCents,
  reconcileDocumentMoney,
  responseMentionsCents,
  userLastMessageRequestedArithmetic,
} from "../../supabase/functions/_shared/moneyCalc.ts";
import { normalizeTemplateData } from "../../supabase/functions/_shared/ai-templates/schemas.ts";

describe("parseMoneyToCents — formatos MX y europeos", () => {
  it("parsea $463,071.49 (el caso del chat)", () => {
    expect(parseMoneyToCents("$463,071.49")).toBe(46307149n);
    expect(formatMxn(46307149n)).toBe("$463,071.49");
  });

  it("parsea miles con coma y negativo entre paréntesis", () => {
    expect(parseMoneyToCents("1,234.56")).toBe(123456n);
    expect(parseMoneyToCents("(1,234.56)")).toBe(-123456n);
    expect(parseMoneyToCents("-$500.00")).toBe(-50000n);
  });

  it("parsea europeo 463.071,49 cuando hay ambos separadores", () => {
    expect(parseMoneyToCents("463.071,49")).toBe(46307149n);
  });

  it("trata 1,234 sin decimales como miles", () => {
    expect(parseMoneyToCents("1,234")).toBe(123400n);
  });

  it("no usa flotantes: 0.1 + 0.2 = 0.30", () => {
    const r = executeMoneyCalc({ operation: "sum", amounts: ["0.10", "0.20"] });
    expect(r.ok).toBe(true);
    expect(r.result).toBe("0.30");
    expect(r.result_cents).toBe(30);
  });
});

describe("executeMoneyCalc", () => {
  it("suma una lista larga en centavos", () => {
    const amounts = ["232.76", "39.00", "500.00", "96.55", "9,000.00", "248,855.71"];
    const r = executeMoneyCalc({ operation: "sum", amounts });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(6);
    expect(r.result).toBe("258,724.02".replace(",", ""));
    expect(r.result).toBe("258724.02");
    expect(r.result_formatted).toBe("$258,724.02");
  });

  it("compare detecta diferencia 463,071.49 − 451,833.44", () => {
    const r = executeMoneyCalc({
      operation: "compare",
      amounts: ["451,833.44"],
      claimed_total: "$463,071.49",
    });
    // compare con 1 monto: suma real = ese monto
    expect(r.ok).toBe(true);
    expect(r.matches).toBe(false);
    expect(r.difference).toBe("11238.05");
    expect(r.difference_formatted).toBe("$11,238.05");
  });

  it("compare coincide cuando la suma es exacta", () => {
    const r = executeMoneyCalc({
      operation: "compare",
      amounts: ["100.00", "200.50", "0.50"],
      claimed_total: "301.00",
    });
    expect(r.ok).toBe(true);
    expect(r.matches).toBe(true);
    expect(r.result).toBe("301.00");
  });

  it("IVA 16% de 1,000.00", () => {
    const r = executeMoneyCalc({ operation: "iva", amounts: ["1000.00"] });
    expect(r.ok).toBe(true);
    expect(r.subtotal).toBe("1000.00");
    expect(r.iva).toBe("160.00");
    expect(r.total).toBe("1160.00");
  });

  it("percentage 16% de 463,071.49", () => {
    const r = executeMoneyCalc({
      operation: "percentage",
      amounts: ["$463,071.49"],
      rate: 16,
    });
    expect(r.ok).toBe(true);
    expect(r.result_cents).toBe(7409144);
    expect(r.result_formatted).toBe("$74,091.44");
  });

  it("expression (100 + 50) * 1.16", () => {
    const r = executeMoneyCalc({
      operation: "expression",
      expression: "(100 + 50) * 1.16",
    });
    expect(r.ok).toBe(true);
    expect(r.result).toBe("174.00");
  });

  it("expression con % y formato MX", () => {
    const r = executeMoneyCalc({
      operation: "expression",
      expression: "$1,000.00 * 16%",
    });
    expect(r.ok).toBe(true);
    expect(r.result).toBe("160.00");
  });

  it("rechaza expresiones con letras (no eval)", () => {
    const r = executeMoneyCalc({
      operation: "expression",
      expression: "process.exit(1)",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/solo admite/i);
  });

  it("divide entre cero", () => {
    const r = executeMoneyCalc({ operation: "divide", amounts: [10, 0] });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cero/i);
  });

  it("pide montos si no hay lista", () => {
    const r = executeMoneyCalc({ operation: "sum" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No se recibieron montos/);
  });

  it("extrae montos de text y suma", () => {
    const r = executeMoneyCalc({
      operation: "sum",
      text: "Conceptos: $1,234.56 y $2,000.00 más 100.00",
    });
    expect(r.ok).toBe(true);
    expect(r.count).toBe(3);
    expect(r.result).toBe("3334.56");
  });

  it("average redondea half-up", () => {
    const r = executeMoneyCalc({ operation: "average", amounts: ["10.00", "10.00", "10.01"] });
    expect(r.ok).toBe(true);
    expect(r.result).toBe("10.00");
  });
});

describe("extractAmountsFromText", () => {
  it("ignora fechas y toma importes con $", () => {
    const found = extractAmountsFromText("El 22/09/2026 pagué $1,250.00 y $10.50");
    expect(found.map((f) => formatCents(f.cents))).toEqual(["1250.00", "10.50"]);
  });

  it("lee tabla markdown", () => {
    const found = extractAmountsFromText("| # | Monto |\n| 1 | $96.55 |\n| 2 | $9,000.00 |");
    expect(found.length).toBeGreaterThanOrEqual(2);
    expect(found.some((f) => f.cents === 9655n)).toBe(true);
    expect(found.some((f) => f.cents === 900000n)).toBe(true);
  });
});

describe("userLastMessageRequestedArithmetic", () => {
  it("detecta el mensaje de la captura", () => {
    expect(userLastMessageRequestedArithmetic("mi suma de esos montos da $463,071.49")).toBe(true);
  });

  it("detecta verificar total / IVA", () => {
    expect(userLastMessageRequestedArithmetic("verifica si el total de $12,000.00 es correcto")).toBe(true);
    expect(userLastMessageRequestedArithmetic("cuánto es el IVA de $1,000")).toBe(true);
  });

  it("no dispara en 'tareas en total' sin montos", () => {
    expect(userLastMessageRequestedArithmetic("¿cuántas tareas tengo en total esta semana?")).toBe(false);
  });

  it("detecta búsqueda de combinación en columna", () => {
    expect(
      userLastMessageRequestedArithmetic("dentro de la columna busca cuales cantidades sumadas dan 95,452.84"),
    ).toBe(true);
  });
});

describe("find_combination", () => {
  it("encuentra partidas que suman el objetivo", () => {
    const r = executeMoneyCalc({
      operation: "find_combination",
      amounts: ["10.00", "20.00", "30.00", "40.00"],
      labels: ["A", "B", "C", "D"],
      claimed_total: "50.00",
    });
    expect(r.ok).toBe(true);
    expect(r.matches).toBe(true);
    expect(r.combinations?.length).toBeGreaterThanOrEqual(1);
    const first = r.combinations![0];
    expect(first.sum).toBe("50.00");
    const cents = first.amounts.reduce((a, x) => a + Number(parseMoneyToCents(x)), 0);
    expect(cents).toBe(5000);
  });

  it("si no hay exacta, reporta la más cercana", () => {
    const r = executeMoneyCalc({
      operation: "find_combination",
      amounts: ["10.00", "20.00"],
      labels: ["A", "B"],
      claimed_total: "35.00",
    });
    expect(r.ok).toBe(true);
    expect(r.matches).toBe(false);
    expect(r.closest?.sum).toBe("30.00");
    expect(r.closest?.difference).toBe("5.00");
  });

  it("resuelve el caso 95,452.84 con partidas reales", () => {
    const r = executeMoneyCalc({
      operation: "find_combination",
      amounts: ["35989.64", "35989.65", "13920.00", "23473.55", "100.00"],
      labels: ["BASSOCO 163", "BASSOCO 162", "CASTILLO 489", "RESTO", "RUIDO"],
      claimed_total: "95,452.84",
    });
    expect(r.ok).toBe(true);
    expect(r.matches).toBe(true);
    expect(r.claimed_formatted).toBe("$95,452.84");
    const text = formatCalcForUser(r);
    expect(text).toMatch(/95,452\.84/);
    expect(text).not.toMatch(/no devolvió texto/i);
  });
});

describe("autoVerifyUserAmounts", () => {
  it("suma partidas y compara contra la cifra afirmada", () => {
    const text = "Partidas: $100.00, $200.50 y $0.50. Mi suma da $301.00";
    const r = autoVerifyUserAmounts(text);
    expect(r?.ok).toBe(true);
    expect(r?.operation).toBe("compare");
    expect(r?.matches).toBe(true);
  });

  it("detecta un total afirmado incorrecto", () => {
    const text = "$100.00 + $50.00. El total es $200.00";
    const r = autoVerifyUserAmounts(text);
    expect(r?.ok).toBe(true);
    expect(r?.matches).toBe(false);
    expect(r?.result).toBe("150.00");
    expect(r?.claimed).toBe("200.00");
  });

  it("evalúa una expresión pegada", () => {
    const r = autoVerifyUserAmounts("1234.56 + 100");
    expect(r?.ok).toBe(true);
    expect(r?.result).toBe("1334.56");
  });

  it("extractClaimedTotal lee «da $463,071.49»", () => {
    expect(extractClaimedTotal("mi suma de esos montos da $463,071.49")).toBe("463,071.49");
  });

  it("extractClaimedTotal lee «sumadas dan 95,452.84»", () => {
    expect(extractClaimedTotal("busca cuales cantidades sumadas dan 95,452.84")).toBe("95,452.84");
  });
});

describe("reconcileDocumentMoney", () => {
  it("recalcula amount = qty × precio y corrige el total", () => {
    const r = reconcileDocumentMoney(
      [
        { description: "Honorarios", quantity: 2, unit_price: 1500.5, amount: 2000 },
        { description: "Gastos", amount: 99.5 },
      ],
      0,
    );
    expect(r.corrected).toBe(true);
    expect(r.line_items[0].amount).toBe(3001);
    expect(r.subtotal).toBe(3100.5);
    expect(r.total).toBe(3100.5);
  });

  it("total = subtotal + IVA informado", () => {
    const r = reconcileDocumentMoney([{ description: "A", amount: 1000 }], 160);
    expect(r.subtotal).toBe(1000);
    expect(r.taxes).toBe(160);
    expect(r.total).toBe(1160);
  });
});

describe("pies de corrección y contexto", () => {
  it("footer de compare incorrecto nombra ambos totales", () => {
    const r = executeMoneyCalc({
      operation: "compare",
      amounts: ["100.00", "50.00"],
      claimed_total: "200.00",
    });
    const footer = buildArithmeticCorrectionFooter(r);
    expect(footer).toMatch(/\$150\.00/);
    expect(footer).toMatch(/\$200\.00/);
  });

  it("responseMentionsCents encuentra el total correcto", () => {
    expect(responseMentionsCents("El total es $1,250.00 MXN", 125000n)).toBe(true);
    expect(responseMentionsCents("El total es $1,000.00", 125000n)).toBe(false);
  });

  it("normalizeTemplateData corrige total de cotización", () => {
    const data = normalizeTemplateData("propuesta_cotizacion", {
      line_items: [
        { description: "A", quantity: 2, unit_price: 100, amount: 999 },
        { description: "B", amount: 50 },
      ],
      taxes: 40,
      total: 1,
    }) as { subtotal: number; taxes?: number; total: number; line_items: Array<{ amount?: number }> };
    expect(data.line_items[0].amount).toBe(200);
    expect(data.subtotal).toBe(250);
    expect(data.taxes).toBe(40);
    expect(data.total).toBe(290);
  });

  it("collectRecentUserTexts toma los últimos N user", () => {
    const t = collectRecentUserTexts(
      [
        { role: "user", content: "uno $10.00" },
        { role: "assistant", content: "ok" },
        { role: "user", content: "dos $20.00" },
        { role: "user", content: "mi suma da $30.00" },
      ],
      3,
    );
    expect(t).toContain("$10.00");
    expect(t).toContain("mi suma da $30.00");
  });
});
