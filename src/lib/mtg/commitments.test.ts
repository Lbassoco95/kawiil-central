import { describe, expect, it } from "vitest";
import { matchProfileByName, parseCommitments, resolveRelativeDate } from "./commitments";

const MD = `## Puntos más importantes
- algo

## Compromisos y fechas
- Hacer un contrato por todos los préstamos. _(ref. 00:01:11)_
- Enviar el corte del 1 al 12 de octubre para revisar facturación. _(Fecha: 2026-10-12 · ref. 00:47:42)_
- Confirmar con MyCG. _(Responsable: Lupita · Fecha: el viernes)_

## Notas relevantes
- otra cosa`;

describe("parseCommitments", () => {
  it("lee compromisos con responsable, fecha y referencia", () => {
    const c = parseCommitments(MD);
    expect(c).toHaveLength(3);
    expect(c[0]).toMatchObject({ text: "Hacer un contrato por todos los préstamos.", owner: null, dueDate: null, ref: "00:01:11" });
    expect(c[1]).toMatchObject({ dueDate: "2026-10-12", ref: "00:47:42" });
    expect(c[2]).toMatchObject({ owner: "Lupita", dueDate: null, dueHint: "el viernes" });
  });
  it("devuelve [] sin sección o con (ninguno)", () => {
    expect(parseCommitments("# x")).toEqual([]);
    expect(parseCommitments("## Compromisos y fechas\n- (ninguno)")).toEqual([]);
  });
});

describe("matchProfileByName", () => {
  const ps = [{ full_name: "Leopoldo Bassoco" }, { full_name: "Lorena Sandoval" }, { full_name: "Carlos Hernández" }, { full_name: "Carlos Olivares" }];
  it("coincide por nombre completo o único nombre de pila", () => {
    expect(matchProfileByName(ps, "Leopoldo Bassoco")).toBe(ps[0]);
    expect(matchProfileByName(ps, "Lorena")).toBe(ps[1]);
  });
  it("no adivina si hay ambigüedad o no existe", () => {
    expect(matchProfileByName(ps, "Carlos")).toBeUndefined();
    expect(matchProfileByName(ps, "Viridiana Garcia")).toBeUndefined();
    expect(matchProfileByName(ps, null)).toBeUndefined();
  });
});

describe("resolveRelativeDate", () => {
  // 2026-10-20 es martes
  const REF = "2026-10-20";
  it("resuelve plazos relativos contra la fecha de la junta", () => {
    expect(resolveRelativeDate("mañana", REF)).toBe("2026-10-21");
    expect(resolveRelativeDate("pasado mañana", REF)).toBe("2026-10-22");
    expect(resolveRelativeDate("en 3 días", REF)).toBe("2026-10-23");
    expect(resolveRelativeDate("la próxima semana", REF)).toBe("2026-10-27");
    expect(resolveRelativeDate("fin de mes", REF)).toBe("2026-10-31");
  });
  it("días de la semana apuntan a la próxima ocurrencia", () => {
    expect(resolveRelativeDate("el viernes", REF)).toBe("2026-10-23");
    expect(resolveRelativeDate("este miércoles", REF)).toBe("2026-10-21");
    expect(resolveRelativeDate("el martes", REF)).toBe("2026-10-27");
  });
  it("fechas con día y mes, sin acentos y rodando de año", () => {
    expect(resolveRelativeDate("15 de noviembre", REF)).toBe("2026-11-15");
    expect(resolveRelativeDate("el 5 de enero", REF)).toBe("2027-01-05");
  });
  it("devuelve null si no se entiende", () => {
    expect(resolveRelativeDate("cuando se pueda", REF)).toBeNull();
    expect(resolveRelativeDate(null, REF)).toBeNull();
  });
  it("parseCommitments usa la fecha de la junta si se le pasa", () => {
    const c = parseCommitments(MD, REF);
    expect(c[2]).toMatchObject({ owner: "Lupita", dueDate: "2026-10-23", dueHint: "el viernes" });
    expect(c[0].dueDate).toBeNull();
  });
});

describe("matchProfileByName con acentos", () => {
  it("ignora acentos y mayúsculas", () => {
    const ps = [{ full_name: "Carlos Hernández" }, { full_name: "Lorena Sandoval" }];
    expect(matchProfileByName(ps, "carlos hernandez")).toBe(ps[0]);
  });
});
