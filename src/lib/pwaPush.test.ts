import { describe, expect, it } from "vitest";
import { dismissStillActive, isIosDevice, pushBannerMode, type PushBannerInput } from "./pwaPush";

const base: PushBannerInput = {
  ios: false,
  standalone: false,
  pushSupported: true,
  permission: "default",
  hasSubscription: false,
  toggleOn: false,
};

describe("isIosDevice", () => {
  it("detecta iPhone y iPad clásico", () => {
    expect(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)", 5)).toBe(true);
  });
  it("detecta iPadOS que se presenta como Mac solo si es multitáctil", () => {
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
  });
  it("no confunde Android ni escritorio", () => {
    expect(isIosDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8)", 5)).toBe(false);
    expect(isIosDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0)).toBe(false);
  });
});

describe("pushBannerMode", () => {
  it("iPhone sin instalar → guía de instalación, aunque no haya PushManager", () => {
    expect(pushBannerMode({ ...base, ios: true, pushSupported: false })).toBe("install-ios");
  });
  it("iPhone ya instalado y sin avisos → pide activar", () => {
    expect(pushBannerMode({ ...base, ios: true, standalone: true })).toBe("enable");
  });
  it("Android/escritorio sin avisos → pide activar", () => {
    expect(pushBannerMode(base)).toBe("enable");
  });
  it("todo activo → no muestra nada", () => {
    expect(pushBannerMode({ ...base, permission: "granted", hasSubscription: true, toggleOn: true })).toBeNull();
  });
  it("permiso concedido pero sin suscripción o con toggle apagado → vuelve a ofrecer", () => {
    expect(pushBannerMode({ ...base, permission: "granted", hasSubscription: false, toggleOn: true })).toBe("enable");
    expect(pushBannerMode({ ...base, permission: "granted", hasSubscription: true, toggleOn: false })).toBe("enable");
  });
  it("permiso bloqueado o navegador sin push → no insiste", () => {
    expect(pushBannerMode({ ...base, permission: "denied" })).toBeNull();
    expect(pushBannerMode({ ...base, pushSupported: false })).toBeNull();
  });
});

describe("dismissStillActive", () => {
  const dia = 86_400_000;
  it("vigente antes de 7 días y vencido después", () => {
    expect(dismissStillActive(1000, 1000 + 6 * dia)).toBe(true);
    expect(dismissStillActive(1000, 1000 + 8 * dia)).toBe(false);
  });
  it("sin registro no está vigente", () => {
    expect(dismissStillActive(null, 5000)).toBe(false);
    expect(dismissStillActive(Number.NaN, 5000)).toBe(false);
  });
});
