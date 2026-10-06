import { describe, expect, it } from "vitest";
import {
  accountOnlyCfdi,
  isDidacticFixtureCfdi,
  isPendingDetailCfdi,
  isSparseMetadataCfdi,
  partitionSparse,
  shortUuid,
  visibleClientFlags,
} from "../../portal/lib/cfdiPresentation";

describe("cfdiPresentation", () => {
  it("acorta UUID para listas", () => {
    expect(shortUuid("D1111111-1111-4111-8111-111111111111")).toBe("D1111111…");
  });

  it("aísla fixtures didácticos del listado principal", () => {
    expect(
      isDidacticFixtureCfdi({
        source: "central_mirror",
        detail_status: "complete",
        total: 11600,
        is_test: true,
        payment_method: "PUE",
      }),
    ).toBe(true);
    expect(
      isSparseMetadataCfdi({
        source: "central_mirror",
        detail_status: "complete",
        total: 11600,
        is_test: true,
      }),
    ).toBe(true);
  });

  it("muestra SatGo reales aunque sean metadatos $0", () => {
    const satgo = {
      source: "satgo_facfiel",
      detail_status: "metadata",
      total: 0,
      is_test: false,
      payment_method: null,
    };
    expect(isDidacticFixtureCfdi(satgo)).toBe(false);
    expect(isPendingDetailCfdi(satgo)).toBe(true);
    expect(isSparseMetadataCfdi(satgo)).toBe(false);
  });

  it("conserva filas con monto real en cuenta", () => {
    expect(
      isDidacticFixtureCfdi({
        source: "satgo_facfiel",
        detail_status: "complete",
        total: 11600,
        is_test: false,
        payment_method: "PUE",
      }),
    ).toBe(false);
    expect(
      isPendingDetailCfdi({
        source: "satgo_facfiel",
        detail_status: "complete",
        total: 11600,
        is_test: false,
        payment_method: "PUE",
      }),
    ).toBe(false);
  });

  it("particiona cuenta real vs ejemplos didácticos y accountOnly los excluye", () => {
    const rows = [
      { source: "central_mirror", detail_status: "complete", total: 100, is_test: true, metodo_pago: "PPD" },
      { source: "satgo_facfiel", detail_status: "metadata", total: 0, is_test: false },
      {
        source: "satgo_facfiel",
        detail_status: "metadata",
        total: 0,
        is_test: false,
        nombre_receptor: "DOCTOCLIQ MEXICO",
      },
    ];
    const { ready, pending } = partitionSparse(rows);
    expect(ready).toHaveLength(2);
    expect(pending).toHaveLength(1);
    expect(pending[0].is_test).toBe(true);
    expect(accountOnlyCfdi(rows)).toHaveLength(2);
    expect(accountOnlyCfdi(rows).every((r) => r.is_test !== true)).toBe(true);
  });

  it("oculta flags ya representados por badges", () => {
    expect(
      visibleClientFlags([
        { code: "metadata_only", reason: "x" },
        { code: "nota_credito", reason: "y" },
        { code: "otro", reason: "revisar" },
      ]),
    ).toEqual([{ code: "otro", reason: "revisar" }]);
  });
});
