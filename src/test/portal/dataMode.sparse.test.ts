import { describe, expect, it } from "vitest";
import { partitionSparse } from "../../portal/lib/cfdiPresentation";
import type { MirrorCfdi } from "../../portal/lib/mirrorInvoiceMap";
import { toInvoiceRows } from "../../portal/lib/mirrorInvoiceMap";

describe("Ingresos/Egresos listado cuenta real", () => {
  it("prioriza SatGo real y aísla fixtures Aldea del Sol", () => {
    const rows: MirrorCfdi[] = [
      {
        id: "1",
        uuid: "D1111111-1111-4111-8111-111111111111",
        direction: "emitida",
        fecha: "2026-09-05T16:00:00Z",
        rfc_emisor: "BVS211101H55",
        nombre_emisor: "BASSOCO",
        rfc_receptor: "CACX7605101P8",
        nombre_receptor: "Constructora Aldea del Sol",
        total: 11600,
        sat_status: "vigente",
        category_name: "Servicios profesionales",
        category_status: "confirmada",
        is_test: true,
        detail_status: "complete",
        metodo_pago: "PUE",
        source: "central_mirror",
      },
      {
        id: "2",
        uuid: "280F1953-43E1-44AC-92F0-D7CFED6E795D",
        direction: "emitida",
        fecha: "2026-08-01T00:00:00Z",
        rfc_emisor: null,
        nombre_emisor: "BASSOCO",
        rfc_receptor: "DMS221017E37",
        nombre_receptor: "DOCTOCLIQ MEXICO",
        total: 0,
        sat_status: "vigente",
        category_name: null,
        category_status: "por_confirmar",
        is_test: false,
        detail_status: "metadata",
        metodo_pago: null,
        source: "satgo_facfiel",
      },
    ];
    const { ready, pending } = partitionSparse(rows);
    expect(ready).toHaveLength(1);
    expect(pending).toHaveLength(1);
    expect(ready[0].nombre_receptor).toBe("DOCTOCLIQ MEXICO");
    expect(pending[0].nombre_receptor).toBe("Constructora Aldea del Sol");
    const mapped = toInvoiceRows(ready, "emitida")[0];
    expect(mapped.folio).toBe("280F1953…");
    expect(mapped.party).toBe("DOCTOCLIQ MEXICO");
    expect(mapped.proposal?.account).toBe("Detalle pendiente");
  });
});
