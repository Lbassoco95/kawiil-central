/**
 * Portal del cliente — alta del CSD (correcciones C1, C2 y C5).
 *
 * Orden, y en cada paso «si falla, no se guarda nada»:
 *   1. Secretos: tres distintos y de ≥32 caracteres (llave, contraseña, e.firma). Si no, cerrado.
 *   2. Autorización previa (C2): la base dice qué falta (aviso de privacidad y, en
 *      básico, contrato de uso para quien carga desde el portal; carta de instrucción
 *      vigente para el equipo en central).
 *   3. Validación criptográfica en memoria (C1).
 *   4. Cifrado y guardado en UNA transacción (RPC portal_csd_store).
 * Cada intento, aceptado o rechazado, deja bitácora con un código; nunca con la
 * llave, la contraseña ni detalles criptográficos.
 */
import { validateCsdMaterial, type CsdRejectCode } from "./csdValidate.ts";

export interface CsdSecrets {
  /** PORTAL_CSD_KEY_SECRET: cifra .cer y .key del CSD. */
  key?: string | null;
  /** PORTAL_CSD_SECRET: cifra la contraseña de la llave. */
  password?: string | null;
  /** MOFFIN_FIEL_SECRET: el de la e.firma. Solo se usa para comprobar que sea distinto. */
  fiel?: string | null;
}

export interface CsdStoreRow {
  certCiphertext: string;
  keyCiphertext: string;
  passwordCiphertext: string;
  serialHex: string;
  subjectRfc: string;
  notBefore: string;
  notAfter: string;
  fingerprint: string;
}

export interface CsdRegisterDeps {
  via: "portal" | "central";
  secrets: CsdSecrets;
  preconditions(): Promise<{ ok: boolean; missing: { key: string; label: string }[] }>;
  clientRfcs(): Promise<string[]>;
  encrypt(plain: string, secret: string): Promise<string>;
  fingerprint(cerB64: string): Promise<string>;
  store(row: CsdStoreRow): Promise<{ registryId: string; duplicate?: boolean }>;
  audit(action: "csd_carga" | "csd_carga_rechazada", details: Record<string, unknown>): Promise<void>;
  now?: Date;
}

export type CsdRegisterResult =
  | { ok: true; registryId: string; meta: { serial: string; noCertificado: string | null; notBefore: string; notAfter: string } }
  | { ok: false; status: number; code: string; message: string; missing?: { key: string; label: string }[] };

export function secretsProblem(s: CsdSecrets): string | null {
  const vals = [s.key, s.password, s.fiel];
  if (vals.some((v) => !v || v.length < 32)) return "faltan";
  if (new Set(vals).size !== 3) return "repetidos";
  return null;
}

export async function registerCsd(
  deps: CsdRegisterDeps,
  input: { cerB64: string; keyB64: string; password: string },
): Promise<CsdRegisterResult> {
  const reject = async (status: number, code: string, message: string, missing?: { key: string; label: string }[]) => {
    await deps.audit("csd_carga_rechazada", { via: deps.via, motivo: code, ...(missing ? { falta: missing.map((m) => m.key) } : {}) });
    return { ok: false as const, status, code, message, missing };
  };

  const sp = secretsProblem(deps.secrets);
  if (sp) return reject(503, "no_configurado", "El resguardo de certificados no está configurado. Kawiil debe completarlo antes de recibir su CSD.");

  const pre = await deps.preconditions();
  if (!pre.ok) {
    return reject(403, "autorizacion_pendiente",
      `Antes de recibir su certificado falta: ${pre.missing.map((m) => m.label).join("; ")}.`, pre.missing);
  }

  const v = validateCsdMaterial({ ...input, clientRfcs: await deps.clientRfcs(), now: deps.now });
  if (!v.ok) return reject(400, v.code satisfies CsdRejectCode, v.message);

  const row: CsdStoreRow = {
    certCiphertext: await deps.encrypt(input.cerB64, deps.secrets.key!),
    keyCiphertext: await deps.encrypt(input.keyB64, deps.secrets.key!),
    passwordCiphertext: await deps.encrypt(input.password, deps.secrets.password!),
    serialHex: v.meta.serialHex,
    subjectRfc: v.meta.subjectRfc,
    notBefore: v.meta.notBefore,
    notAfter: v.meta.notAfter,
    fingerprint: await deps.fingerprint(input.cerB64),
  };
  const stored = await deps.store(row);
  if (stored.duplicate) return reject(409, "ya_cargado", "Ese certificado ya estaba cargado.");
  await deps.audit("csd_carga", { via: deps.via, serie: v.meta.serialHex, vence: v.meta.notAfter });
  return {
    ok: true,
    registryId: stored.registryId,
    meta: { serial: v.meta.serialHex, noCertificado: v.meta.noCertificado, notBefore: v.meta.notBefore, notAfter: v.meta.notAfter },
  };
}
