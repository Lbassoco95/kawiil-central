// Temporal y de solo lectura: un único GET a /admin/simpleProfiles. Se borra al terminar la prueba.
// Exige la llave de servicio (no usuario). Nunca devuelve ni registra el token.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const RUTA = "/admin/simpleProfiles";
const BASE = "https://app.metricool.com/api";

Deno.serve(async (req) => {
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);

  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!service || bearer !== service) return json({ error: "requiere llave de servicio" }, 401);

  const token = Deno.env.get("METRICOOL_USER_TOKEN");
  if (!token) return json({ error: "METRICOOL_USER_TOKEN no está configurado" }, 500);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, service);
  const t0 = Date.now();
  let status = 0;
  let resultado = "error";
  let motivo = "";
  let marcas: unknown[] = [];
  try {
    const r = await fetch(BASE + RUTA, { method: "GET", headers: { "X-Mc-Auth": token } });
    status = r.status;
    if (r.ok) {
      const data = await r.json();
      const lista = Array.isArray(data) ? data : [];
      marcas = lista.map((b: Record<string, unknown>) => ({
        blogId: b.id, userId: b.userId, nombre: b.label ?? b.title,
        redes: ["instagram", "facebook", "linkedinCompany", "twitter", "tiktok", "youtube", "gmb", "pinterest", "threads", "bluesky"]
          .filter((k) => b[k]),
      }));
      resultado = "ok";
    } else {
      motivo = r.status === 401 || r.status === 403 ? "token rechazado o plan sin acceso a la API" : `respuesta HTTP ${r.status}`;
    }
  } catch (e) {
    motivo = "sin conexión con app.metricool.com: " + (e instanceof Error ? e.name : "error");
  }

  const { data: org } = await db.from("organizations").select("id").limit(2);
  await db.from("mk_bitacora").insert({
    organization_id: org && org.length === 1 ? org[0].id : null,
    agente: "sistema",
    accion: "metricool_consulta_perfiles",
    resultado,
    detalle: { ruta: RUTA, metodo: "GET", estado: status, duracion_ms: Date.now() - t0, motivo },
  });
  return json({ resultado, estado: status, motivo, marcas });
});
