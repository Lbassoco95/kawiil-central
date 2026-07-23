import { describe, expect, it } from "vitest";
// La lógica pura del Conmutador vive en supabase/functions/_shared para que las
// Edge Functions (Deno) y estas pruebas (vitest) compartan una única fuente.
import {
  CELULAS,
  detectUrgencyCriteria,
  esPagoOCobranza,
  formatFolio,
  isCelula,
  parseClassifyResponse,
  rutaFromUrgencia,
  severityEmoji,
} from "../../supabase/functions/_shared/conmutador";

describe("formatFolio", () => {
  it("formatea KAW-AAAA-XXXX con padding a 4 dígitos", () => {
    expect(formatFolio(2026, 1)).toBe("KAW-2026-0001");
    expect(formatFolio(2026, 42)).toBe("KAW-2026-0042");
    expect(formatFolio(2026, 12345)).toBe("KAW-2026-12345");
  });
});

describe("severityEmoji / rutaFromUrgencia", () => {
  it("mapea el nivel a 🔴/🟡/🟢", () => {
    expect(severityEmoji("urgent")).toBe("🔴");
    expect(severityEmoji("medium")).toBe("🟡");
    expect(severityEmoji("standard")).toBe("🟢");
  });
  it("urgente → ruta urgente; resto → estándar", () => {
    expect(rutaFromUrgencia("urgent")).toBe("urgente");
    expect(rutaFromUrgencia("medium")).toBe("estandar");
    expect(rutaFromUrgencia("standard")).toBe("estandar");
  });
});

describe("isCelula", () => {
  it("acepta los 5 códigos y rechaza el resto", () => {
    for (const c of CELULAS) expect(isCelula(c)).toBe(true);
    expect(isCelula("FIN")).toBe(false);
    expect(isCelula("")).toBe(false);
    expect(isCelula(null)).toBe(false);
  });
});

describe("detectUrgencyCriteria — 4 criterios por separado", () => {
  it("(1) audiencia/diligencia en <48h", () => {
    expect(detectUrgencyCriteria("Tengo una audiencia mañana")).toContain("audiencia_48h");
    expect(detectUrgencyCriteria("comparecencia hoy por la tarde")).toContain("audiencia_48h");
    // audiencia sin marca temporal cercana NO dispara este criterio
    expect(detectUrgencyCriteria("tengo una audiencia el próximo mes")).not.toContain(
      "audiencia_48h",
    );
  });

  it("(2) persona detenida/bajo custodia", () => {
    expect(detectUrgencyCriteria("mi socio está detenido")).toContain("persona_detenida");
    expect(detectUrgencyCriteria("lo tienen bajo custodia")).toContain("persona_detenida");
    expect(detectUrgencyCriteria("está arrestada en el MP")).toContain("persona_detenida");
  });

  it("(3) requerimiento de autoridad (documento + autoridad)", () => {
    expect(detectUrgencyCriteria("recibí un oficio del SAT")).toContain(
      "requerimiento_autoridad",
    );
    expect(detectUrgencyCriteria("me llegó una notificación del juzgado")).toContain(
      "requerimiento_autoridad",
    );
    // documento sin autoridad no basta
    expect(detectUrgencyCriteria("tengo un oficio interno")).not.toContain(
      "requerimiento_autoridad",
    );
  });

  it("(4) lenguaje de urgencia del llamante", () => {
    expect(detectUrgencyCriteria("es urgente, no puede esperar")).toContain("lenguaje_urgencia");
    expect(detectUrgencyCriteria("necesito ayuda de inmediato")).toContain("lenguaje_urgencia");
  });

  it("motivo tranquilo no activa ningún criterio", () => {
    expect(detectUrgencyCriteria("quería consultar sobre una factura del mes pasado")).toEqual(
      [],
    );
  });
});

describe("parseClassifyResponse", () => {
  it("extrae JSON incluso envuelto en texto/backticks", () => {
    const r = parseClassifyResponse('```json\n{"celula":"LIT","confidence":0.9,' +
      '"needs_disambiguation":false,"pregunta_sugerida":null}\n```');
    expect(r.celula).toBe("LIT");
    expect(r.needs_disambiguation).toBe(false);
  });
  it("célula inválida ⇒ needs_disambiguation", () => {
    const r = parseClassifyResponse('{"celula":"XXX"}');
    expect(r.celula).toBeNull();
    expect(r.needs_disambiguation).toBe(true);
  });
  it("respuesta no-JSON ⇒ fallback seguro", () => {
    const r = parseClassifyResponse("no tengo idea");
    expect(r.celula).toBeNull();
    expect(r.needs_disambiguation).toBe(true);
    expect(r.pregunta_sugerida).toBeTruthy();
  });
});

describe("esPagoOCobranza (integración Finanzas)", () => {
  it("detecta motivos de pago/cobranza", () => {
    expect(esPagoOCobranza("quiero aclarar el pago de mis honorarios")).toBe(true);
    expect(esPagoOCobranza("tengo un saldo vencido")).toBe(true);
    expect(esPagoOCobranza("necesito una aclaración de una audiencia")).toBe(false);
  });
});
