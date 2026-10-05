import { describe, expect, it } from "vitest";
import {
  isSparseMetadataCfdi,
  partitionSparse,
  shortUuid,
  visibleClientFlags,
} from "../../portal/lib/cfdiPresentation";

describe("cfdiPresentation", () => {
  it("acorta UUID para listas", () => {
    expect(shortUuid("D1111111-1111-4111-8111-111111111111")).toBe("D1111111…");
  });

  it("marca SatGo $0 sin método como sparse", () => {
    expect(
      isSparseMetadataCfdi({
        source: "satgo_facfiel",
        detail_status: "metadata",
        total: 0,
        is_test: false,
        payment_method: null,
      }),
    ).toBe(true);
  });

  it("conserva filas DEMO aunque sean metadata", () => {
    expect(
      isSparseMetadataCfdi({
        source: "central_mirror",
        detail_status: "metadata",
        total: 2320,
        is_test: true,
        payment_method: "PUE",
      }),
    ).toBe(false);
  });

  it("conserva filas con monto real", () => {
    expect(
      isSparseMetadataCfdi({
        source: "satgo_facfiel",
        detail_status: "complete",
        total: 11600,
        is_test: false,
        payment_method: "PUE",
      }),
    ).toBe(false);
  });

  it("particiona ready vs pending", () => {
    const { ready, pending } = partitionSparse([
      { source: "central_mirror", detail_status: "complete", total: 100, is_test: true, metodo_pago: "PPD" },
      { source: "satgo_facfiel", detail_status: "metadata", total: 0, is_test: false },
    ]);
    expect(ready).toHaveLength(1);
    expect(pending).toHaveLength(1);
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
