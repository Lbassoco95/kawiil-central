import { describe, expect, it } from "vitest";
import { hastaPara, PLAZO_OMISION, PLAZOS } from "@/portal/lib/retention";

describe("plazo de resguardo en la pantalla de baja (B1)", () => {
  it("solo hay dos opciones y cinco es la omisión", () => {
    expect([...PLAZOS]).toEqual([5, 10]);
    expect(PLAZO_OMISION).toBe(5);
  });
  it("muestra la fecha de la opción elegida cuando la persona elige", () => {
    const cfdi = { elige: true, anios: 5, hasta: "2031-09-29", hasta_por_opcion: { "5": "2031-09-29", "10": "2036-09-29" }, anios_por_opcion: { "5": 5, "10": 10 } };
    expect(hastaPara(cfdi, 5)).toEqual({ anios: 5, hasta: "2031-09-29" });
    expect(hastaPara(cfdi, 10)).toEqual({ anios: 10, hasta: "2036-09-29" });
  });
  it("si el dato no depende de la elección, muestra el plazo fijo", () => {
    const fijo = { elige: false, anios: 5, hasta: "2031-09-29" };
    expect(hastaPara(fijo, 10)).toEqual({ anios: 5, hasta: "2031-09-29" });
  });
  it("las constancias nunca bajan del plazo de una empresa premier a la que pertenece", () => {
    const acc = { elige: true, anios: 10, hasta: "2036-09-29", hasta_por_opcion: { "5": "2036-09-29", "10": "2036-09-29" }, anios_por_opcion: { "5": 10, "10": 10 } };
    expect(hastaPara(acc, 5)).toEqual({ anios: 10, hasta: "2036-09-29" });
  });
});

describe("fecha exacta de fin del resguardo", () => {
  it("una fecha sin hora no se corre un día por la zona horaria", async () => {
    const { fmtDate } = await import("@/portal/lib/format");
    expect(fmtDate("2031-09-29")).toBe("29/09/2031");
    expect(fmtDate("2036-01-01")).toBe("01/01/2036");
  });
});
