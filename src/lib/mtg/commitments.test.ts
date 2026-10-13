import { describe, expect, it } from "vitest";
import { matchProfileByName, parseCommitments } from "./commitments";

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
