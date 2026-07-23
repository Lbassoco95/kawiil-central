import { describe, expect, it } from "vitest";
// La lógica pura del Conmutador vive en supabase/functions/_shared para que las
// Edge Functions (Deno) y estas pruebas (vitest) compartan una única fuente.
import {
  buildBriefText,
  CELULAS,
  detectUrgencyCriteria,
  esPagoOCobranza,
  filterDirectoryByName,
  formatFolio,
  isCelula,
  parseClassifyResponse,
  quickClassify,
  rutaFromUrgencia,
  severityEmoji,
  taskPriorityFromUrgencia,
  urgenciaFromFlags,
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

describe("quickClassify (fast-path determinista)", () => {
  it("clasifica motivos inequívocos sin modelo", () => {
    expect(quickClassify("tengo una audiencia y un amparo")).toBe("LIT");
    expect(quickClassify("quiero constituir una sociedad")).toBe("CORP");
    expect(quickClassify("una auditoría de PLD")).toBe("COMP");
    expect(quickClassify("me llegó un requerimiento del SAT sobre mi declaración")).toBe("CONT");
    expect(quickClassify("quiero digitalizar un proceso interno")).toBe("PROC");
  });
  it("devuelve null cuando es ambiguo o sin señal (→ cae a Haiku)", () => {
    expect(quickClassify("tengo una duda general")).toBeNull();
    expect(quickClassify("")).toBeNull();
    // Empate entre dos células → null (no adivina)
    expect(quickClassify("un contrato con una demanda de por medio")).toBeNull();
  });
});

describe("urgenciaFromFlags / taskPriorityFromUrgencia", () => {
  it("mapea el flag a nivel y prioridad", () => {
    expect(urgenciaFromFlags(true)).toBe("urgent");
    expect(urgenciaFromFlags(false)).toBe("standard");
    expect(taskPriorityFromUrgencia("urgent")).toBe("urgente");
    expect(taskPriorityFromUrgencia("medium")).toBe("alta");
    expect(taskPriorityFromUrgencia("standard")).toBe("media");
  });
});

describe("buildBriefText", () => {
  it("incluye emoji, folio, célula, contacto y enlaces", () => {
    const brief = buildBriefText({
      urgencia: "standard",
      folio: "KAW-2026-0007",
      celula: "CONT",
      llamante: "Juan Pérez",
      empresa: "ACME SA",
      telefono: "+525512345678",
      correo: "juan@acme.mx",
      motivoResumen: "Consulta sobre una factura del mes pasado.",
      transcriptUrl: "https://t/1",
      recordingUrl: "https://r/1",
      carteraEstado: "vencido",
    });
    expect(brief).toContain("🟢");
    expect(brief).toContain("Folio KAW-2026-0007");
    expect(brief).toContain("CONT · Contable/Fiscal");
    expect(brief).toContain("Juan Pérez — ACME SA");
    expect(brief).toContain("⚠️ Vencido");
    expect(brief).toContain("https://t/1");
  });

  it("marca en rojo la transferencia urgente fallida", () => {
    const brief = buildBriefText({
      urgencia: "urgent",
      folio: "KAW-2026-0008",
      celula: "LIT",
      motivoResumen: "Detención en curso.",
      transferenciaFallida: true,
    });
    expect(brief).toContain("🔴");
    expect(brief).toContain("NO conectó en 15s");
  });
});

describe("filterDirectoryByName (extensiones)", () => {
  const dir = [
    { nombre: "Juan Pérez", extension: "101" },
    { nombre: "Juan Ramírez", extension: "102" },
    { nombre: "Ana López", extension: "103" },
    { nombre: null, extension: "104" },
  ];
  it("un solo match por nombre completo", () => {
    const r = filterDirectoryByName(dir, "Ana López");
    expect(r).toHaveLength(1);
    expect(r[0].extension).toBe("103");
  });
  it("varios matches (homónimos) → desambiguación", () => {
    const r = filterDirectoryByName(dir, "Juan");
    expect(r.map((x) => x.extension).sort()).toEqual(["101", "102"]);
  });
  it("tokens en cualquier orden, sin acentos", () => {
    const r = filterDirectoryByName(dir, "perez juan");
    expect(r).toHaveLength(1);
    expect(r[0].extension).toBe("101");
  });
  it("sin coincidencia → vacío; ignora entradas sin nombre", () => {
    expect(filterDirectoryByName(dir, "Zavala")).toEqual([]);
    expect(filterDirectoryByName(dir, "")).toEqual([]);
  });
});

describe("esPagoOCobranza (integración Finanzas)", () => {
  it("detecta motivos de pago/cobranza", () => {
    expect(esPagoOCobranza("quiero aclarar el pago de mis honorarios")).toBe(true);
    expect(esPagoOCobranza("tengo un saldo vencido")).toBe(true);
    expect(esPagoOCobranza("necesito una aclaración de una audiencia")).toBe(false);
  });
});
