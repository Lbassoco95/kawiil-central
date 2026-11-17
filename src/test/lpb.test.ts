import { describe, expect, it } from "vitest";
import { FILTROS, MAX_REVISION, aCsv, busquedaSegura, celdaCsv, validarListar, validarRevision, type PersonaLpb } from "../../supabase/functions/_shared/lpb";

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const persona = (o: Partial<PersonaLpb> = {}): PersonaLpb => ({ id: U1, nombre: "ANA PÉREZ", rfc: "PEAA800101AB1", rfc_dudoso: false, tipo_persona: "fisica", estado: "vigente", fecha_alta: "2026-03-06", fecha_baja: null,
  datos_incompletos: false, origen: "agente", revisado: false, por_corregir: false, revision_nota: null, notas: null, revisado_en: null, ...o });

describe("validarListar", () => {
  it("usa «por revisar» y 50 por página por omisión", () => expect(validarListar({})).toEqual({ filtro: "por_revisar", q: "", pagina: 0, limite: 50 }));
  it("acepta todos los filtros y rechaza los demás", () => {
    for (const f of FILTROS) expect("error" in validarListar({ filtro: f })).toBe(false);
    expect(validarListar({ filtro: "borrar" })).toEqual({ error: "Filtro no válido." });
  });
  it("acota página y límite", () => {
    expect(validarListar({ limite: 5000 })).toMatchObject({ limite: 100 });
    expect(validarListar({ pagina: -1 })).toEqual({ error: "Página no válida." });
    expect(validarListar({ pagina: "2" })).toMatchObject({ pagina: 0 });
  });
  it("la búsqueda no deja pasar nada que altere el filtro de la consulta", () => {
    expect(busquedaSegura("José  Pérez,rfc.eq.X)%")).toBe("JOSE PEREZ RFC EQ X");
    expect(busquedaSegura("a(b)*c%d,e")).toBe("A B C D E");
    expect(busquedaSegura(null)).toBe("");
    expect((validarListar({ q: "x".repeat(500) }) as { q: string }).q.length).toBe(80);
  });
});

describe("validarRevision", () => {
  it("aprobar no exige nota", () => expect(validarRevision({ ids: [U1, U2, U1], decision: "aprobar" })).toEqual({ ids: [U1, U2], decision: "aprobar", nota: "" }));
  it("devolver exige explicar qué no coincide", () => {
    expect("error" in validarRevision({ ids: [U1], decision: "devolver" })).toBe(true);
    expect(validarRevision({ ids: [U1], decision: "devolver", nota: " RFC distinto\u0000 al PDF " })).toMatchObject({ nota: "RFC distinto al PDF" });
  });
  it("rechaza ids inválidos, vacíos, de más o una decisión desconocida", () => {
    expect("error" in validarRevision({ ids: [], decision: "aprobar" })).toBe(true);
    expect("error" in validarRevision({ ids: ["no-es-uuid"], decision: "aprobar" })).toBe(true);
    expect("error" in validarRevision({ ids: Array.from({ length: MAX_REVISION + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`), decision: "aprobar" })).toBe(true);
    expect("error" in validarRevision({ ids: [U1], decision: "borrar" })).toBe(true);
  });
});

describe("CSV", () => {
  it("escapa comas y comillas y neutraliza fórmulas de Excel", () => {
    expect(celdaCsv('A, "B"')).toBe('"A, ""B"""');
    expect(celdaCsv("=CMD()")).toBe("'=CMD()");
    expect(celdaCsv("+5")).toBe("'+5");
    expect(celdaCsv(null)).toBe("");
  });
  it("lleva encabezado, BOM para Excel y una fila por persona", () => {
    const csv = aCsv([persona(), persona({ nombre: "=EVIL", rfc_dudoso: true, revisado: true })]);
    const filas = csv.replace("﻿", "").split("\r\n");
    expect(csv.startsWith("﻿Nombre,RFC")).toBe(true);
    expect(filas).toHaveLength(3);
    expect(filas[1]).toContain("ANA PÉREZ,PEAA800101AB1");
    expect(filas[2].startsWith("'=EVIL")).toBe(true);
  });
});
