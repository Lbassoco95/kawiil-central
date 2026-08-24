import { describe, it, expect } from "vitest";
import {
  AVISO_CSF,
  TAX_PROFILE_DEFAULTS,
  avisoPersonaVsRegimen,
  taxProfileSchema,
} from "@/lib/juun/taxProfileSchema";

const valido = {
  rfc: "KACO850315J28",
  razon_social: "Kawiil Consultores SA de CV",
  cp_fiscal: "06600",
  regimen_fiscal: "612",
  uso_cfdi_default: "G03",
  email_recepcion: "",
};

describe("taxProfileSchema", () => {
  it("acepta un perfil bien capturado", () => {
    expect(taxProfileSchema.safeParse(valido).success).toBe(true);
  });

  it("rechaza RFC inválido con el mensaje del validador", () => {
    const r = taxProfileSchema.safeParse({ ...valido, rfc: "ABC123" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/12 para persona moral/);
  });

  it("rechaza CP que no son 5 dígitos", () => {
    expect(taxProfileSchema.safeParse({ ...valido, cp_fiscal: "6600" }).success).toBe(false);
  });

  it("rechaza razón social vacía", () => {
    expect(taxProfileSchema.safeParse({ ...valido, razon_social: "   " }).success).toBe(false);
  });

  it("rechaza régimen y uso fuera de catálogo", () => {
    expect(taxProfileSchema.safeParse({ ...valido, regimen_fiscal: "699" }).success).toBe(false);
    expect(taxProfileSchema.safeParse({ ...valido, uso_cfdi_default: "G99" }).success).toBe(false);
  });

  it("acepta correo vacío pero no uno mal escrito", () => {
    expect(taxProfileSchema.safeParse({ ...valido, email_recepcion: "" }).success).toBe(true);
    expect(taxProfileSchema.safeParse({ ...valido, email_recepcion: "no-es-correo" }).success).toBe(false);
  });

  it("el default trae G03 y lo demás vacío", () => {
    expect(TAX_PROFILE_DEFAULTS.uso_cfdi_default).toBe("G03");
    expect(TAX_PROFILE_DEFAULTS.rfc).toBe("");
  });
});

describe("avisoPersonaVsRegimen", () => {
  it("avisa si el RFC es de persona física y el régimen de morales", () => {
    expect(avisoPersonaVsRegimen("KACO850315J28", "601")).toMatch(/persona física/);
  });

  it("avisa al revés también", () => {
    expect(avisoPersonaVsRegimen("ABC850315J28", "612")).toMatch(/persona moral/);
  });

  it("calla cuando coinciden", () => {
    expect(avisoPersonaVsRegimen("KACO850315J28", "612")).toBeNull();
    expect(avisoPersonaVsRegimen("ABC850315J28", "601")).toBeNull();
  });

  it("calla en regímenes que aplican a ambas personas", () => {
    expect(avisoPersonaVsRegimen("KACO850315J28", "626")).toBeNull();
    expect(avisoPersonaVsRegimen("ABC850315J28", "626")).toBeNull();
  });

  it("calla si falta información", () => {
    expect(avisoPersonaVsRegimen("", "601")).toBeNull();
    expect(avisoPersonaVsRegimen("KACO850315J28", "")).toBeNull();
  });
});

describe("aviso de la CSF", () => {
  it("dice exactamente por qué importa la coincidencia exacta", () => {
    expect(AVISO_CSF).toMatch(/coincidir exactamente/);
    expect(AVISO_CSF).toMatch(/rechace la factura/);
  });
});
