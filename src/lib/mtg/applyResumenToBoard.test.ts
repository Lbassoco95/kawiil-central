import { describe, expect, it } from "vitest";
import { extractResumenLines } from "./applyResumenToBoard";

describe("applyResumenToBoard", () => {
  it("extrae líneas útiles del resumen Sylon", () => {
    const raw = `
Resumen junta Grupo Sylon · 1 de octubre de 2026
Lo que se cerró
Reporte de Hallazgos S1 2026 — Rivium — Enviado; Gonzalo confirmó.
En curso
INE — verificación de datos de la credencial — Abierto y en tiempo
Para acordar hoy
☐ Confirmar el 10-nov
`;
    const lines = extractResumenLines(raw);
    expect(lines.some((l) => /Hallazgos/i.test(l))).toBe(true);
    expect(lines.some((l) => /INE/i.test(l))).toBe(true);
    expect(lines.every((l) => !/^Lo que se/i.test(l))).toBe(true);
  });
});
