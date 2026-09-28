/**
 * Portal del cliente — validación del CSD ANTES de guardarlo (corrección C1).
 *
 * Todo ocurre en memoria, en la Edge. Comprueba:
 *   a) que la contraseña abre la llave privada (.key = PKCS#8 cifrado del SAT),
 *   b) que la llave corresponde al certificado (mismo módulo y exponente RSA),
 *   c) que el certificado es de SELLO DIGITAL y no una e.firma (ver límite abajo),
 *   d) que el RFC del certificado es del cliente y que está vigente.
 * Si algo falla se devuelve un código y un mensaje para el usuario SIN detalles
 * criptográficos. Nada de esto escribe en logs ni en bitácora la llave ni la
 * contraseña: el llamador solo registra el código.
 *
 * Cómo se distingue CSD de e.firma (heurística, límite documentado):
 *   El SAT emite la e.firma con uso de llave «firma digital, no repudio, cifrado
 *   de datos y acuerdo de llaves» (y usos extendidos de correo/cliente); el CSD
 *   solo con «firma digital y no repudio». Si el certificado trae cifrado de datos,
 *   acuerdo de llaves o esos usos extendidos → e.firma. Si trae solo firma/no
 *   repudio → CSD. Si no trae la extensión de uso de llave → no se puede
 *   distinguir y se RECHAZA (falla cerrado). Debe confirmarse con un CSD y una
 *   e.firma reales en el ensayo de staging (RUNBOOK §8); este repo no tiene
 *   muestras reales y no debe tenerlas.
 *
 * Nota: JavaScript no permite borrar cadenas de memoria. Se minimiza su vida:
 * las variables salen de alcance al terminar y nunca se guardan fuera.
 */
// @deno-types="npm:@types/node-forge@1.3.11"
import forge from "npm:node-forge@1.3.1";
import { isRfcFormat, normalizeRfc } from "./validate.ts";

export type CsdRejectCode =
  | "certificado_invalido"
  | "es_efirma"
  | "tipo_indeterminado"
  | "rfc_ajeno"
  | "vencido"
  | "aun_no_vigente"
  | "llave_o_contrasena"
  | "llave_no_corresponde";

export const CSD_REJECT_MESSAGES: Record<CsdRejectCode, string> = {
  certificado_invalido: "El archivo .cer no es un certificado válido del SAT.",
  es_efirma: "Ese certificado es una e.firma (FIEL), no un certificado de sello digital. Cargue su CSD.",
  tipo_indeterminado: "No pudimos confirmar que el certificado sea de sello digital. Escríbanos para revisarlo.",
  rfc_ajeno: "El certificado no pertenece al RFC de esta empresa.",
  vencido: "El certificado ya venció. Tramite uno nuevo en el SAT.",
  aun_no_vigente: "El certificado todavía no es vigente.",
  llave_o_contrasena: "La llave privada (.key) o su contraseña no son correctas.",
  llave_no_corresponde: "La llave privada (.key) no corresponde a este certificado.",
};

export interface CsdMeta {
  serialHex: string;
  noCertificado: string | null;
  notBefore: string;
  notAfter: string;
  subjectRfc: string;
  tipo: "csd";
}

export type CsdValidation = { ok: true; meta: CsdMeta } | { ok: false; code: CsdRejectCode; message: string };

const fail = (code: CsdRejectCode): CsdValidation => ({ ok: false, code, message: CSD_REJECT_MESSAGES[code] });

function derFromB64(b64: string): string {
  return forge.util.decode64(b64.replace(/^data:[^,]*,/, "").replace(/\s+/g, ""));
}

/** RFC del sujeto: x500UniqueIdentifier (2.5.4.45) «RFC / CURP» o serialNumber (2.5.4.5). */
export function rfcFromCertificate(cert: forge.pki.Certificate): string | null {
  const values = cert.subject.attributes
    .filter((a) => a.type === "2.5.4.45" || a.type === "2.5.4.5" || a.shortName === "CN")
    .map((a) => String(a.value ?? ""));
  for (const v of values) {
    for (const tok of v.split(/[\s/]+/)) {
      const n = normalizeRfc(tok);
      if (isRfcFormat(n)) return n;
    }
  }
  return null;
}

export function certificateKind(cert: forge.pki.Certificate): "csd" | "efirma" | "indeterminado" {
  const ku = cert.getExtension("keyUsage") as Record<string, boolean> | null;
  const eku = cert.getExtension("extKeyUsage") as Record<string, boolean> | null;
  if (eku && (eku.emailProtection || eku.clientAuth)) return "efirma";
  if (!ku) return "indeterminado";
  if (ku.dataEncipherment || ku.keyAgreement) return "efirma";
  if (ku.digitalSignature || ku.nonRepudiation) return "csd";
  return "indeterminado";
}

/** El SAT codifica el número de certificado (20 dígitos) como ASCII en el serial hexadecimal. */
export function noCertificadoFromSerial(serialHex: string): string | null {
  const hex = serialHex.length % 2 ? `0${serialHex}` : serialHex;
  let out = "";
  for (let i = 0; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return /^\d{20}$/.test(out) ? out : null;
}

export function validateCsdMaterial(input: {
  cerB64: string;
  keyB64: string;
  password: string;
  clientRfcs: string[];
  now?: Date;
}): CsdValidation {
  const now = input.now ?? new Date();
  let cert: forge.pki.Certificate;
  try {
    cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(derFromB64(input.cerB64)));
  } catch {
    return fail("certificado_invalido");
  }

  const kind = certificateKind(cert);
  if (kind === "efirma") return fail("es_efirma");
  if (kind === "indeterminado") return fail("tipo_indeterminado");

  const rfc = rfcFromCertificate(cert);
  const own = new Set(input.clientRfcs.map((r) => normalizeRfc(r)));
  if (!rfc || !own.has(rfc)) return fail("rfc_ajeno");
  if (cert.validity.notAfter <= now) return fail("vencido");
  if (cert.validity.notBefore > now) return fail("aun_no_vigente");

  let matches = false;
  try {
    const info = forge.pki.decryptPrivateKeyInfo(forge.asn1.fromDer(derFromB64(input.keyB64)), input.password);
    if (!info) return fail("llave_o_contrasena");
    const key = forge.pki.privateKeyFromAsn1(info) as forge.pki.rsa.PrivateKey;
    const pub = cert.publicKey as forge.pki.rsa.PublicKey;
    matches = key.n.equals(pub.n) && key.e.equals(pub.e);
  } catch {
    return fail("llave_o_contrasena");
  }
  if (!matches) return fail("llave_no_corresponde");

  return {
    ok: true,
    meta: {
      serialHex: cert.serialNumber,
      noCertificado: noCertificadoFromSerial(cert.serialNumber),
      notBefore: cert.validity.notBefore.toISOString(),
      notAfter: cert.validity.notAfter.toISOString(),
      subjectRfc: rfc,
      tipo: "csd",
    },
  };
}
