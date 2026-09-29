#!/usr/bin/env node
/**
 * Rotación de los secretos del CSD del portal (RUNBOOK §8). SIMULA por defecto.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   OLD_KEY_SECRET=… NEW_KEY_SECRET=…            # PORTAL_CSD_KEY_SECRET (cer/key)
 *   OLD_PASSWORD_SECRET=… NEW_PASSWORD_SECRET=…  # PORTAL_CSD_SECRET (contraseña)
 *   node tools/portal/rotate-csd-secrets.mjs [--aplicar]
 *
 * Descifra con el secreto viejo y cifra con el nuevo, fila por fila; si una fila
 * no abre con el secreto viejo, se detiene sin tocar nada más. Nunca imprime
 * llaves, certificados ni contraseñas: solo conteos e identificadores.
 * Solo toca filas csd_sello registradas por el portal (portal_csd_registry).
 */
import { createClient } from "@supabase/supabase-js";
import { reencrypt, decrypt } from "./csdCrypto.mjs";

const apply = process.argv.includes("--aplicar");
const env = (k) => process.env[k] ?? "";
const url = env("SUPABASE_URL"), service = env("SUPABASE_SERVICE_ROLE_KEY");
const pairs = {
  key: [env("OLD_KEY_SECRET"), env("NEW_KEY_SECRET")],
  password: [env("OLD_PASSWORD_SECRET"), env("NEW_PASSWORD_SECRET")],
};
if (!url || !service) { console.error("Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY."); process.exit(2); }
for (const [n, [o, w]] of Object.entries(pairs)) {
  if ((o || w) && (!o || !w || w.length < 32 || o === w)) { console.error(`Par de secretos «${n}» incompleto, corto (<32) o repetido.`); process.exit(2); }
}
if (pairs.key[1] && pairs.key[1] === pairs.password[1]) { console.error("El secreto nuevo de la llave y el de la contraseña deben ser distintos."); process.exit(2); }

const db = createClient(url, service, { auth: { persistSession: false } });
const { data: reg, error } = await db.from("portal_csd_registry").select("id, certificate_id, key_secret_version, password_secret_version");
if (error) { console.error("No se pudo leer el registro de CSD."); process.exit(1); }
console.log(`${reg.length} CSD registrados por el portal. Modo: ${apply ? "APLICAR" : "simulación"}.`);

const planned = [];
for (const r of reg) {
  const item = { registry: r.id, cert: r.certificate_id };
  if (pairs.key[0]) {
    const { data: c } = await db.from("client_sat_certificates").select("cert_ciphertext, key_ciphertext").eq("id", r.certificate_id).single();
    try { await decrypt(c.key_ciphertext, pairs.key[0]); } catch { console.error(`El CSD ${r.id} no abre con OLD_KEY_SECRET. Nada se modificó.`); process.exit(1); }
    item.cert_ciphertext = await reencrypt(c.cert_ciphertext, ...pairs.key);
    item.key_ciphertext = await reencrypt(c.key_ciphertext, ...pairs.key);
    item.key_secret_version = r.key_secret_version + 1;
  }
  if (pairs.password[0]) {
    const { data: s } = await db.from("portal_csd_secrets").select("password_ciphertext").eq("certificate_id", r.certificate_id).single();
    try { await decrypt(s.password_ciphertext, pairs.password[0]); } catch { console.error(`La contraseña del CSD ${r.id} no abre con OLD_PASSWORD_SECRET. Nada se modificó.`); process.exit(1); }
    item.password_ciphertext = await reencrypt(s.password_ciphertext, ...pairs.password);
    item.password_secret_version = r.password_secret_version + 1;
  }
  planned.push(item);
}
console.log(`Verificado: ${planned.length} filas abren con los secretos viejos.`);
if (!apply) { console.log("Simulación terminada. Repita con --aplicar y DESPUÉS cambie los secretos en Supabase."); process.exit(0); }
for (const p of planned) {
  if (p.key_ciphertext) {
    await db.from("client_sat_certificates").update({ cert_ciphertext: p.cert_ciphertext, key_ciphertext: p.key_ciphertext }).eq("id", p.cert);
    await db.from("portal_csd_registry").update({ key_secret_version: p.key_secret_version }).eq("id", p.registry);
  }
  if (p.password_ciphertext) {
    await db.from("portal_csd_secrets").update({ password_ciphertext: p.password_ciphertext }).eq("certificate_id", p.cert);
    await db.from("portal_csd_registry").update({ password_secret_version: p.password_secret_version }).eq("id", p.registry);
  }
}
console.log(`Rotadas ${planned.length} filas. Ahora cambie PORTAL_CSD_KEY_SECRET / PORTAL_CSD_SECRET en Supabase y vuelva a desplegar portal-api.`);
