/**
 * Aritmética monetaria exacta para Kawiil AI.
 *
 * Los LLM se equivocan al sumar. Este módulo opera en enteros (escala fija,
 * 6 decimales internos; redondeo half-up a centavos) y acepta formatos MX:
 * `$463,071.49`, `1,234.56`, `(1,234.56)` negativo.
 *
 * Sin dependencias (sirve en Edge Deno y en tests de Vitest).
 */

export const MONEY_CALC_MAX_AMOUNTS = 500;
export const MONEY_CALC_MAX_EXPRESSION_LEN = 2000;
export const DEFAULT_IVA_RATE = 16;

const SCALE = 6;
const FACTOR = 10n ** BigInt(SCALE);
const CENTS_FACTOR = 10n ** BigInt(SCALE - 2); // 10_000: scaled → cents

export type CalcOperation =
  | "sum"
  | "subtract"
  | "multiply"
  | "divide"
  | "difference"
  | "average"
  | "percentage"
  | "iva"
  | "compare"
  | "expression"
  | "find_combination";

export const CALC_OPERATIONS: readonly CalcOperation[] = [
  "sum",
  "subtract",
  "multiply",
  "divide",
  "difference",
  "average",
  "percentage",
  "iva",
  "compare",
  "expression",
  "find_combination",
] as const;

export interface CalcItem {
  index: number;
  label?: string;
  raw: string;
  amount: string;
  cents: number;
}

export interface CalcInput {
  operation?: string;
  amounts?: Array<string | number>;
  labels?: string[];
  text?: string;
  claimed_total?: string | number;
  rate?: number;
  expression?: string;
  currency?: string;
}

export interface CalcResult {
  ok: boolean;
  operation: string;
  currency: string;
  count?: number;
  items?: CalcItem[];
  result?: string;
  result_formatted?: string;
  result_number?: number;
  result_cents?: number;
  subtotal?: string;
  subtotal_formatted?: string;
  iva?: string;
  iva_formatted?: string;
  iva_rate?: number;
  total?: string;
  total_formatted?: string;
  claimed?: string;
  claimed_formatted?: string;
  difference?: string;
  difference_formatted?: string;
  difference_cents?: number;
  matches?: boolean;
  warning?: string;
  error?: string;
  note?: string;
  steps?: string[];
  combinations?: CombinationHit[];
  closest?: CombinationHit;
}

export interface CombinationHit {
  indices: number[];
  labels: string[];
  amounts: string[];
  sum: string;
  sum_formatted: string;
  difference?: string;
  difference_formatted?: string;
}

export interface ParsedAmount {
  raw: string;
  scaled: bigint;
  cents: bigint;
  index?: number;
}

function isCalcOperation(v: string): v is CalcOperation {
  return (CALC_OPERATIONS as readonly string[]).includes(v);
}

function halfUpDiv(n: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("división entre cero");
  const sign = (n < 0n) !== (d < 0n) ? -1n : 1n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  return sign * ((an + ad / 2n) / ad);
}

/** Redondeo half-up de escala interna a centavos. */
export function scaledToCents(scaled: bigint): bigint {
  return halfUpDiv(scaled, CENTS_FACTOR);
}

export function centsToScaled(cents: bigint): bigint {
  return cents * CENTS_FACTOR;
}

export function formatCents(cents: bigint, fractionDigits = 2): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  const factor = 10n ** BigInt(fractionDigits);
  const whole = abs / factor;
  const frac = abs % factor;
  return `${sign}${whole.toString()}.${frac.toString().padStart(fractionDigits, "0")}`;
}

export function formatMxn(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  const raw = formatCents(abs);
  const [w, f] = raw.split(".");
  const withSep = w.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${withSep}.${f}`;
}

export function centsToNumber(cents: bigint): number {
  return Number(formatCents(cents));
}

/**
 * Interpreta un monto en formato mexicano (coma miles, punto decimal) o
 * europeo (punto miles, coma decimal) cuando ambas aparecen.
 */
export function parseMoneyToScaled(input: string | number): bigint {
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new Error("número no finito");
    // Evitar 463071.489999…: toFixed(6) y luego parseo de string.
    return parseMoneyToScaled(input.toFixed(6));
  }

  let s = String(input).trim();
  if (!s) throw new Error("monto vacío");

  s = s.replace(/\s+/g, "");
  s = s.replace(/mxn|usd|eur|mn\$/gi, "");
  s = s.replace(/\$/g, "");

  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!s) throw new Error("monto vacío");

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");

  if (lastComma !== -1 && lastDot !== -1) {
    // El último separador es el decimal.
    if (lastComma > lastDot) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (lastComma !== -1) {
    const after = s.length - lastComma - 1;
    if (after === 3 && /^\d{1,3}(,\d{3})+$/.test(s)) {
      s = s.replace(/,/g, "");
    } else {
      s = s.replace(/,/g, ".");
    }
  } else if (lastDot !== -1) {
    const dots = (s.match(/\./g) || []).length;
    if (dots > 1) {
      s = s.replace(/\./g, "");
    }
    // Un solo punto: decimal (convención MX / US).
  }

  if (!/^\d+(\.\d+)?$/.test(s)) {
    throw new Error(`monto inválido: «${input}»`);
  }

  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(SCALE)).slice(0, SCALE);
  const extra = frac.length > SCALE ? frac.slice(SCALE) : "";
  let scaled = BigInt(whole) * FACTOR + BigInt(fracPadded || "0");
  if (extra && extra[0] >= "5") scaled += 1n;
  return negative ? -scaled : scaled;
}

export function parseMoneyToCents(input: string | number): bigint {
  return scaledToCents(parseMoneyToScaled(input));
}

const DATE_LIKE = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/;
const YEAR_ONLY = /^(19|20)\d{2}$/;

function looksLikeDateContext(full: string, start: number, end: number): boolean {
  const window = full.slice(Math.max(0, start - 3), Math.min(full.length, end + 3));
  if (DATE_LIKE.test(window)) return true;
  const token = full.slice(start, end).replace(/[$,]/g, "");
  return YEAR_ONLY.test(token);
}

/**
 * Extrae montos de texto libre (listas, tablas markdown, copiado de Excel).
 * Prefiere cifras con `$` o miles + decimales; ignora fechas y años sueltos.
 */
export function extractAmountsFromText(text: string): ParsedAmount[] {
  if (!text || !text.trim()) return [];

  type Cand = ParsedAmount & { start: number; end: number };
  const cands: Cand[] = [];

  const patterns: RegExp[] = [
    /\$\s*-?\(?\s*\d{1,3}(?:,\d{3})+(?:\.\d{1,6})?\s*\)?/g,
    /\$\s*-?\(?\s*\d+\.\d{1,6}\s*\)?/g,
    /\$\s*-?\(?\s*\d{1,3}(?:,\d{3})+\s*\)?/g,
    /(?<![A-Za-z0-9.])-?\d{1,3}(?:,\d{3})+\.\d{1,6}(?![A-Za-z0-9.])/g,
    /(?<![A-Za-z0-9.])-?\d+\.\d{2}(?![A-Za-z0-9.%])/g,
  ];

  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = m[0].trim();
      const start = m.index + (m[0].length - m[0].trimStart().length);
      const end = start + raw.length;
      if (looksLikeDateContext(text, start, end)) continue;
      if (/%/.test(text.slice(end, end + 1))) continue;
      try {
        const scaled = parseMoneyToScaled(raw);
        cands.push({
          raw,
          scaled,
          cents: scaledToCents(scaled),
          index: start,
          start,
          end,
        });
      } catch {
        /* skip */
      }
    }
  }

  // Más largo primero: `$1,250.00` gana a `1,250.00` y a `250.00`.
  cands.sort((a, b) => {
    const len = b.end - b.start - (a.end - a.start);
    if (len !== 0) return len;
    return a.start - b.start;
  });

  const accepted: Cand[] = [];
  for (const c of cands) {
    if (accepted.some((a) => c.start < a.end && c.end > a.start)) continue;
    accepted.push(c);
  }
  accepted.sort((a, b) => a.start - b.start);

  return accepted.map(({ raw, scaled, cents, index }) => ({ raw, scaled, cents, index }));
}

type Tok =
  | { t: "num"; v: bigint }
  | { t: "+" | "-" | "*" | "/" | "(" | ")" | "%" };

function tokenizeExpression(expr: string): Tok[] {
  const s = expr.replace(/mxn|usd|eur/gi, "").replace(/\$/g, "");
  const tokens: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "+" || c === "*" || c === "/" || c === "(" || c === ")" || c === "%") {
      tokens.push({ t: c });
      i++;
      continue;
    }
    if (c === "-") {
      tokens.push({ t: "-" });
      i++;
      continue;
    }
    if (/\d/.test(c) || c === ".") {
      let j = i;
      while (j < s.length && /[\d.,]/.test(s[j])) j++;
      tokens.push({ t: "num", v: parseMoneyToScaled(s.slice(i, j)) });
      i = j;
      continue;
    }
    throw new Error(`carácter no permitido en la expresión: «${c}»`);
  }
  return tokens;
}

function evaluateTokens(tokens: Tok[]): bigint {
  let p = 0;

  const peek = () => tokens[p];
  const eat = () => tokens[p++];

  const parseExpr = (): bigint => {
    let left = parseTerm();
    while (peek() && (peek().t === "+" || peek().t === "-")) {
      const op = eat().t;
      const right = parseTerm();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };

  const parseTerm = (): bigint => {
    let left = parseUnary();
    while (peek() && (peek().t === "*" || peek().t === "/")) {
      const op = eat().t;
      const right = parseUnary();
      if (op === "*") {
        left = halfUpDiv(left * right, FACTOR);
      } else {
        if (right === 0n) throw new Error("división entre cero");
        left = halfUpDiv(left * FACTOR, right);
      }
    }
    return left;
  };

  const parseUnary = (): bigint => {
    if (peek()?.t === "-") {
      eat();
      return -parseUnary();
    }
    if (peek()?.t === "+") {
      eat();
      return parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): bigint => {
    const tok = peek();
    if (!tok) throw new Error("expresión incompleta");
    if (tok.t === "num") {
      eat();
      if (peek()?.t === "%") {
        eat();
        return applyPercent(tok.v);
      }
      return tok.v;
    }
    if (tok.t === "(") {
      eat();
      const inner = parseExpr();
      if (peek()?.t !== ")") throw new Error("falta ')' en la expresión");
      eat();
      if (peek()?.t === "%") {
        eat();
        return halfUpDiv(inner, 100n);
      }
      return inner;
    }
    throw new Error("expresión inválida");
  };

  const value = parseExpr();
  if (p !== tokens.length) throw new Error("expresión inválida (sobraron tokens)");
  return value;
}

/** `n%` → n/100 en escala fija. */
function applyPercent(scaled: bigint): bigint {
  return halfUpDiv(scaled, 100n);
}

function evaluateExpression(expr: string): bigint {
  const trimmed = expr.trim();
  if (!trimmed) throw new Error("expresión vacía");
  if (trimmed.length > MONEY_CALC_MAX_EXPRESSION_LEN) {
    throw new Error(`expresión demasiado larga (máx. ${MONEY_CALC_MAX_EXPRESSION_LEN} caracteres)`);
  }
  if (/[a-zA-Z_]/.test(trimmed.replace(/mxn|usd|eur/gi, ""))) {
    throw new Error("la expresión solo admite números y + − × ÷ ( ) %");
  }
  const tokens = tokenizeExpression(trimmed);
  // Postfix % after a number: rewrite as value/100
  const rewritten: Tok[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t === "%" && rewritten.length && rewritten[rewritten.length - 1].t === "num") {
      const prev = rewritten.pop() as { t: "num"; v: bigint };
      rewritten.push({ t: "num", v: applyPercent(prev.v) });
      continue;
    }
    rewritten.push(t);
  }
  return evaluateTokens(rewritten);
}

function resolveAmounts(input: CalcInput): ParsedAmount[] {
  const out: ParsedAmount[] = [];
  if (Array.isArray(input.amounts)) {
    for (const a of input.amounts) {
      if (a === null || a === undefined || a === "") continue;
      try {
        const scaled = parseMoneyToScaled(a);
        out.push({ raw: String(a), scaled, cents: scaledToCents(scaled) });
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : String(e));
      }
    }
  }
  if (typeof input.text === "string" && input.text.trim()) {
    const fromText = extractAmountsFromText(input.text);
    for (const p of fromText) out.push(p);
  }
  if (out.length > MONEY_CALC_MAX_AMOUNTS) {
    throw new Error(`demasiados montos (máx. ${MONEY_CALC_MAX_AMOUNTS})`);
  }
  return out;
}

function toItems(parsed: ParsedAmount[], labels?: string[]): CalcItem[] {
  return parsed.map((p, i) => ({
    index: i + 1,
    label: labels?.[i],
    raw: p.raw,
    amount: formatCents(p.cents),
    cents: Number(p.cents),
  }));
}

function packMoney(cents: bigint, currency: string): Pick<CalcResult, "result" | "result_formatted" | "result_number" | "result_cents"> {
  return {
    result: formatCents(cents),
    result_formatted: currency.toUpperCase() === "MXN" ? formatMxn(cents) : formatCents(cents),
    result_number: centsToNumber(cents),
    result_cents: Number(cents),
  };
}

/**
 * Detecta si el último mensaje pide suma, total, diferencia, IVA o verificar cifras.
 * Evita disparar en «tareas en total» sin montos.
 */
export function userLastMessageRequestedArithmetic(text: string): boolean {
  const t = (text || "").trim();
  if (!t) return false;

  const hasMoney =
    /\$\s*[\d.,]+/.test(t) ||
    /\d{1,3}(?:,\d{3})+\.\d{1,2}/.test(t) ||
    /\bmontos?\b/i.test(t) ||
    /\bimportes?\b/i.test(t) ||
    /\bcifras?\b/i.test(t) ||
    /\bpartidas?\b/i.test(t) ||
    /[\d.,]+\s*[+\-×x*]\s*[\d.,]+/.test(t);

  const hasArith =
    /\b(suma|súma|sumar|sume|súmale|sumale|sumatoria|sumadas?|total(?:es)?|resta(?:r)?|reste|diferencia|promedio|media\b|iva\b|porcentaje|por\s+ciento|multiplica(?:r)?|divide|dividir|calcul[aeoó]|c[aá]lculo|verificar|verifica|cuadr(?:ar|e)|cu[aá]nto\s+(es|da|suma|resta)|desglose|recuento|combinaci[oó]n|partidas?)\b/i
      .test(t) ||
    /\b(es\s+correct[oa]|me\s+da|me\s+sale|no\s+me\s+cuadra|cu[aá]les?\s+cantidades)\b/i.test(t);

  return hasArith && hasMoney;
}

export function messageContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && "text" in block && typeof (block as { text?: unknown }).text === "string") {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("\n");
}

/** Concatena los últimos N mensajes de usuario (texto) para recuperar «esos montos». */
export function collectRecentUserTexts(
  messages: Array<{ role?: string; content?: unknown }>,
  limit = 3,
): string {
  const users: string[] = [];
  for (let i = messages.length - 1; i >= 0 && users.length < limit; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const t = messageContentToText(m.content).trim();
    if (t) users.push(t);
  }
  return users.reverse().join("\n\n");
}

const DP_TARGET_MAX_CENTS = 20_000_000; // $200,000 — tope de memoria del DP
const FIND_COMBO_MAX_ITEMS = 220;

function hitFromIndices(
  parsed: ParsedAmount[],
  labels: string[] | undefined,
  indices: number[],
  target: bigint,
): CombinationHit {
  let sum = 0n;
  const labs: string[] = [];
  const amts: string[] = [];
  const idx1: number[] = [];
  for (const i of indices) {
    sum += parsed[i].cents;
    idx1.push(i + 1);
    labs.push(labels?.[i] || `Partida ${i + 1}`);
    amts.push(formatCents(parsed[i].cents));
  }
  const diff = target - sum;
  return {
    indices: idx1,
    labels: labs,
    amounts: amts,
    sum: formatCents(sum),
    sum_formatted: formatMxn(sum),
    difference: formatCents(diff),
    difference_formatted: formatMxn(diff),
  };
}

function reconstructDp(
  used: Uint16Array,
  vals: number[],
  origIdx: number[],
  target: number,
): number[] | null {
  if (target <= 0) return [];
  const out: number[] = [];
  let t = target;
  const guard = vals.length + 2;
  let steps = 0;
  while (t > 0 && steps++ < guard) {
    const u = used[t];
    if (!u) return null;
    const vi = u - 1;
    out.push(origIdx[vi]);
    t -= vals[vi];
  }
  return t === 0 ? out.sort((a, b) => a - b) : null;
}

function dpExactAndClosest(
  parsed: ParsedAmount[],
  labels: string[] | undefined,
  targetCents: bigint,
  maxExact: number,
): { exact: CombinationHit[]; closest?: CombinationHit } {
  const target = Number(targetCents);
  const origIdx: number[] = [];
  const vals: number[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const c = Number(parsed[i].cents);
    if (c > 0 && c <= target) {
      origIdx.push(i);
      vals.push(c);
    }
  }
  const exact: CombinationHit[] = [];
  if (vals.length === 0 || target <= 0) return { exact };

  const runDp = (skip: Set<number>): { used: Uint16Array; can: Uint8Array } => {
    const can = new Uint8Array(target + 1);
    const used = new Uint16Array(target + 1);
    can[0] = 1;
    for (let i = 0; i < vals.length; i++) {
      if (skip.has(origIdx[i])) continue;
      const a = vals[i];
      for (let t = target; t >= a; t--) {
        if (can[t - a] && !can[t]) {
          can[t] = 1;
          used[t] = i + 1;
        }
      }
    }
    return { used, can };
  };

  const first = runDp(new Set());
  if (first.can[target]) {
    const idxs = reconstructDp(first.used, vals, origIdx, target);
    if (idxs) exact.push(hitFromIndices(parsed, labels, idxs, targetCents));
    for (const drop of idxs || []) {
      if (exact.length >= maxExact) break;
      const alt = runDp(new Set([drop]));
      if (!alt.can[target]) continue;
      const altIdx = reconstructDp(alt.used, vals, origIdx, target);
      if (!altIdx) continue;
      const key = altIdx.join(",");
      if (exact.some((h) => h.indices.map((n) => n - 1).join(",") === key)) continue;
      exact.push(hitFromIndices(parsed, labels, altIdx, targetCents));
    }
  }

  let closest: CombinationHit | undefined;
  if (exact.length === 0) {
    let bestT = -1;
    let bestDist = Infinity;
    for (let t = 0; t <= target; t++) {
      if (!first.can[t]) continue;
      const d = target - t;
      if (d < bestDist) {
        bestDist = d;
        bestT = t;
      }
    }
    // También un paso por encima no existe (0/1 no supera target si items > target se filtraron).
    // Buscar undershoot es suficiente; si todo cabe y suma < target, bestT = suma total reachable.
    if (bestT > 0) {
      const idxs = reconstructDp(first.used, vals, origIdx, bestT);
      if (idxs) closest = hitFromIndices(parsed, labels, idxs, targetCents);
    }
  }

  return { exact, closest };
}

function findAmountCombinations(
  parsed: ParsedAmount[],
  labels: string[] | undefined,
  targetCents: bigint,
  maxExact: number,
): { exact: CombinationHit[]; closest?: CombinationHit } {
  const n = Math.min(parsed.length, FIND_COMBO_MAX_ITEMS);
  const slice = parsed.slice(0, n);
  if (targetCents > BigInt(DP_TARGET_MAX_CENTS)) {
    return { exact: [], closest: undefined };
  }
  return dpExactAndClosest(slice, labels, targetCents, maxExact);
}

export function executeMoneyCalc(raw: CalcInput): CalcResult {
  const currency = (typeof raw.currency === "string" && raw.currency.trim()
    ? raw.currency.trim()
    : "MXN").toUpperCase();
  const opRaw = typeof raw.operation === "string" ? raw.operation.trim().toLowerCase() : "sum";
  const operation = isCalcOperation(opRaw) ? opRaw : null;

  if (!operation) {
    return {
      ok: false,
      operation: opRaw,
      currency,
      error: `operación no soportada: «${opRaw}». Usa: ${CALC_OPERATIONS.join(", ")}.`,
    };
  }

  try {
    if (operation === "expression") {
      const expr = typeof raw.expression === "string" ? raw.expression : "";
      if (!expr.trim()) {
        return { ok: false, operation, currency, error: "expression es obligatoria para operation=expression." };
      }
      const scaled = evaluateExpression(expr);
      const cents = scaledToCents(scaled);
      return {
        ok: true,
        operation,
        currency,
        ...packMoney(cents, currency),
        steps: [`Expresión: ${expr.trim()}`, `Resultado: ${formatMxn(cents)}`],
        note: "Resultado exacto (centavos). Cítalo tal cual; no lo redondees de nuevo.",
      };
    }

    const parsed = resolveAmounts(raw);
    const items = toItems(parsed, raw.labels);

    if (operation !== "iva" && parsed.length === 0) {
      return {
        ok: false,
        operation,
        currency,
        error:
          "No se recibieron montos. Pasa `amounts` (lista) o `text` con las cifras reales del usuario/adjunto. No inventes partidas.",
      };
    }

    if (operation === "sum" || operation === "average") {
      const sumCents = parsed.reduce((a, p) => a + p.cents, 0n);
      const n = BigInt(parsed.length);
      const resultCents = operation === "average" ? (n === 0n ? 0n : halfUpDiv(sumCents, n)) : sumCents;
      return {
        ok: true,
        operation,
        currency,
        count: parsed.length,
        items: parsed.length <= 80 ? items : items.slice(0, 80),
        ...packMoney(resultCents, currency),
        steps: [
          `${parsed.length} partida(s)`,
          operation === "average"
            ? `Promedio = ${formatMxn(sumCents)} / ${parsed.length} = ${formatMxn(resultCents)}`
            : `Suma = ${formatMxn(resultCents)}`,
        ],
        note: "Suma exacta en centavos. Usa este total; no recalcules de cabeza.",
      };
    }

    if (operation === "subtract" || operation === "difference") {
      if (parsed.length < 1) {
        return { ok: false, operation, currency, error: "hace falta al menos un monto." };
      }
      let cents = parsed[0].cents;
      for (let i = 1; i < parsed.length; i++) cents -= parsed[i].cents;
      return {
        ok: true,
        operation,
        currency,
        count: parsed.length,
        items,
        ...packMoney(cents, currency),
        steps: [
          parsed.length === 2
            ? `${formatMxn(parsed[0].cents)} − ${formatMxn(parsed[1].cents)} = ${formatMxn(cents)}`
            : `Primera partida menos el resto = ${formatMxn(cents)}`,
        ],
      };
    }

    if (operation === "multiply") {
      if (parsed.length < 2) {
        return { ok: false, operation, currency, error: "multiply requiere al menos 2 factores." };
      }
      let scaled = parsed[0].scaled;
      for (let i = 1; i < parsed.length; i++) {
        scaled = halfUpDiv(scaled * parsed[i].scaled, FACTOR);
      }
      const cents = scaledToCents(scaled);
      return {
        ok: true,
        operation,
        currency,
        count: parsed.length,
        items,
        ...packMoney(cents, currency),
        steps: [`Producto de ${parsed.length} factores = ${formatMxn(cents)}`],
      };
    }

    if (operation === "divide") {
      if (parsed.length < 2) {
        return { ok: false, operation, currency, error: "divide requiere dividendo y divisor." };
      }
      if (parsed[1].scaled === 0n) {
        return { ok: false, operation, currency, error: "división entre cero." };
      }
      const scaled = halfUpDiv(parsed[0].scaled * FACTOR, parsed[1].scaled);
      const cents = scaledToCents(scaled);
      return {
        ok: true,
        operation,
        currency,
        count: 2,
        items: items.slice(0, 2),
        ...packMoney(cents, currency),
        steps: [`${formatMxn(parsed[0].cents)} ÷ ${formatCents(parsed[1].cents)} = ${formatMxn(cents)}`],
      };
    }

    if (operation === "percentage") {
      if (parsed.length < 1) {
        return { ok: false, operation, currency, error: "percentage requiere un monto base." };
      }
      const rate = typeof raw.rate === "number" && Number.isFinite(raw.rate) ? raw.rate : null;
      if (rate === null) {
        return { ok: false, operation, currency, error: "percentage requiere `rate` (ej. 16 para 16%)." };
      }
      const rateScaled = parseMoneyToScaled(rate);
      // base * rate / 100  →  (base_scaled * rate_scaled) / (FACTOR * 100)
      const actual = halfUpDiv(parsed[0].scaled * rateScaled, FACTOR * 100n);
      const cents = scaledToCents(actual);
      return {
        ok: true,
        operation,
        currency,
        count: 1,
        items: items.slice(0, 1),
        ...packMoney(cents, currency),
        steps: [`${formatMxn(parsed[0].cents)} × ${rate}% = ${formatMxn(cents)}`],
      };
    }

    if (operation === "iva") {
      const rate = typeof raw.rate === "number" && Number.isFinite(raw.rate) ? raw.rate : DEFAULT_IVA_RATE;
      if (parsed.length === 0) {
        return { ok: false, operation, currency, error: "iva requiere un monto base en `amounts` o `text`." };
      }
      const baseCents = parsed.reduce((a, p) => a + p.cents, 0n);
      const rateScaled = parseMoneyToScaled(rate);
      const ivaScaled = halfUpDiv(centsToScaled(baseCents) * rateScaled, FACTOR * 100n);
      const ivaCents = scaledToCents(ivaScaled);
      const totalCents = baseCents + ivaCents;
      return {
        ok: true,
        operation,
        currency,
        count: parsed.length,
        items: parsed.length <= 80 ? items : items.slice(0, 80),
        iva_rate: rate,
        subtotal: formatCents(baseCents),
        subtotal_formatted: formatMxn(baseCents),
        iva: formatCents(ivaCents),
        iva_formatted: formatMxn(ivaCents),
        total: formatCents(totalCents),
        total_formatted: formatMxn(totalCents),
        ...packMoney(totalCents, currency),
        steps: [
          `Base: ${formatMxn(baseCents)}`,
          `IVA ${rate}%: ${formatMxn(ivaCents)}`,
          `Total: ${formatMxn(totalCents)}`,
        ],
        note: "IVA y total calculados en centavos (half-up).",
      };
    }

    if (operation === "find_combination") {
      if (parsed.length === 0) {
        return {
          ok: false,
          operation,
          currency,
          error: "find_combination requiere los montos reales (amounts/text) y `claimed_total` (objetivo).",
        };
      }
      if (raw.claimed_total === undefined || raw.claimed_total === null || raw.claimed_total === "") {
        return { ok: false, operation, currency, error: "find_combination requiere `claimed_total` (el total objetivo)." };
      }
      const targetCents = parseMoneyToCents(raw.claimed_total);
      if (targetCents <= 0n) {
        return { ok: false, operation, currency, error: "el total objetivo debe ser mayor que cero." };
      }
      const found = findAmountCombinations(parsed, raw.labels, targetCents, 3);
      const exact = found.exact;
      const closest = found.closest;
      const matches = exact.length > 0;
      const primary = matches ? exact[0] : closest;
      const primarySum = primary ? parseMoneyToCents(primary.sum) : 0n;
      return {
        ok: true,
        operation,
        currency,
        count: parsed.length,
        claimed: formatCents(targetCents),
        claimed_formatted: formatMxn(targetCents),
        matches,
        combinations: exact,
        closest: !matches ? closest : undefined,
        ...packMoney(matches ? targetCents : primarySum, currency),
        difference: closest && !matches ? closest.difference : matches ? "0.00" : undefined,
        difference_formatted: closest && !matches ? closest.difference_formatted : matches ? formatMxn(0n) : undefined,
        steps: matches
          ? [
              `Objetivo: ${formatMxn(targetCents)}`,
              `Encontré ${exact.length} combinación(es) exacta(s) entre ${parsed.length} partida(s).`,
            ]
          : [
              `Objetivo: ${formatMxn(targetCents)}`,
              `Ningún subconjunto suma exactamente ${formatMxn(targetCents)}.`,
              closest
                ? `Lo más cercano: ${closest.sum_formatted} (dif. ${closest.difference_formatted})`
                : "No hay partidas positivas para buscar.",
            ],
        note: matches
          ? "Combinación exacta en centavos. Cita estas partidas; no inventes otras."
          : "No hay combinación exacta. Reporta la más cercana y la diferencia; no fabriques partidas.",
      };
    }

    if (operation === "compare") {
      if (parsed.length === 0) {
        return {
          ok: false,
          operation,
          currency,
          error: "compare requiere los montos reales (amounts/text) y `claimed_total`.",
        };
      }
      if (raw.claimed_total === undefined || raw.claimed_total === null || raw.claimed_total === "") {
        return { ok: false, operation, currency, error: "compare requiere `claimed_total` (la cifra a verificar)." };
      }
      const sumCents = parsed.reduce((a, p) => a + p.cents, 0n);
      const claimedCents = parseMoneyToCents(raw.claimed_total);
      const diff = claimedCents - sumCents;
      const matches = diff === 0n;
      return {
        ok: true,
        operation,
        currency,
        count: parsed.length,
        items: parsed.length <= 80 ? items : items.slice(0, 80),
        ...packMoney(sumCents, currency),
        claimed: formatCents(claimedCents),
        claimed_formatted: formatMxn(claimedCents),
        difference: formatCents(diff),
        difference_formatted: formatMxn(diff),
        difference_cents: Number(diff),
        matches,
        steps: [
          `Suma real de ${parsed.length} partida(s): ${formatMxn(sumCents)}`,
          `Cifra afirmada: ${formatMxn(claimedCents)}`,
          matches
            ? "Coinciden exactamente."
            : `Diferencia (afirmada − real): ${formatMxn(diff)}`,
        ],
        note: matches
          ? "La suma es correcta."
          : "No coinciden. Reporta ambos números y la diferencia; no inventes partidas para cuadrar.",
      };
    }

    return { ok: false, operation, currency, error: "operación no implementada." };
  } catch (e) {
    return {
      ok: false,
      operation,
      currency,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export interface LineItemLike {
  quantity?: number;
  unit_price?: number;
  amount?: number;
  [k: string]: unknown;
}

export interface ReconciledDocumentMoney {
  line_items: LineItemLike[];
  subtotal: number;
  taxes?: number;
  total: number;
  corrected: boolean;
  warnings: string[];
}

/**
 * Recalcula amount = qty × precio y totales de una cotización/factura.
 * Evita que un documento salga con subtotal/total inventados.
 */
export function reconcileDocumentMoney(
  lineItems: LineItemLike[],
  taxes?: number,
): ReconciledDocumentMoney {
  const warnings: string[] = [];
  const next: LineItemLike[] = [];
  let subtotal = 0n;
  let corrected = false;

  for (const item of lineItems || []) {
    const copy: LineItemLike = { ...item };
    const hasQty = typeof item.quantity === "number" && Number.isFinite(item.quantity);
    const hasPrice = typeof item.unit_price === "number" && Number.isFinite(item.unit_price);
    let amountCents: bigint | null = null;

    if (hasQty && hasPrice) {
      const computed = scaledToCents(
        halfUpDiv(parseMoneyToScaled(item.quantity as number) * parseMoneyToScaled(item.unit_price as number), FACTOR),
      );
      amountCents = computed;
      const prev = typeof item.amount === "number" ? parseMoneyToCents(item.amount) : null;
      if (prev !== null && prev !== computed) {
        corrected = true;
        warnings.push(
          `Se corrigió amount de «${String(item.description || "partida")}»: ${formatCents(prev)} → ${formatCents(computed)}`,
        );
      }
      copy.amount = centsToNumber(computed);
    } else if (typeof item.amount === "number" && Number.isFinite(item.amount)) {
      amountCents = parseMoneyToCents(item.amount);
    } else if (typeof item.amount === "string") {
      try {
        amountCents = parseMoneyToCents(item.amount);
        copy.amount = centsToNumber(amountCents);
      } catch {
        warnings.push(`Monto ilegible en «${String(item.description || "partida")}».`);
      }
    }

    if (amountCents !== null) subtotal += amountCents;
    next.push(copy);
  }

  let taxCents = 0n;
  if (typeof taxes === "number" && Number.isFinite(taxes)) {
    taxCents = parseMoneyToCents(taxes);
  }

  const total = subtotal + taxCents;
  return {
    line_items: next,
    subtotal: centsToNumber(subtotal),
    taxes: typeof taxes === "number" && Number.isFinite(taxes) ? centsToNumber(taxCents) : undefined,
    total: centsToNumber(total),
    corrected,
    warnings,
  };
}

/** Extrae un total afirmado tipo «mi suma da $463,071.49». */
export function extractClaimedTotal(text: string): string | null {
  const m = text.match(
    /(?:dan?|sale|es|queda(?:n)?|resulta|suma(?:n|das)?|total(?:es)?|importe|objetivo)\s*(?:en\s*)?(?:de\s*)?\$?\s*([\d.,]+)/i,
  );
  return m?.[1] ? m[1] : null;
}

/**
 * Si el usuario pegó montos, calcula la suma (y compara con la cifra que afirma).
 * No usa texto del asistente: evita «verificar» partidas inventadas.
 */
export function autoVerifyUserAmounts(userText: string): CalcResult | null {
  const t = (userText || "").trim();
  if (!t) return null;

  const compact = t.replace(/mxn|usd|eur/gi, "").trim();
  if (
    compact.length <= MONEY_CALC_MAX_EXPRESSION_LEN &&
    /^[\s$\d.,+\-*/()%]+$/.test(compact) &&
    /[+\-*/]/.test(compact)
  ) {
    const expr = executeMoneyCalc({ operation: "expression", expression: compact });
    if (expr.ok) return expr;
  }

  const extracted = extractAmountsFromText(t);
  if (extracted.length < 2) return null;

  const claimed = extractClaimedTotal(t);
  // Si afirma un total y hay ≥2 montos más el total, el último $ suele ser el afirmado.
  if (claimed && extracted.length >= 2) {
    const claimedCents = (() => {
      try {
        return parseMoneyToCents(claimed);
      } catch {
        return null;
      }
    })();
    if (claimedCents !== null) {
      const withoutClaimed = extracted.filter((p) => p.cents !== claimedCents);
      const pool = withoutClaimed.length >= 2 ? withoutClaimed : extracted;
      if (pool.length >= 2) {
        return executeMoneyCalc({
          operation: "compare",
          amounts: pool.map((p) => p.raw),
          claimed_total: claimed,
        });
      }
    }
  }

  return executeMoneyCalc({
    operation: "sum",
    amounts: extracted.map((p) => p.raw),
  });
}

export function responseMentionsCents(text: string, cents: bigint): boolean {
  const found = extractAmountsFromText(text || "");
  return found.some((f) => f.cents === cents);
}

/** Texto listo para el usuario si el modelo cierra el turno sin redactar. */
export function formatCalcForUser(calc: CalcResult): string {
  if (!calc.ok) {
    return `No pude completar el cálculo exacto${calc.error ? `: ${calc.error}` : "."} Pega las partidas (o el Excel) y lo intento de nuevo.`;
  }

  if (calc.operation === "find_combination") {
    const goal = calc.claimed_formatted || calc.claimed || "";
    if (calc.matches && calc.combinations && calc.combinations.length > 0) {
      const parts = calc.combinations.map((c, i) => {
        const rows = c.labels
          .map((lab, j) => `${lab} (${c.amounts[j] ? formatMxn(parseMoneyToCents(c.amounts[j])) : ""})`)
          .join(", ");
        return i === 0
          ? `La combinación que suma exactamente **${c.sum_formatted}** es: ${rows}.`
          : `Otra combinación válida: ${rows} (${c.sum_formatted}).`;
      });
      return `Revisé las ${calc.count ?? ""} partidas contra el objetivo ${goal}. ${parts.join(" ")} Esas cifras salen de un cálculo en centavos; no hay que re-sumarlas de cabeza.`;
    }
    const near = calc.closest;
    if (near) {
      const rows = near.labels
        .map((lab, j) => `${lab} (${near.amounts[j] ? formatMxn(parseMoneyToCents(near.amounts[j])) : ""})`)
        .join(", ");
      return `Ningún subconjunto de las ${calc.count ?? ""} partidas suma exactamente **${goal}**. Lo más cercano es **${near.sum_formatted}** (diferencia ${near.difference_formatted}) con: ${rows}.`;
    }
    return `No encontré una combinación de partidas que sume **${goal}**. Si me pegas de nuevo la columna, lo vuelvo a intentar.`;
  }

  if (calc.operation === "compare") {
    if (calc.matches) {
      return `La suma de ${calc.count} partida(s) es **${calc.result_formatted}** y coincide con la cifra afirmada.`;
    }
    return `La suma exacta de ${calc.count} partida(s) es **${calc.result_formatted}**, no ${calc.claimed_formatted}. Diferencia (afirmada − real): **${calc.difference_formatted}**.`;
  }

  if (calc.operation === "iva" && calc.total_formatted) {
    return `Sobre una base de ${calc.subtotal_formatted}, el IVA ${calc.iva_rate ?? 16}% es ${calc.iva_formatted} y el total queda en **${calc.total_formatted}**.`;
  }

  const n = calc.count != null ? ` de ${calc.count} partida(s)` : "";
  return `El resultado exacto${n} es **${calc.result_formatted || calc.result}**.`;
}

export function buildArithmeticCorrectionFooter(calc: CalcResult): string {
  if (!calc.ok) return "";
  if (calc.operation === "compare") {
    if (calc.matches) {
      return `\n\n**Cálculo verificado:** la suma de ${calc.count} partida(s) es **${calc.result_formatted}**. Coincide con la cifra afirmada.`;
    }
    return (
      `\n\n**Corrección automática:** la suma exacta de ${calc.count} partida(s) es **${calc.result_formatted}**, ` +
      `no ${calc.claimed_formatted}. Diferencia (afirmada − real): **${calc.difference_formatted}**.`
    );
  }
  return `\n\n**Cálculo verificado:** ${calc.count ?? ""} partida(s) suman **${calc.result_formatted}**. Usa esta cifra si alguna anterior no coincide.`;
}
