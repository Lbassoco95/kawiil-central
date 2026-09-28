/**
 * Pares de certificado y llave SINTÉTICOS para probar el CSD. Se generan en cada
 * corrida con node-forge; no son del SAT ni de nadie. Imitan la forma de los
 * certificados del SAT: RFC en x500UniqueIdentifier (2.5.4.45) y llave .key como
 * PKCS#8 cifrado (PBES2, 3DES), igual que los .key reales.
 */
import forge from "node-forge";

export type Kind = "csd" | "efirma" | "sin_uso";

export interface Material {
  cerB64: string;
  keyB64: string;
  password: string;
}

const serialFrom = (noCert: string) => Buffer.from(noCert, "ascii").toString("hex");

export function makeMaterial(opts: {
  rfc?: string;
  kind?: Kind;
  password?: string;
  notBefore?: Date;
  notAfter?: Date;
  noCertificado?: string;
} = {}): Material & { keys: forge.pki.rsa.KeyPair } {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serialFrom(opts.noCertificado ?? "30001000000500000001");
  cert.validity.notBefore = opts.notBefore ?? new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = opts.notAfter ?? new Date(Date.now() + 2 * 365 * 86_400_000);
  const attrs = [
    { name: "commonName", value: "EMPRESA SINTETICA SA DE CV" },
    { type: "2.5.4.45", value: `${opts.rfc ?? "AAA010101AAA"} / XEXX010101HNEXXXA4` },
    { type: "2.5.4.5", value: " / XEXX010101HNEXXXA4" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer([{ name: "commonName", value: "AC SINTETICA DE PRUEBA (no es el SAT)" }]);
  const kind = opts.kind ?? "csd";
  const ext: Record<string, unknown>[] = [];
  if (kind === "csd") ext.push({ name: "keyUsage", digitalSignature: true, nonRepudiation: true });
  if (kind === "efirma") {
    ext.push({ name: "keyUsage", digitalSignature: true, nonRepudiation: true, dataEncipherment: true, keyAgreement: true });
    ext.push({ name: "extKeyUsage", emailProtection: true, clientAuth: true });
  }
  cert.setExtensions(ext);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const password = opts.password ?? "contrasena-sintetica-1";
  const encrypted = forge.pki.encryptPrivateKeyInfo(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(keys.privateKey)), password, { algorithm: "3des" });
  return {
    keys,
    cerB64: forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()),
    keyB64: forge.util.encode64(forge.asn1.toDer(encrypted).getBytes()),
    password,
  };
}
