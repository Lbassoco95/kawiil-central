/**
 * Portal del cliente — operaciones PÚBLICAS de cuenta (corrección C3):
 * registro, recuperación de contraseña y reenvío de confirmación.
 *
 *   · Cloudflare Turnstile obligatorio. Sin TURNSTILE_SECRET_KEY el registro
 *     se CIERRA (falla cerrado), no se abre.
 *   · Límite por IP y por correo (huellas sha256, nunca el dato en claro).
 *   · Registro: además exige el cerco de rutas verificado (V1).
 *   · La respuesta es la MISMA exista o no la cuenta.
 * Módulo puro con dependencias inyectadas: la Edge le pasa Cloudflare, la base
 * y Auth; las pruebas, dobles.
 */
export type PublicKind = "registro" | "recuperacion" | "reenvio";

export interface RateLimitResult {
  allowed: boolean;
  retry_after_seconds?: number;
}

export interface PublicGuardDeps {
  turnstileSecret?: string | null;
  verifyTurnstile(token: string, ip: string | null): Promise<{ success: boolean; errorCodes: string[] }>;
  rateLimit(bucket: string, keyHash: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
  hash(value: string): Promise<string>;
  routeGuardOk(): Promise<boolean>;
  limits: { ipPerWindow: number; emailPerWindow: number; windowSeconds: number };
}

export type GuardResult = { ok: true } | { ok: false; status: number; code: string; message: string };

export const GENERIC_ACCOUNT_MESSAGE = "Si el correo es válido, le enviamos un enlace para continuar. Revise también su carpeta de correo no deseado.";

const closed = (): GuardResult => ({
  ok: false, status: 503, code: "registro_cerrado",
  message: "El registro y la recuperación de cuentas están cerrados temporalmente. Intente más tarde o escriba a Kawiil.",
});

export async function guardPublic(
  deps: PublicGuardDeps,
  input: { kind: PublicKind; captchaToken?: string | null; ip: string | null; email: string },
): Promise<GuardResult> {
  if (!deps.turnstileSecret) return closed();
  if (input.kind === "registro" && !(await deps.routeGuardOk())) return closed();

  const tooMany: GuardResult = {
    ok: false, status: 429, code: "demasiados_intentos",
    message: "Hubo demasiados intentos. Espere unos minutos e intente de nuevo.",
  };
  const w = deps.limits.windowSeconds;
  if (input.ip) {
    const r = await deps.rateLimit(`${input.kind}_ip`, await deps.hash(`ip:${input.ip}`), deps.limits.ipPerWindow, w);
    if (!r.allowed) return tooMany;
  }

  const token = (input.captchaToken ?? "").trim();
  if (!token) return { ok: false, status: 400, code: "captcha_requerido", message: "Confirme que no es un robot para continuar." };
  const v = await deps.verifyTurnstile(token, input.ip);
  if (!v.success) {
    return v.errorCodes.includes("timeout-or-duplicate")
      ? { ok: false, status: 403, code: "captcha_vencido", message: "La verificación venció. Vuelva a confirmar que no es un robot." }
      : { ok: false, status: 403, code: "captcha_invalido", message: "No pudimos confirmar que no es un robot. Intente de nuevo." };
  }

  const r = await deps.rateLimit(`${input.kind}_correo`, await deps.hash(`correo:${input.email.trim().toLowerCase()}`),
    deps.limits.emailPerWindow, w);
  if (!r.allowed) return tooMany;
  return { ok: true };
}

/** Verificación del token contra Cloudflare (siteverify). */
export async function turnstileSiteverify(
  secret: string, token: string, ip: string | null, fetchImpl: typeof fetch = fetch,
): Promise<{ success: boolean; errorCodes: string[] }> {
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const j = await res.json();
    return { success: j?.success === true, errorCodes: Array.isArray(j?.["error-codes"]) ? j["error-codes"] : [] };
  } catch {
    return { success: false, errorCodes: ["internal-error"] };
  }
}

export function clientIp(headers: Headers): string | null {
  return headers.get("cf-connecting-ip")
    ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? headers.get("x-real-ip")
    ?? null;
}

export interface RegisterDeps {
  createUser(email: string, password: string, fullName: string): Promise<{ userId: string } | { exists: true } | { error: string }>;
  recordLegal(userId: string, email: string): Promise<void>;
  sendConfirmation(email: string): Promise<void>;
  audit(userId: string): Promise<void>;
}

/** Registro ya autorizado por guardPublic. Misma respuesta si la cuenta existía. */
export async function registerAccount(deps: RegisterDeps, input: { email: string; password: string; fullName: string }) {
  const r = await deps.createUser(input.email, input.password, input.fullName);
  if ("error" in r) {
    return { ok: false as const, status: 500, code: "registro", message: "No se pudo crear la cuenta. Intente más tarde." };
  }
  if ("userId" in r) {
    await deps.recordLegal(r.userId, input.email);
    await deps.audit(r.userId);
  }
  // También si ya existía: mismo trabajo visible, mismo correo de Auth (si aún no confirmó), misma respuesta.
  await deps.sendConfirmation(input.email).catch(() => undefined);
  return { ok: true as const, message: GENERIC_ACCOUNT_MESSAGE };
}
