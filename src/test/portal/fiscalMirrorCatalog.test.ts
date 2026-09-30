import { describe, expect, it } from "vitest";
import { MIRROR_SYSTEM_OPERATIONS, mapDocTypeToStorage } from "../../../supabase/functions/_shared/portal/fiscalMirror.ts";

describe("catálogo espejo central→OS", () => {
  it("incluye operaciones firmadas de facturas, resumen, alertas y SAT", () => {
    expect(MIRROR_SYSTEM_OPERATIONS).toEqual(expect.arrayContaining([
      "invoice.publish",
      "fiscal_summary.publish",
      "sat_document.publish",
      "declaration.publish",
      "alert.publish",
      "sat_notification.publish",
    ]));
  });

  it("normaliza tipos de documento a los de la pantalla", () => {
    expect(mapDocTypeToStorage("declaration", "document.publish")).toBe("declaracion");
    expect(mapDocTypeToStorage("payment", "document.publish")).toBe("pago");
  });
});
