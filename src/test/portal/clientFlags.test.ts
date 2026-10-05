import { describe, expect, it } from "vitest";
import { clientDetailQualityLabel, clientFlagReason } from "../../portal/lib/clientFlags";

describe("clientFlagReason", () => {
  it("reescribe el badge histórico con «espejo»", () => {
    expect(
      clientFlagReason({ code: "metadata_only", reason: "Solo metadatos en el espejo (DEMO)" }),
    ).toBe("Solo metadatos (DEMO)");
  });

  it("usa Detalle pendiente sin DEMO", () => {
    expect(
      clientFlagReason({ code: "metadata_only", reason: "Solo metadatos en el espejo" }),
    ).toBe("Detalle pendiente");
  });

  it("limpia cualquier razón con la palabra espejo", () => {
    expect(clientFlagReason({ code: "other", reason: "Dato del espejo del servicio" })).not.toMatch(/espejo/i);
  });
});

describe("clientDetailQualityLabel", () => {
  it("muestra detalle pendiente en vez de jerga interna", () => {
    expect(clientDetailQualityLabel("solo_metadatos", "metadata")).toBe("Detalle pendiente");
    expect(clientDetailQualityLabel("completa", "complete")).toBe("Detalle completo");
  });
});
