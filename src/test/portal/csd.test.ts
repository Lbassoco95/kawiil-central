/**
 * C1 + C5: el CSD se valida en memoria antes de guardar nada.
 * Todo el material es SINTÉTICO (csdFixtures.ts). En cada fallo: cero escrituras.
 */
import { describe, it, expect, vi } from "vitest";
import { makeMaterial } from "./csdFixtures";
import { validateCsdMaterial, noCertificadoFromSerial, CSD_REJECT_MESSAGES } from "../../../supabase/functions/_shared/portal/csdValidate.ts";
import { registerCsd, secretsProblem, type CsdRegisterDeps } from "../../../supabase/functions/_shared/portal/csdRegister.ts";

const RFC = "AAA010101AAA";
const good = makeMaterial({ rfc: RFC });

function deps(over: Partial<CsdRegisterDeps> = {}) {
  const store = vi.fn(async () => ({ registryId: "reg-1" }));
  const audit = vi.fn(async () => undefined);
  const encrypt = vi.fn(async (plain: string, secret: string) => `enc(${secret.slice(0, 3)}:${plain.length})`);
  const d: CsdRegisterDeps = {
    via: "portal",
    secrets: { key: "k".repeat(32), password: "p".repeat(32), fiel: "f".repeat(32) },
    preconditions: async () => ({ ok: true, missing: [] }),
    clientRfcs: async () => [RFC],
    encrypt,
    fingerprint: async () => "huella",
    store,
    audit,
    ...over,
  };
  return { d, store, audit, encrypt };
}

describe("C1 · validación del CSD en memoria", () => {
  it("par válido → acepta y devuelve el número de certificado", () => {
    const v = validateCsdMaterial({ ...good, clientRfcs: [RFC] });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.meta).toMatchObject({ subjectRfc: RFC, noCertificado: "30001000000500000001", tipo: "csd" });
  });
  it.each([
    ["llave de otro certificado", () => ({ ...good, keyB64: makeMaterial({ rfc: RFC }).keyB64, password: "contrasena-sintetica-1" }), "llave_no_corresponde"],
    ["contraseña incorrecta", () => ({ ...good, password: "otra-contrasena" }), "llave_o_contrasena"],
    ["e.firma cargada como CSD", () => makeMaterial({ rfc: RFC, kind: "efirma" }), "es_efirma"],
    ["certificado sin uso de llave (no distinguible)", () => makeMaterial({ rfc: RFC, kind: "sin_uso" }), "tipo_indeterminado"],
    ["certificado vencido", () => makeMaterial({ rfc: RFC, notBefore: new Date("2020-01-01"), notAfter: new Date("2024-01-01") }), "vencido"],
    ["RFC ajeno", () => makeMaterial({ rfc: "BBB010101BBB" }), "rfc_ajeno"],
    ["archivo que no es certificado", () => ({ ...good, cerB64: Buffer.from("hola").toString("base64") }), "certificado_invalido"],
    ["llave basura", () => ({ ...good, keyB64: Buffer.from("no es llave").toString("base64") }), "llave_o_contrasena"],
  ])("%s → rechaza", (_n, mk, code) => {
    const v = validateCsdMaterial({ ...mk(), clientRfcs: [RFC] });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe(code);
      expect(v.message).toBe(CSD_REJECT_MESSAGES[code as keyof typeof CSD_REJECT_MESSAGES]);
      // El mensaje no revela detalles criptográficos.
      expect(v.message).not.toMatch(/pkcs|asn|rsa|modul|pbes|des|padding|exponent/i);
    }
  });
  it("número de certificado desde el serial hexadecimal del SAT", () => {
    expect(noCertificadoFromSerial(Buffer.from("30001000000500003416").toString("hex"))).toBe("30001000000500003416");
    expect(noCertificadoFromSerial("0a1b")).toBeNull();
  });
});

describe("C1/C2/C5 · alta del CSD: si algo falla, cero filas", () => {
  it("con todo en orden: cifra con el secreto de la llave (cer/key) y con el de la contraseña, y guarda UNA vez", async () => {
    const { d, store, audit, encrypt } = deps();
    const r = await registerCsd(d, good);
    expect(r.ok).toBe(true);
    expect(store).toHaveBeenCalledTimes(1);
    const secretsUsed = encrypt.mock.calls.map((c) => c[1]);
    expect(secretsUsed).toEqual(["k".repeat(32), "k".repeat(32), "p".repeat(32)]);
    expect(secretsUsed).not.toContain("f".repeat(32));
    expect(audit).toHaveBeenCalledWith("csd_carga", expect.objectContaining({ via: "portal" }));
  });
  const fallos: [string, Partial<CsdRegisterDeps>, Partial<typeof good>, string][] = [
    ["contraseña incorrecta", {}, { password: "mala" }, "llave_o_contrasena"],
    ["llave de otro certificado", {}, { keyB64: makeMaterial({ rfc: RFC }).keyB64 }, "llave_no_corresponde"],
    ["RFC ajeno", { clientRfcs: async () => ["ZZZ010101ZZZ"] }, {}, "rfc_ajeno"],
    ["autorización pendiente", { preconditions: async () => ({ ok: false, missing: [{ key: "aviso_privacidad", label: "Aviso de privacidad aceptado" }] }) }, {}, "autorizacion_pendiente"],
    ["secreto de llave = secreto de e.firma", { secrets: { key: "f".repeat(32), password: "p".repeat(32), fiel: "f".repeat(32) } }, {}, "no_configurado"],
    ["secreto de contraseña ausente", { secrets: { key: "k".repeat(32), password: null, fiel: "f".repeat(32) } }, {}, "no_configurado"],
  ];
  it.each(fallos)("%s → no guarda nada y deja bitácora sin secretos", async (_n, over, input, code) => {
    const { d, store, audit, encrypt } = deps(over);
    const r = await registerCsd(d, { ...good, ...input });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(code);
    expect(store).not.toHaveBeenCalled();
    expect(encrypt).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith("csd_carga_rechazada", expect.objectContaining({ motivo: code }));
    const logged = JSON.stringify(audit.mock.calls);
    expect(logged).not.toContain(good.password);
    expect(logged).not.toContain(good.keyB64.slice(0, 40));
  });
  it("el mensaje de autorización pendiente dice qué falta", async () => {
    const { d } = deps({ preconditions: async () => ({ ok: false, missing: [{ key: "carta_instruccion", label: "Carta de instrucción registrada y vigente" }] }) });
    const r = await registerCsd(d, good);
    expect(!r.ok && r.message).toMatch(/Carta de instrucción registrada y vigente/);
  });
  it("secretos: tres distintos y largos", () => {
    expect(secretsProblem({ key: "a".repeat(32), password: "b".repeat(32), fiel: "c".repeat(32) })).toBeNull();
    expect(secretsProblem({ key: "a".repeat(32), password: "a".repeat(32), fiel: "c".repeat(32) })).toBe("repetidos");
    expect(secretsProblem({ key: "corto", password: "b".repeat(32), fiel: "c".repeat(32) })).toBe("faltan");
  });
});
