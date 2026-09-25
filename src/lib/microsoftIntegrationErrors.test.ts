import { describe, expect, it } from "vitest";
import { formatMicrosoftIntegrationError } from "./microsoftIntegrationErrors";

describe("formatMicrosoftIntegrationError", () => {
  it("detecta AADSTS7000222 / secret expirado en el body crudo", () => {
    const body = JSON.stringify({
      error:
        'Token refresh failed: {"error":"invalid_client","error_description":"AADSTS7000222: The provided client secret keys for app \'db370917\' are expired."}',
    });
    const msg = formatMicrosoftIntegrationError(
      new Error("Edge Function returned a non-2xx status code"),
      body,
    );
    expect(msg.toLowerCase()).toMatch(/client secret|azure|MICROSOFT_CLIENT_SECRET/i);
    expect(msg).not.toMatch(/non-2xx/);
  });

  it("usa el código AUTH_CONFIG_EXPIRED del edge", () => {
    const body = JSON.stringify({
      code: "AUTH_CONFIG_EXPIRED",
      error: "La integración con Microsoft está caída: el client secret de la app en Azure expiró.",
    });
    const msg = formatMicrosoftIntegrationError(new Error("non-2xx"), body);
    expect(msg).toContain("client secret");
  });

  it("pide reconectar ante RECONNECT_REQUIRED", () => {
    const body = JSON.stringify({
      code: "RECONNECT_REQUIRED",
      error: "Tu sesión de Microsoft expiró o fue revocada. Reconecta Microsoft 365.",
    });
    expect(formatMicrosoftIntegrationError(new Error("x"), body)).toMatch(/Reconecta/i);
  });
});
