import { describe, expect, it } from "vitest";
import {
  buildAdminConsentUrl,
  escapeHtml,
  isAdminConsentGranted,
  isAdminConsentRequired,
  jsonForScript,
  normalizeTenant,
  OUTLOOK_DELEGATED_SCOPES,
  tenantFromEmail,
} from "../../supabase/functions/_shared/microsoftConsent.ts";
import {
  buildAdminConsentMessage,
  isAdminConsentRequiredCode,
  OUTLOOK_PERMISSIONS_PLAIN,
} from "./microsoftAdminConsent";

const err = (error: string | null, errorDescription: string | null = null, errorSubcode: string | null = null) => ({
  error,
  errorDescription,
  errorSubcode,
});

describe("isAdminConsentRequired", () => {
  it("detecta AADSTS90094 y AADSTS65001 en la descripción", () => {
    expect(isAdminConsentRequired(err("access_denied", "AADSTS90094: The grant requires admin permission."))).toBe(true);
    expect(isAdminConsentRequired(err("invalid_client", "AADSTS65001: The user or administrator has not consented"))).toBe(true);
  });

  it("detecta consent_required y admin_consent_required", () => {
    expect(isAdminConsentRequired(err("consent_required"))).toBe(true);
    expect(isAdminConsentRequired(err("access_denied", null, "admin_consent_required"))).toBe(true);
  });

  it("access_denied solo cuenta si menciona administrador", () => {
    expect(isAdminConsentRequired(err("access_denied", "Need admin approval"))).toBe(true);
    expect(isAdminConsentRequired(err("access_denied", "Se necesita la aprobación del administrador"))).toBe(true);
    expect(isAdminConsentRequired(err("access_denied", "The user canceled the authentication.", "cancel"))).toBe(false);
  });

  it("no marca otros errores", () => {
    expect(isAdminConsentRequired(err(null))).toBe(false);
    expect(isAdminConsentRequired(err("invalid_request", "AADSTS50011: redirect URI mismatch"))).toBe(false);
  });
});

describe("escape para HTML y <script>", () => {
  const payload = "x'</script><script>alert(1)</script>";

  it("escapeHtml neutraliza etiquetas y comillas", () => {
    expect(escapeHtml(payload)).toBe("x&#39;&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("jsonForScript no deja cerrar la etiqueta y conserva el valor", () => {
    const out = jsonForScript({ error: payload });
    expect(out).not.toContain("</script");
    expect(out).not.toContain("<");
    expect(JSON.parse(out)).toEqual({ error: payload });
  });
});

describe("tenant", () => {
  it("toma el dominio del correo", () => {
    expect(tenantFromEmail("Ana@Contoso.COM")).toBe("contoso.com");
    expect(tenantFromEmail("ana@sub.contoso.com.mx")).toBe("sub.contoso.com.mx");
  });

  it("rechaza correos o tenants inválidos", () => {
    expect(tenantFromEmail("")).toBeNull();
    expect(tenantFromEmail("sin-arroba")).toBeNull();
    expect(tenantFromEmail("a@evil/../x")).toBeNull();
    expect(normalizeTenant("common")).toBeNull();
    expect(normalizeTenant("organizations")).toBeNull();
    expect(normalizeTenant("72f988bf-86f1-41af-91ab-2d7cd011db47")).toBe("72f988bf-86f1-41af-91ab-2d7cd011db47");
  });
});

describe("buildAdminConsentUrl", () => {
  const base = { clientId: "client-123", redirectUri: "https://x.supabase.co/functions/v1/outlook-account-callback" };

  it("usa v2.0/adminconsent con scopes delegados explícitos, sin /.default", () => {
    const url = new URL(buildAdminConsentUrl({ ...base, tenant: "contoso.com" }));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/contoso.com/v2.0/adminconsent");
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe(base.redirectUri);
    expect(url.searchParams.get("state")).toBe("admin_consent");
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes).toHaveLength(OUTLOOK_DELEGATED_SCOPES.length);
    expect(scopes).toContain("openid");
    expect(scopes).toContain("https://graph.microsoft.com/Mail.Send");
    expect(url.toString()).not.toContain(".default");
  });

  it("cae a organizations si no hay tenant válido", () => {
    expect(buildAdminConsentUrl({ ...base, tenant: null })).toContain("/organizations/v2.0/adminconsent?");
    expect(buildAdminConsentUrl({ ...base, tenant: "common" })).toContain("/organizations/v2.0/adminconsent?");
  });
});

describe("isAdminConsentGranted", () => {
  it("reconoce admin_consent=True", () => {
    expect(isAdminConsentGranted(new URLSearchParams("admin_consent=True&tenant=contoso.com"))).toBe(true);
    expect(isAdminConsentGranted(new URLSearchParams("error=access_denied"))).toBe(false);
  });
});

describe("mensaje para el administrador", () => {
  it("incluye el enlace y los permisos", () => {
    const msg = buildAdminConsentMessage("https://login.microsoftonline.com/contoso.com/v2.0/adminconsent?x=1");
    expect(msg).toContain("https://login.microsoftonline.com/contoso.com/v2.0/adminconsent?x=1");
    for (const p of OUTLOOK_PERMISSIONS_PLAIN) expect(msg).toContain(p);
  });

  it("reconoce el código tipado", () => {
    expect(isAdminConsentRequiredCode("admin_consent_required")).toBe(true);
    expect(isAdminConsentRequiredCode("access_denied")).toBe(false);
  });
});
