import { describe, expect, it } from "vitest";
import { parseCsfText } from "@/lib/juun/csfParser";

const sensoryMattersCsf = `
CONSTANCIA DE SITUACIÓN FISCAL
Datos de Identificación del Contribuyente:
RFC: SMA2603253P7
Denominación/Razón Social: SENSORY MATTERS
Régimen Capital: SOCIEDAD ANONIMA DE CAPITAL VARIABLE
Nombre Comercial: SENSORY MATTERS
Fecha inicio de operaciones: 25 DE MARZO DE 2026
Datos del domicilio registrado
Código Postal:72410 Tipo de Vialidad: CERRADA (CDA) O PRIVADA (PRIV)
Regímenes:
Régimen Fecha Inicio Fecha Fin
Régimen General de Ley Personas Morales 25/03/2026
Obligaciones:
`;

describe("parseCsfText", () => {
  it("extrae los datos fiscales de la CSF de referencia", () => {
    expect(parseCsfText(sensoryMattersCsf)).toEqual({
      rfc: "SMA2603253P7",
      razon_social: "SENSORY MATTERS",
      cp_fiscal: "72410",
      regimen_fiscal: "601",
    });
  });

  it("reconoce un régimen por clave cuando la CSF la incluye", () => {
    const text = sensoryMattersCsf.replace(
      "Régimen General de Ley Personas Morales 25/03/2026",
      "626 Régimen Simplificado de Confianza 25/03/2026"
    );
    expect(parseCsfText(text).regimen_fiscal).toBe("626");
  });

  it("devuelve solo los campos encontrados sin inventar valores", () => {
    expect(parseCsfText("Documento ilegible Código Postal: 06600")).toEqual({ cp_fiscal: "06600" });
  });

  it("tolera etiquetas sin acentos y espacios adicionales", () => {
    const text = sensoryMattersCsf
      .replace("Denominación/Razón Social:", "Denominacion/Razon Social:   ")
      .replace("Código Postal:72410", "Codigo Postal: 72410");
    expect(parseCsfText(text)).toMatchObject({ razon_social: "SENSORY MATTERS", cp_fiscal: "72410" });
  });
});
