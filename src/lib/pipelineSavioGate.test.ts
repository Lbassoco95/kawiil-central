import { describe, expect, it } from "vitest";
import {
  canSendLeadToSavio,
  isLeadPipelineLost,
  savioBillingVisibility,
} from "./pipelineSavioGate";

describe("canSendLeadToSavio", () => {
  it("sólo con el trato ganado", () => {
    expect(canSendLeadToSavio("convertido")).toBe(true);
    expect(canSendLeadToSavio("propuesta")).toBe(false);
    expect(canSendLeadToSavio(null)).toBe(false);
  });
});

describe("savioBillingVisibility", () => {
  it("muestra el bloque completo cuando ya cerramos el cliente", () => {
    expect(savioBillingVisibility("convertido")).toBe("full");
  });

  it("en seguimiento sólo avisa, no pide datos fiscales", () => {
    for (const slug of ["nuevo", "contactado", "propuesta", "negociacion"]) {
      expect(savioBillingVisibility(slug)).toBe("hint");
    }
    expect(savioBillingVisibility(undefined)).toBe("hint");
  });

  it("un lead perdido no muestra facturación", () => {
    expect(savioBillingVisibility("perdido")).toBe("hidden");
    expect(isLeadPipelineLost("perdido")).toBe(true);
  });
});
