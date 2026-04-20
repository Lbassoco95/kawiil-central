/**
 * Parser X.509 para certificados SAT (.cer DER).
 *
 * Extrae:
 *  - notBefore / notAfter (vigencia)
 *  - serialNumber (numero de serie del certificado SAT)
 *  - subjectRfc (OID 2.5.4.45 x500UniqueIdentifier; algunos certs viejos lo ponen en serialNumber 2.5.4.5)
 */
import { X509Certificate } from "https://esm.sh/@peculiar/x509@1.9.7";
import { base64ToBytes } from "./moffinFielCrypto.ts";

const OID_UNIQUE_IDENTIFIER = "2.5.4.45";
const OID_SERIAL_NUMBER = "2.5.4.5";

export type ParsedSatCertificate = {
  notBefore: string;
  notAfter: string;
  serialNumber: string;
  subjectRfc: string | null;
  subject: string;
  issuer: string;
};

function buildAttrIndex(subjectDn: string): Map<string, string> {
  const map = new Map<string, string>();
  const parts = subjectDn.split(",").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!map.has(key)) map.set(key, value);
  }
  return map;
}

function looksLikeRfc(value: string | undefined): value is string {
  if (!value) return false;
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/i.test(value.trim());
}

function extractRfcFromSubject(cert: X509Certificate): string | null {
  const idx = buildAttrIndex(cert.subject);

  const candidates = [
    idx.get(OID_UNIQUE_IDENTIFIER),
    idx.get(OID_SERIAL_NUMBER),
    idx.get("uniqueIdentifier"),
    idx.get("serialNumber"),
    idx.get("SERIALNUMBER"),
    idx.get("UID"),
    idx.get("CN"),
  ];

  for (const value of candidates) {
    if (looksLikeRfc(value)) return value!.trim().toUpperCase();
    if (typeof value === "string") {
      const tokens = value.split(/[\s/]+/);
      for (const tok of tokens) {
        if (looksLikeRfc(tok)) return tok.trim().toUpperCase();
      }
    }
  }
  return null;
}

export function parseSatCertificate(certBase64: string): ParsedSatCertificate {
  const der = base64ToBytes(certBase64);
  const cert = new X509Certificate(der);
  return {
    notBefore: cert.notBefore.toISOString(),
    notAfter: cert.notAfter.toISOString(),
    serialNumber: cert.serialNumber,
    subjectRfc: extractRfcFromSubject(cert),
    subject: cert.subject,
    issuer: cert.issuer,
  };
}

/** Comparacion case-insensitive del RFC base (sin homoclave de sucursal). */
export function rfcBasesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (v: string) => v.trim().toUpperCase().replace(/\s+/g, "");
  return norm(a) === norm(b);
}
