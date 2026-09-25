import { describe, expect, it } from "vitest";
import { formatContractRpcError, humanizeContractErrorCode } from "./contractRpcError";

describe("formatContractRpcError", () => {
  it("no muestra [object Object] con plain PostgREST error", () => {
    const msg = formatContractRpcError({
      code: "PGRST202",
      message: "Could not find the function public.start_contract_engagement(p_lead_id, p_package_kind) in the schema cache",
      details: "Searched for the function…",
      hint: null,
    });
    expect(msg).not.toContain("[object Object]");
    expect(msg.toLowerCase()).toMatch(/postgrest|caché|schema|api/);
  });

  it("usa message de Error", () => {
    expect(formatContractRpcError(new Error("boom"))).toBe("boom");
  });

  it("mapea códigos RPC", () => {
    expect(formatContractRpcError({ message: "no_organization" })).toMatch(/organización/i);
    expect(humanizeContractErrorCode("template_missing")).toMatch(/plantilla/i);
  });

  it("serializa objetos sin message vía JSON", () => {
    const msg = formatContractRpcError({ foo: 1, bar: "x" });
    expect(msg).toBe('{"foo":1,"bar":"x"}');
  });
});
