// Conector de LECTURA de Metricool para el módulo Marketing.
// - Marca fija (METRICOOL_BLOG_ID / METRICOOL_USER_ID del entorno): no puede consultar otra marca.
// - Solo las operaciones de _shared/metricoolAllowlist.ts, siempre GET.
// - Autenticación propia: cabecera x-marketing-secret = MARKETING_CONNECTOR_SECRET.
//   No acepta cron_secret ni la llave de servicio como credencial.
// - Cada llamada (también las rechazadas) queda en mk_api_log. Nunca devuelve ni registra el token.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { construirPeticion, ErrorLista } from "../../functions/_shared/metricoolAllowlist.ts";

const MAX_BYTES = 5_000_000;
const TIMEOUT_MS = 20_000;

function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);

  const secreto = Deno.env.get("MARKETING_CONNECTOR_SECRET") ?? "";
  const recibido = req.headers.get("x-marketing-secret") ?? "";
  if (!secreto || !igual(secreto, recibido)) return json({ error: "no autorizado" }, 401);

  const token = Deno.env.get("METRICOOL_USER_TOKEN") ?? "";
  const marca = { userId: Deno.env.get("METRICOOL_USER_ID") ?? "", blogId: Deno.env.get("METRICOOL_BLOG_ID") ?? "" };
  if (!token || !marca.userId || !marca.blogId) return json({ error: "faltan variables METRICOOL_*" }, 500);

  let cuerpo: { operacion?: string; entrada?: Record<string, string | number | boolean> };
  try { cuerpo = await req.json(); } catch { return json({ error: "JSON inválido" }, 400); }
  const operacion = String(cuerpo.operacion ?? "");

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: orgs } = await db.from("organizations").select("id").limit(2);
  const organization_id = orgs && orgs.length === 1 ? orgs[0].id : null;
  const t0 = Date.now();
  const registrar = (ok: boolean, estado: number, ruta: string, motivo: string) =>
    db.from("mk_api_log").insert({
      organization_id, operacion, ruta, metodo: "GET", estado, ok, duracion_ms: Date.now() - t0, motivo,
    });

  let peticion;
  try {
    peticion = construirPeticion(operacion, cuerpo.entrada ?? {}, marca);
  } catch (e) {
    const motivo = e instanceof ErrorLista ? e.message : "entrada inválida";
    await registrar(false, 0, "(rechazada antes de salir)", motivo);
    return json({ ok: false, error: motivo }, 400);
  }

  const ruta = new URL(peticion.url).pathname;
  try {
    const r = await fetch(peticion.url, {
      method: "GET", headers: { "X-Mc-Auth": token, Accept: "application/json, text/csv" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const texto = (await r.text()).slice(0, MAX_BYTES);
    let datos: unknown = texto;
    try { datos = JSON.parse(texto); } catch { /* CSV u otro texto */ }
    const motivo = r.ok ? "" : r.status === 401 || r.status === 403 ? "token rechazado o plan sin acceso" : `HTTP ${r.status}`;
    await registrar(r.ok, r.status, ruta, motivo);
    return json({ ok: r.ok, estado: r.status, motivo, datos: r.ok ? datos : null }, r.ok ? 200 : 502);
  } catch (e) {
    const motivo = "sin conexión con Metricool: " + (e instanceof Error ? e.name : "error");
    await registrar(false, 0, ruta, motivo);
    return json({ ok: false, error: motivo }, 502);
  }
});
