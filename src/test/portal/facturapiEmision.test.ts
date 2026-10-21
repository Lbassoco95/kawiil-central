import { describe, it, expect } from "vitest";
import {
  crearEmisor,
  borradorToFacturapiIngreso,
  EmisorFacturapi,
  EmisorPrueba,
  EmisorPacPlantilla,
  type BorradorFactura,
} from "../../../supabase/functions/_shared/portal/emission/index.ts";

const borrador = (): BorradorFactura => ({
  emisor: { rfc: "AAA010101AAA", nombre: "EMISOR PRUEBA", regimen: "601", cp: "01000" },
  receptor: { rfc: "BBB010101BBB", nombre: "RECEPTOR PRUEBA", regimen: "601", cp: "64000", uso: "G03" },
  formaPago: "03",
  metodoPago: "PUE",
  moneda: "MXN",
  conceptos: [{
    claveProdServ: "80131500",
    claveUnidad: "E48",
    descripcion: "Servicios de contabilidad",
    cantidad: 1,
    valorUnitario: 1000,
    objetoImp: "02",
    ivaTasa: 0.16,
  }],
});

describe("Facturapi emisor y mapeo", () => {
  it("crearEmisor(facturapi) usa EmisorFacturapi", () => {
    expect(crearEmisor("facturapi")).toBeInstanceOf(EmisorFacturapi);
    expect(crearEmisor("pac")).toBeInstanceOf(EmisorPacPlantilla);
    expect(crearEmisor("prueba")).toBeInstanceOf(EmisorPrueba);
  });

  it("mapea borrador a body Facturapi tipo I", () => {
    const body = borradorToFacturapiIngreso(borrador());
    expect(body.type).toBe("I");
    expect(body.payment_method).toBe("PUE");
    expect(body.payment_form).toBe("03");
    expect(body.use).toBe("G03");
    const items = body.items as { quantity: number; product: Record<string, unknown> }[];
    expect(items).toHaveLength(1);
    expect(items[0].product.product_key).toBe("80131500");
    expect(items[0].product.tax_included).toBe(false);
    expect(items[0].product.taxability).toBe("02");
    expect(items[0].product.taxes).toEqual([{ type: "IVA", rate: 0.16 }]);
    expect((body.customer as { tax_id: string }).tax_id).toBe("BBB010101BBB");
  });

  it("validar con Facturapi omite CSD local", async () => {
    const e = new EmisorFacturapi(null);
    const r = await e.validar(borrador(), {
      csd: null,
      omitirCsd: true,
      matrizUsoRegimen: [{ uso: "G03", regimenes: ["601"] }],
    });
    expect(r.ok).toBe(true);
    expect(r.errores.map((x) => x.campo)).not.toContain("csd");
    expect(r.totales).toEqual({ subtotal: 1000, iva: 160, total: 1160 });
  });
});
