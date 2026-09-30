import { describe, expect, it } from "vitest";
import { signSystemRequest, verifySystemRequest } from "../../../supabase/functions/_shared/portal/systemAuth";

const secret = "synthetic-system-secret-at-least-32-characters";
const body = JSON.stringify({ company_ref: "demo-company", idempotency_key: "event-1" });

async function signed(operation = "message.sent") {
  const headers = await signSystemRequest(operation, body, secret, "1790630400", "syntheticnonce000001");
  return {
    timestamp: headers["x-system-timestamp"],
    nonce: headers["x-system-nonce"],
    operation: headers["x-system-operation"],
    signature: headers["x-system-signature"],
    body,
  };
}

describe("system API boundary", () => {
  it("accepts a valid signed request", async () => {
    expect(await verifySystemRequest(await signed(), secret, 1790630400 * 1000)).toMatchObject({ ok: true });
  });

  it("rejects tampering, wrong direction secret and expired calls", async () => {
    const request = await signed();
    expect(await verifySystemRequest({ ...request, body: `${body} ` }, secret, 1790630400 * 1000)).toEqual({ ok: false, code: "signature_invalid" });
    expect(await verifySystemRequest(request, `${secret}-other`, 1790630400 * 1000)).toEqual({ ok: false, code: "signature_invalid" });
    expect(await verifySystemRequest(request, secret, (1790630400 + 301) * 1000)).toEqual({ ok: false, code: "timestamp_invalid" });
  });

  it("binds the operation to the signature", async () => {
    const request = await signed();
    expect(await verifySystemRequest({ ...request, operation: "ticket.submitted" }, secret, 1790630400 * 1000)).toEqual({ ok: false, code: "signature_invalid" });
  });
});
