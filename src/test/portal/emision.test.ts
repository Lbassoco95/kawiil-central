import { describe, it, expect } from "vitest";
import {
  crearEmisor, validarBorrador, EmisorPrueba, EmisorPacPlantilla, PacNoConfigurado, EmisionRechazada,
  type BorradorFactura, type ContextoEmision,
} from "../../../supabase/functions/_shared/portal/emission/index.ts";
import { CATALOG_META, C_USO_REGIMEN } from "../../../supabase/functions/_shared/portal/validate.ts";

const borrador = (): BorradorFactura => ({
  emisor: { rfc: "AAA010101AAA", nombre: "CLIENTE SINTETICO A", regimen: "601", cp: "01000" },
  receptor: { rfc: "BBB010101BBB", nombre: "RECEPTOR SINTETICO", regimen: "601", cp: "64000", uso: "G03" },
  formaPago: "03",
  metodoPago: "PUE",
  moneda: "MXN",
  conceptos: [{ claveProdServ: "84111506", claveUnidad: "E48", descripcion: "Servicio", cantidad: 2, valorUnitario: 500, objetoImp: "02", ivaTasa: 0.16 }],
});
const matriz = [{ uso: "G03", regimenes: ["601", "612"] }];
const ctx = (over: Partial<ContextoEmision> = {}): ContextoEmision => ({
  csd: { serial: "1", notBefore: "2025-01-01T00:00:00Z", notAfter: "2030-01-01T00:00:00Z", revoked: false },
  ahora: new Date("2026-09-28T12:00:00Z"),
  matrizUsoRegimen: matriz,
  ...over,
});

describe("emisión detrás de adaptador", () => {
  it("la matriz régimen × uso NO está cargada y eso bloquea (falla cerrada)", () => {
    expect(C_USO_REGIMEN).toEqual([]);
    expect(CATALOG_META.compat.fuente).toBe("pendiente");
    const r = validarBorrador(borrador(), ctx({ matrizUsoRegimen: undefined }));
    expect(r.ok).toBe(false);
    expect(r.errores.map((e) => e.mensaje).join(" ")).toMatch(/matriz oficial del SAT no está cargada/);
  });
  it("borrador completo pasa con una matriz dada y calcula totales", () => {
    const r = validarBorrador(borrador(), ctx());
    expect(r.errores).toEqual([]);
    expect(r.totales).toEqual({ subtotal: 1000, iva: 160, total: 1160 });
  });
  it.each([
    ["RFC receptor", (b: BorradorFactura) => { b.receptor.rfc = "XYZ"; }, "receptor.rfc"],
    ["RFC genérico", (b: BorradorFactura) => { b.receptor.rfc = "XAXX010101000"; }, "receptor.rfc"],
    ["CP de 4 dígitos", (b: BorradorFactura) => { b.receptor.cp = "6400"; }, "receptor.cp"],
    ["régimen fuera de catálogo", (b: BorradorFactura) => { b.receptor.regimen = "999"; }, "receptor.regimen"],
    ["uso incompatible", (b: BorradorFactura) => { b.receptor.regimen = "605"; }, "receptor.uso"],
    ["PPD sin 99", (b: BorradorFactura) => { b.metodoPago = "PPD"; }, "formaPago"],
    ["sin nombre", (b: BorradorFactura) => { b.receptor.nombre = " "; }, "receptor.nombre"],
    ["sin conceptos", (b: BorradorFactura) => { b.conceptos = []; }, "conceptos"],
    ["clave de 7 dígitos", (b: BorradorFactura) => { b.conceptos[0].claveProdServ = "8411150"; }, "conceptos[0].claveProdServ"],
  ])("rechaza: %s", (_n, mutate, campo) => {
    const b = borrador();
    mutate(b);
    expect(validarBorrador(b, ctx()).errores.map((e) => e.campo)).toContain(campo);
  });
  it.each([
    ["vencido", { notAfter: "2026-01-01T00:00:00Z" }],
    ["revocado", { revoked: true }],
  ])("CSD %s bloquea", (_n, csd) => {
    const r = validarBorrador(borrador(), ctx({ csd: { serial: "1", notBefore: null, notAfter: "2030-01-01T00:00:00Z", revoked: false, ...csd } }));
    expect(r.errores.map((e) => e.campo)).toContain("csd");
  });
  it("el emisor de prueba no timbra: XML marcado sin validez fiscal y que no es CFDI", async () => {
    const e = crearEmisor(undefined);
    expect(e).toBeInstanceOf(EmisorPrueba);
    const out = await e.emitir(borrador(), ctx());
    expect(out.esPrueba).toBe(true);
    expect(out.xml).toMatch(/SIN VALIDEZ FISCAL/);
    expect(out.xml).not.toMatch(/sat\.gob\.mx\/cfd/);
    await expect(e.emitir({ ...borrador(), conceptos: [] }, ctx())).rejects.toBeInstanceOf(EmisionRechazada);
    expect(await e.consultarEstado(out.uuid)).toBe("prueba");
  });
  it("la plantilla del PAC real se niega a emitir", async () => {
    const e = crearEmisor("pac");
    expect(e).toBeInstanceOf(EmisorPacPlantilla);
    await expect(e.emitir(borrador(), ctx())).rejects.toBeInstanceOf(PacNoConfigurado);
  });
});
