import { describe, it, expect } from "vitest";
import {
  esCpValido,
  esRfcGenerico,
  esRfcValido,
  normalizarRfc,
  tipoPersonaPorRfc,
  validarRfc,
} from "@/lib/juun/rfc";

describe("normalizarRfc", () => {
  it("quita espacios, guiones y puntos, y sube a mayúsculas", () => {
    expect(normalizarRfc(" kaco-850315.j28 ")).toBe("KACO850315J28");
  });
  it("tolera null", () => {
    expect(normalizarRfc(null)).toBe("");
  });
});

describe("validarRfc", () => {
  it("acepta persona moral de 12", () => {
    const r = validarRfc("ABC850315J28");
    expect(r.valido).toBe(true);
    expect(r.tipoPersona).toBe("moral");
  });

  it("acepta persona física de 13", () => {
    const r = validarRfc("KACO850315J28");
    expect(r.valido).toBe(true);
    expect(r.tipoPersona).toBe("fisica");
  });

  it("acepta el ampersand y la eñe en la razón social abreviada", () => {
    expect(esRfcValido("A&N850315J28")).toBe(true);
    expect(esRfcValido("ÑUÑO850315J28")).toBe(true);
  });

  it("rechaza longitudes que no son 12 ni 13", () => {
    expect(validarRfc("ABC123").valido).toBe(false);
    expect(validarRfc("ABCD850315J289").valido).toBe(false);
  });

  it("rechaza fechas que no existen dentro del RFC", () => {
    expect(validarRfc("KACO851301J28").valido).toBe(false); // mes 13
    expect(validarRfc("KACO850230J28").valido).toBe(false); // 30 de febrero
    expect(validarRfc("KACO850100J28").valido).toBe(false); // día 0
  });

  it("acepta 29 de febrero porque el RFC no lleva siglo", () => {
    expect(esRfcValido("KACO960229J28")).toBe(true);
  });

  it("rechaza homoclave con caracteres raros", () => {
    expect(validarRfc("KACO850315J2-").valido).toBe(false);
  });

  it("rechaza el RFC genérico de público en general con un mensaje que lo explica", () => {
    const r = validarRfc("XAXX010101000");
    expect(r.valido).toBe(false);
    expect(r.error).toMatch(/genérico/i);
    expect(esRfcGenerico("xaxx010101000")).toBe(true);
  });

  it("pide el RFC cuando viene vacío", () => {
    expect(validarRfc("").error).toMatch(/Captura el RFC/);
  });
});

describe("tipoPersonaPorRfc", () => {
  it("distingue por longitud", () => {
    expect(tipoPersonaPorRfc("ABC850315J28")).toBe("moral");
    expect(tipoPersonaPorRfc("KACO850315J28")).toBe("fisica");
    expect(tipoPersonaPorRfc("ABC")).toBeNull();
  });
});

describe("esCpValido", () => {
  it("exige exactamente 5 dígitos", () => {
    expect(esCpValido("06600")).toBe(true);
    expect(esCpValido("6600")).toBe(false);
    expect(esCpValido("066001")).toBe(false);
    expect(esCpValido("0660A")).toBe(false);
  });
});
