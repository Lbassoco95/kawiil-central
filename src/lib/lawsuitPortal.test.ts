import { describe, expect, it } from "vitest";
import { generatePortalCode, generatePortalToken, portalCodeHash, portalUrl, sha256Hex } from "./lawsuitPortal";

describe("portal del cliente", () => {
  it("genera tokens base64url de 32 caracteres, distintos entre sí", () => {
    const a = generatePortalToken();
    const b = generatePortalToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
  });

  it("genera códigos de 6 dígitos", () => {
    for (let i = 0; i < 50; i++) expect(generatePortalCode()).toMatch(/^\d{6}$/);
  });

  it("sha256 coincide con el vector conocido y el hash del código depende del token", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await portalCodeHash("t1", "123456")).toBe(await sha256Hex("t1:123456"));
    expect(await portalCodeHash("t1", "123456")).not.toBe(await portalCodeHash("t2", "123456"));
  });

  it("arma la URL pública", () => {
    expect(portalUrl("TOKEN", "https://kawiil-central.mx")).toBe("https://kawiil-central.mx/portal/TOKEN");
  });
});
