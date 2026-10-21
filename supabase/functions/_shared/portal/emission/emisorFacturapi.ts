/**
 * EmisorFacturapi — timbra vía https://www.facturapi.io (CFDI 4.0).
 * El CSD vive en la organización Facturapi (central/Fase 1); no se sella en OS.
 */
import { validarBorrador } from "./validar.ts";
import {
  createInvoice,
  downloadInvoiceXml,
  FacturapiError,
  facturapiConfigFromEnv,
  type FacturapiConfig,
} from "./facturapiClient.ts";
import {
  EmisionRechazada,
  type BorradorFactura,
  type ContextoEmision,
  type EmisorCfdi,
  type EstadoCfdi,
  type ResultadoEmision,
  type ResultadoValidacion,
} from "./types.ts";

function usoFacturapi(uso: string): string {
  return uso || "G03";
}

/** Mapea borrador interno → body Facturapi (ingreso). Precio sin IVA (tax_included: false). */
export function borradorToFacturapiIngreso(b: BorradorFactura): Record<string, unknown> {
  return {
    type: "I",
    use: usoFacturapi(b.receptor.uso),
    payment_form: b.formaPago,
    payment_method: b.metodoPago,
    currency: "MXN",
    customer: {
      legal_name: b.receptor.nombre.trim(),
      tax_id: b.receptor.rfc.trim().toUpperCase(),
      tax_system: b.receptor.regimen,
      address: { zip: b.receptor.cp, country: "MEX" },
      ...(b.receptor.email ? { email: b.receptor.email } : {}),
    },
    items: b.conceptos.map((c) => {
      const product: Record<string, unknown> = {
        description: c.descripcion.trim(),
        product_key: c.claveProdServ,
        unit_key: c.claveUnidad || "E48",
        price: Number(c.valorUnitario),
        tax_included: false,
        taxability: c.objetoImp,
      };
      if (c.objetoImp === "02" && typeof c.ivaTasa === "number") {
        product.taxes = [{ type: "IVA", rate: c.ivaTasa }];
      } else if (c.objetoImp === "01") {
        product.taxes = [];
      }
      return { quantity: Number(c.cantidad), product };
    }),
    ...(b.serie ? { series: b.serie } : {}),
    ...(b.folio ? { folio_number: b.folio } : {}),
  };
}

export class EmisorFacturapi implements EmisorCfdi {
  readonly nombre = "facturapi" as const;
  private cfg: FacturapiConfig | null;

  constructor(cfg?: FacturapiConfig | null) {
    this.cfg = cfg === undefined ? facturapiConfigFromEnv() : cfg;
  }

  private requireCfg(): FacturapiConfig {
    if (!this.cfg?.secretKey) {
      throw new FacturapiError(503, "facturapi_not_configured", "Facturapi no está configurado (FACTURAPI_SECRET_KEY).");
    }
    return this.cfg;
  }

  async validar(b: BorradorFactura, ctx: ContextoEmision): Promise<ResultadoValidacion> {
    // Facturapi administra el CSD en su org: no exigir CSD local.
    return validarBorrador(b, { ...ctx, omitirCsd: true });
  }

  async emitir(b: BorradorFactura, ctx: ContextoEmision): Promise<ResultadoEmision & { facturapiId: string }> {
    const v = await this.validar(b, ctx);
    if (!v.ok) throw new EmisionRechazada(v.errores);
    const cfg = this.requireCfg();
    const created = await createInvoice(cfg, borradorToFacturapiIngreso(b));
    let xml = "";
    try {
      xml = await downloadInvoiceXml(cfg, created.id);
    } catch {
      xml = `<!-- Facturapi ${created.id} uuid=${created.uuid ?? ""} sin XML local -->`;
    }
    const fecha = created.stamp?.date ?? new Date().toISOString();
    const uuid = (created.uuid ?? crypto.randomUUID()).toUpperCase();
    return {
      uuid,
      xml,
      esPrueba: created.livemode === false,
      fechaTimbrado: fecha,
      totales: v.totales,
      facturapiId: created.id,
    };
  }

  async consultarEstado(uuid: string): Promise<EstadoCfdi> {
    // Sin búsqueda por UUID en API pública simple: devolvemos desconocido.
    void uuid;
    return "desconocido";
  }
}
