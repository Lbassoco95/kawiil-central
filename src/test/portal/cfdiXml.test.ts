import { describe, it, expect } from "vitest";
import { validateCfdiXml, directionForClient, toPortalCfdiRow } from "../../../supabase/functions/_shared/portal/cfdiXml.ts";
import { cfdiXml } from "./fixtures";

describe("lectura de CFDI", () => {
  it("valida un CFDI 4.0 timbrado y extrae datos de gestión", () => {
    const r = validateCfdiXml(cfdiXml());
    expect(r.errors).toEqual([]);
    expect(r.parsed!.uuid).toBe("6F8A1B2C-3D4E-4F50-8A6B-7C8D9E0F1A2B");
    // El IVA sale del nodo Impuestos del comprobante, no del concepto.
    expect(r.parsed!.ivaTrasladado).toBe(160);
    expect(r.parsed!.conceptos[0].descripcion).toBe("Gasolina & aditivo");
  });
  it("rechaza algo que no es CFDI", () => {
    expect(validateCfdiXml("<factura><total>1</total></factura>").ok).toBe(false);
  });
  it("rechaza sin timbre", () => {
    const sinTimbre = cfdiXml().replace(/<cfdi:Complemento>[\s\S]*<\/cfdi:Complemento>/, "");
    expect(validateCfdiXml(sinTimbre).errors.join(" ")).toMatch(/Timbre/);
  });
  it("pertenencia al RFC del cliente", () => {
    const p = validateCfdiXml(cfdiXml()).parsed!;
    expect(directionForClient(p, ["aaa010101aaa"])).toBe("recibida");
    expect(directionForClient(p, ["EKU9003173C9"])).toBe("emitida");
    expect(directionForClient(p, ["BBB010101BBB"])).toBeNull();
    expect(toPortalCfdiRow(p, "recibida")).toMatchObject({ forma_pago: "01", total: 1160, clave_prod_serv: "15101514" });
  });
});
