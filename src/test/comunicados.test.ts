import { describe, it, expect, afterEach, vi } from "vitest";
import {
  avisosAlEntrar, claveVisto, esFechaValida, esVigente, etiquetaEstado, extraerPropuesta, hoyCDMX, leerVistos, marcarVistos, textoVigencia, validarPropuesta,
  type Comunicado,
} from "@/lib/comunicados";

const c = (o: Partial<Comunicado> = {}): Comunicado => ({
  id: "c1", title: "Aviso", body: "Texto", is_pinned: false, created_at: "2026-11-10T12:00:00Z", estado: "publicado", origen: "agente",
  vigente_desde: "2026-11-13", vigente_hasta: "2026-11-16", avisar_al_entrar: true, aprobado_at: "2026-11-12T12:00:00Z", ...o,
});

describe("hoy en Ciudad de México", () => {
  it("usa la fecha de México, no la del navegador (UTC−6)", () => {
    expect(hoyCDMX(new Date("2026-11-16T06:00:00Z"))).toBe("2026-11-16");   // 00:00 en México
    expect(hoyCDMX(new Date("2026-11-16T05:59:00Z"))).toBe("2026-11-15");   // 23:59 del día anterior en México
    expect(hoyCDMX(new Date("2026-11-17T04:30:00Z"))).toBe("2026-11-16");   // todavía es lunes 16 en México
  });
  it("esFechaValida rechaza fechas que no existen y formatos raros", () => {
    expect(esFechaValida("2026-11-16")).toBe(true); expect(esFechaValida("2028-02-29")).toBe(true);
    for (const mala of ["2026-02-31", "2026-13-01", "2026-11-1", "16/11/2026", "", null, 20261116, undefined]) expect(esFechaValida(mala)).toBe(false);
  });
});

describe("vigencia y aviso al entrar", () => {
  it("esVigente: incluye el primer y el último día y exige publicado y vigencia completa", () => {
    expect(esVigente(c(), "2026-11-13")).toBe(true); expect(esVigente(c(), "2026-11-16")).toBe(true);
    expect(esVigente(c(), "2026-11-12")).toBe(false); expect(esVigente(c(), "2026-11-17")).toBe(false);
    expect(esVigente(c({ estado: "borrador" }), "2026-11-14")).toBe(false); expect(esVigente(c({ estado: "archivado" }), "2026-11-14")).toBe(false);
    expect(esVigente(c({ vigente_desde: null, vigente_hasta: null }), "2026-11-14")).toBe(false);
    expect(esVigente(c({ estado: undefined }), "2026-11-14")).toBe(true); // lo anterior a la migración se considera publicado
  });
  it("avisosAlEntrar: solo publicados, vigentes, con «avisar al entrar» y que no se hayan visto hoy", () => {
    const lista = [c({ id: "ok" }), c({ id: "borrador", estado: "borrador" }), c({ id: "archivado", estado: "archivado" }), c({ id: "sin-aviso", avisar_al_entrar: false }),
      c({ id: "vencido", vigente_hasta: "2026-11-15" }), c({ id: "futuro", vigente_desde: "2026-11-17", vigente_hasta: "2026-11-18" }), c({ id: "visto" })];
    expect(avisosAlEntrar(lista, "2026-11-16", new Set()).map((x) => x.id).sort()).toEqual(["ok", "visto"]);
    expect(avisosAlEntrar(lista, "2026-11-16", new Set([claveVisto("visto", "2026-11-16")])).map((x) => x.id)).toEqual(["ok"]);
    expect(avisosAlEntrar(lista, "2026-11-16", new Set([claveVisto("visto", "2026-11-15")])).map((x) => x.id).sort()).toEqual(["ok", "visto"]); // lo de ayer no cuenta
  });
  it("los fijados van primero y luego el más reciente", () => {
    const l = [c({ id: "viejo", created_at: "2026-11-01T00:00:00Z" }), c({ id: "nuevo", created_at: "2026-11-09T00:00:00Z" }), c({ id: "fijado", is_pinned: true, created_at: "2026-10-01T00:00:00Z" })];
    expect(avisosAlEntrar(l, "2026-11-14", new Set()).map((x) => x.id)).toEqual(["fijado", "nuevo", "viejo"]);
  });
});

describe("lo ya visto (almacenamiento del navegador)", () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
  it("recuerda lo visto hoy, acumula y olvida lo de otros días", () => {
    marcarVistos(["a"], "2026-11-15"); marcarVistos(["b"], "2026-11-16"); marcarVistos(["c"], "2026-11-16");
    expect([...leerVistos("2026-11-16")].sort()).toEqual(["b:2026-11-16", "c:2026-11-16"]);
    expect(leerVistos("2026-11-15").size).toBe(0);
  });
  it("si el navegador no deja guardar o lo guardado está dañado, no truena: simplemente no hay nada visto", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("bloqueado"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("bloqueado"); });
    expect(leerVistos("2026-11-16").size).toBe(0); expect(() => marcarVistos(["a"], "2026-11-16")).not.toThrow();
    vi.restoreAllMocks(); localStorage.setItem("kawiil:avisos-vistos", "{no es json"); expect(leerVistos("2026-11-16").size).toBe(0);
    localStorage.setItem("kawiil:avisos-vistos", JSON.stringify({ x: 1 })); expect(leerVistos("2026-11-16").size).toBe(0);
  });
});

describe("textos legibles", () => {
  it("fechas en español de México", () => {
    expect(textoVigencia("2026-11-16", "2026-11-16")).toBe("lunes 16 de noviembre de 2026");
    expect(textoVigencia("2026-11-16", "2026-11-18")).toBe("del lunes 16 al miércoles 18 de noviembre de 2026");
    expect(textoVigencia("2026-11-30", "2026-12-02")).toBe("del lunes 30 de noviembre de 2026 al miércoles 2 de diciembre de 2026");
    expect(textoVigencia(null, null)).toBe(""); expect(textoVigencia("2026-02-31", "2026-03-01")).toBe("");
  });
  it("etiqueta de estado", () => {
    expect(etiquetaEstado(c({ estado: "borrador" }))).toEqual({ texto: "Borrador: espera tu aprobación", tono: "amarillo" });
    expect(etiquetaEstado(c({ estado: "archivado" })).tono).toBe("gris");
    expect(etiquetaEstado(c()).texto).toContain("agente"); expect(etiquetaEstado(c({ origen: "persona" }))).toEqual({ texto: "Publicado", tono: "verde" });
  });
});

describe("propuesta del agente", () => {
  const buena = { titulo: "Lunes 16 no se trabaja", mensaje: "El lunes 16 de noviembre es día de descanso.", vigente_desde: "2026-11-13", vigente_hasta: "2026-11-16", avisar_al_entrar: true };
  it("acepta una propuesta completa y limpia el texto", () => {
    expect(validarPropuesta(buena)).toEqual(buena);
    expect(validarPropuesta({ ...buena, titulo: "  Hola\u0000 " })?.titulo).toBe("Hola");
    expect(validarPropuesta({ titulo: "Sin fechas", mensaje: "x" })).toEqual({ titulo: "Sin fechas", mensaje: "x", vigente_desde: null, vigente_hasta: null, avisar_al_entrar: false });
  });
  it("rechaza lo que la base rechazaría: título o mensaje vacíos o largos, fechas incompletas, inválidas o invertidas, más de un año, avisar sin fechas, tipos raros", () => {
    const malas: unknown[] = [null, [], "texto", 5, {}, { ...buena, titulo: "" }, { ...buena, titulo: "x".repeat(201) }, { ...buena, mensaje: "  " }, { ...buena, mensaje: "x".repeat(4001) },
      { ...buena, vigente_hasta: null }, { ...buena, vigente_desde: null }, { ...buena, vigente_desde: "2026-02-31" }, { ...buena, vigente_desde: "2026-11-17", vigente_hasta: "2026-11-16" },
      { ...buena, vigente_desde: "2026-01-01", vigente_hasta: "2027-06-01" }, { ...buena, vigente_desde: null, vigente_hasta: null }, { ...buena, avisar_al_entrar: "si" }, { ...buena, titulo: 5 }];
    for (const m of malas) expect(validarPropuesta(m), JSON.stringify(m)).toBeNull();
  });
  it("extrae el bloque ```comunicado de la respuesta y no lo deja crudo en el texto", () => {
    const r = extraerPropuesta("Te dejo el borrador:\n\n```comunicado\n" + JSON.stringify(buena) + "\n```\n\nSi quieres cambio algo.");
    expect(r.propuesta).toEqual(buena); expect(r.invalida).toBe(false); expect(r.texto).toBe("Te dejo el borrador:\n\nSi quieres cambio algo."); expect(r.texto).not.toContain("```");
  });
  it("sin bloque, no hay propuesta ni error; con bloque dañado o inválido, se avisa que es inválida y no se muestra el JSON", () => {
    expect(extraerPropuesta("Solo texto")).toEqual({ texto: "Solo texto", propuesta: null, invalida: false });
    for (const bloque of ["{roto", JSON.stringify({ ...buena, vigente_hasta: "2020-01-01" }), "[]"]) {
      const r = extraerPropuesta("Aquí va:\n```comunicado\n" + bloque + "\n```");
      expect(r.propuesta).toBeNull(); expect(r.invalida).toBe(true); expect(r.texto).toBe("Aquí va:");
    }
  });
  it("con varios bloques toma el primero; el HTML dentro del mensaje queda como texto (no se interpreta aquí)", () => {
    const otra = { ...buena, titulo: "Segundo" };
    const r = extraerPropuesta("```comunicado\n" + JSON.stringify({ ...buena, mensaje: "<img src=x onerror=alert(1)>" }) + "\n```\n```comunicado\n" + JSON.stringify(otra) + "\n```");
    expect(r.propuesta?.titulo).toBe(buena.titulo); expect(r.propuesta?.mensaje).toBe("<img src=x onerror=alert(1)>");
  });
});
