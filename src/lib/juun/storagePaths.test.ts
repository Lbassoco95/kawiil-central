import { describe, it, expect } from "vitest";
import {
  JUUN_BUCKET,
  JUUN_SIGNED_URL_TTL_SECONDS,
  buildJuunPath,
  juunPathBelongsToOrg,
  organizationIdFromJuunPath,
} from "@/lib/juun/storagePaths";

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENTE = "c1111111-1111-1111-1111-111111111111";

describe("buildJuunPath", () => {
  it("arma la ruta con la organización al frente", () => {
    const path = buildJuunPath({
      organizationId: ORG,
      clientId: CLIENTE,
      kind: "csf",
      fileName: "constancia.pdf",
      at: new Date(Date.UTC(2026, 7, 24, 12, 0, 0)),
      uniqueSuffix: "1756036800000",
    });
    expect(path).toBe(
      `${ORG}/juun/clients/${CLIENTE}/2026/08/csf/1756036800000_constancia.pdf`
    );
  });

  it("rellena el mes con cero", () => {
    const path = buildJuunPath({
      organizationId: ORG,
      clientId: CLIENTE,
      kind: "receipts",
      fileName: "t.jpg",
      at: new Date(Date.UTC(2026, 0, 5)),
      uniqueSuffix: "x",
    });
    expect(path).toContain("/2026/01/receipts/");
  });

  it("sanea nombres con acentos y espacios, que Storage rechaza", () => {
    const path = buildJuunPath({
      organizationId: ORG,
      clientId: CLIENTE,
      kind: "cfdi",
      fileName: "factura señor pérez.xml",
      uniqueSuffix: "x",
    });
    expect(path.endsWith("/cfdi/x_factura_senor_perez.xml")).toBe(true);
  });

  it("se niega a construir la ruta sin organización: ese segmento es el aislamiento", () => {
    expect(() =>
      buildJuunPath({ organizationId: "  ", clientId: CLIENTE, kind: "csf", fileName: "a.pdf" })
    ).toThrow(/organizationId/);
  });

  it("se niega sin cliente", () => {
    expect(() =>
      buildJuunPath({ organizationId: ORG, clientId: "", kind: "csf", fileName: "a.pdf" })
    ).toThrow(/clientId/);
  });
});

describe("pertenencia de la ruta a una organización", () => {
  const path = buildJuunPath({
    organizationId: ORG,
    clientId: CLIENTE,
    kind: "evidence",
    fileName: "trace.zip",
    uniqueSuffix: "x",
  });

  it("lee la organización del primer segmento, igual que la policy de storage", () => {
    expect(organizationIdFromJuunPath(path)).toBe(ORG);
  });

  it("distingue una organización de otra", () => {
    expect(juunPathBelongsToOrg(path, ORG)).toBe(true);
    expect(juunPathBelongsToOrg(path, "22222222-2222-2222-2222-222222222222")).toBe(false);
  });
});

describe("constantes del bucket", () => {
  it("apunta al bucket dedicado, no a documents", () => {
    expect(JUUN_BUCKET).toBe("juun");
  });
  it("las signed URL son de vida corta", () => {
    expect(JUUN_SIGNED_URL_TTL_SECONDS).toBe(300);
  });
});
