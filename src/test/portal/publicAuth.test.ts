/** C3: captcha, límite y respuesta idéntica en registro, recuperación y reenvío. */
import { describe, it, expect, vi } from "vitest";
import {
  guardPublic, registerAccount, turnstileSiteverify, GENERIC_ACCOUNT_MESSAGE, type PublicGuardDeps, type RegisterDeps,
} from "../../../supabase/functions/_shared/portal/publicAuth.ts";

function deps(over: Partial<PublicGuardDeps> = {}) {
  const counts = new Map<string, number>();
  const d: PublicGuardDeps = {
    turnstileSecret: "1x0000000000000000000000000000000AA", // llave de PRUEBA de Cloudflare (siempre pasa)
    verifyTurnstile: vi.fn(async (t: string) =>
      t === "ok" ? { success: true, errorCodes: [] } : t === "vencido" ? { success: false, errorCodes: ["timeout-or-duplicate"] } : { success: false, errorCodes: ["invalid-input-response"] }),
    rateLimit: vi.fn(async (bucket: string, key: string, limit: number) => {
      const k = `${bucket}:${key}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return { allowed: counts.get(k)! <= limit };
    }),
    hash: async (v: string) => `h(${v})`,
    routeGuardOk: async () => true,
    limits: { ipPerWindow: 5, emailPerWindow: 2, windowSeconds: 3600 },
    ...over,
  };
  return d;
}
const base = { kind: "registro" as const, ip: "203.0.113.7", email: "a@prueba.invalid" };

describe("C3 · captcha y límites", () => {
  it("sin captcha configurado → registro cerrado (falla cerrado)", async () => {
    for (const kind of ["registro", "recuperacion", "reenvio"] as const) {
      const r = await guardPublic(deps({ turnstileSecret: null }), { ...base, kind, captchaToken: "ok" });
      expect(r).toMatchObject({ ok: false, status: 503, code: "registro_cerrado" });
    }
  });
  it("cerco de rutas no verificado → registro cerrado", async () => {
    const r = await guardPublic(deps({ routeGuardOk: async () => false }), { ...base, captchaToken: "ok" });
    expect(r).toMatchObject({ ok: false, code: "registro_cerrado" });
  });
  it("sin token → 400", async () => {
    expect(await guardPublic(deps(), { ...base, captchaToken: "" })).toMatchObject({ ok: false, status: 400, code: "captcha_requerido" });
  });
  it("token inválido → 403", async () => {
    expect(await guardPublic(deps(), { ...base, captchaToken: "falso" })).toMatchObject({ ok: false, status: 403, code: "captcha_invalido" });
  });
  it("token vencido → 403 con mensaje para volver a verificar", async () => {
    const r = await guardPublic(deps(), { ...base, captchaToken: "vencido" });
    expect(r).toMatchObject({ ok: false, status: 403, code: "captcha_vencido" });
  });
  it("token válido → pasa", async () => {
    expect(await guardPublic(deps(), { ...base, captchaToken: "ok" })).toEqual({ ok: true });
  });
  it("superar el límite por correo → 429 (aunque cambie la IP)", async () => {
    const d = deps();
    for (let i = 0; i < 2; i++) expect((await guardPublic(d, { ...base, ip: `198.51.100.${i}`, captchaToken: "ok" })).ok).toBe(true);
    expect(await guardPublic(d, { ...base, ip: "198.51.100.9", captchaToken: "ok" })).toMatchObject({ ok: false, status: 429 });
  });
  it("superar el límite por IP → 429 aunque cambie el correo, antes de gastar captcha", async () => {
    const d = deps();
    for (let i = 0; i < 5; i++) await guardPublic(d, { ...base, email: `x${i}@prueba.invalid`, captchaToken: "ok" });
    const verify = d.verifyTurnstile as ReturnType<typeof vi.fn>;
    const before = verify.mock.calls.length;
    expect(await guardPublic(d, { ...base, email: "otro@prueba.invalid", captchaToken: "ok" })).toMatchObject({ ok: false, status: 429 });
    expect(verify.mock.calls.length).toBe(before);
  });
  it("el límite se guarda por huella, nunca con el correo o la IP en claro", async () => {
    const d = deps({ hash: async (v) => `sha256-de-${v.length}` });
    await guardPublic(d, { ...base, captchaToken: "ok" });
    const keys = JSON.stringify((d.rateLimit as ReturnType<typeof vi.fn>).mock.calls);
    expect(keys).not.toContain("a@prueba.invalid");
    expect(keys).not.toContain("203.0.113.7");
  });
  it("siteverify: llaves de prueba de Cloudflare y errores de red", async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const secret = (init.body as URLSearchParams).get("secret");
      return new Response(JSON.stringify(secret?.startsWith("1x") ? { success: true } : { success: false, "error-codes": ["invalid-input-response"] }));
    });
    expect(await turnstileSiteverify("1x0000000000000000000000000000000AA", "XXXX.DUMMY.TOKEN.XXXX", null, f as unknown as typeof fetch)).toEqual({ success: true, errorCodes: [] });
    expect((await turnstileSiteverify("2x0000000000000000000000000000000AA", "t", "1.2.3.4", f as unknown as typeof fetch)).success).toBe(false);
    expect(await turnstileSiteverify("x", "t", null, (async () => { throw new Error("red"); }) as unknown as typeof fetch)).toEqual({ success: false, errorCodes: ["internal-error"] });
  });
});

describe("C3 · respuesta idéntica exista o no la cuenta", () => {
  const mk = (exists: boolean) => {
    const d: RegisterDeps = {
      createUser: vi.fn(async () => (exists ? { exists: true as const } : { userId: "u1" })),
      recordLegal: vi.fn(async () => undefined),
      sendConfirmation: vi.fn(async () => undefined),
      audit: vi.fn(async () => undefined),
    };
    return d;
  };
  it("misma respuesta y mismo envío de correo", async () => {
    const nuevo = mk(false);
    const existente = mk(true);
    const a = await registerAccount(nuevo, { email: "n@prueba.invalid", password: "x".repeat(12), fullName: "N" });
    const b = await registerAccount(existente, { email: "e@prueba.invalid", password: "x".repeat(12), fullName: "E" });
    expect(a).toEqual(b);
    expect(a).toEqual({ ok: true, message: GENERIC_ACCOUNT_MESSAGE });
    expect(nuevo.sendConfirmation).toHaveBeenCalledTimes(1);
    expect(existente.sendConfirmation).toHaveBeenCalledTimes(1);
    expect(existente.recordLegal).not.toHaveBeenCalled();
  });
});
