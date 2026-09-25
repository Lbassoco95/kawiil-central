import { mergeTokens, buildTokenMapFromAnswers } from "./contractMerge";

describe("contractMerge", () => {
  it("reemplaza [TOKEN] de forma determinística", () => {
    const body = "RFC: [RFC]. Nombre: [DENOMINACIÓN O RAZÓN SOCIAL].";
    const out = mergeTokens(body, {
      RFC: "ABC010101AAA",
      "DENOMINACIÓN O RAZÓN SOCIAL": "Acme SA de CV",
    }, { escape: false });
    expect(out).toBe("RFC: ABC010101AAA. Nombre: Acme SA de CV.");
  });

  it("mapea field_key → placeholder_in_body", () => {
    const map = buildTokenMapFromAnswers(
      { "client.rfc": "XAXX010101000", "client.legal_name": "Demo SC" },
      [
        { field_key: "client.rfc", placeholder_in_body: "[RFC]" },
        { field_key: "client.legal_name", placeholder_in_body: "[DENOMINACIÓN O RAZÓN SOCIAL]" },
      ],
    );
    expect(map["RFC"]).toBe("XAXX010101000");
    expect(map["[DENOMINACIÓN O RAZÓN SOCIAL]"]).toBe("Demo SC");
  });

  it("escapa HTML por defecto", () => {
    const out = mergeTokens("Hola [NOMBRE]", { NOMBRE: "<script>" });
    expect(out).toContain("&lt;script&gt;");
  });
});
