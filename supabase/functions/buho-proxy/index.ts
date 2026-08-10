// Edge function `buho-proxy`: puente autenticado entre el front de Kawiil y la API
// de Búho Legal (monitoreo de expedientes). El cliente nunca ve las credenciales ni
// el token de Búho — todo pasa por aquí con el token cacheado en `buho_auth`.
//
// Acciones (body: { action, ...params }):
//   estado                                  -> GET /cuenta/estado/
//   fuentes                                 -> GET /fuentes/
//   circuitos                               -> GET /circuitos-federales/
//   organismos { circuito_id }              -> GET /organismos-federales/{id}/
//   juzgados { entidad }                    -> GET /juzgados/{entidad}/
//   vincular { project_id, entidad, expediente, juzgado_id, tipo_expediente?, nombre?, asunto?, notas? }
//   acuerdos { project_id }                 -> sincroniza y devuelve acuerdos del expediente
//   desvincular { project_id }
import { createClient } from "npm:@supabase/supabase-js@2";
import { buhoFetch } from "../_shared/buhoClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await userClient.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ success: false, message: "No autenticado" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: profile } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();
    const orgId = profile?.organization_id as string | undefined;
    if (!orgId) return json({ success: false, message: "Sin organización" }, 400);

    const body = await req.json().catch(() => ({}));
    const action = body.action as string;

    switch (action) {
      case "estado":
        return json(await buhoFetch(admin, orgId, "/cuenta/estado/"));

      case "fuentes":
        return json(await buhoFetch(admin, orgId, "/fuentes/"));

      case "circuitos":
        return json(await buhoFetch(admin, orgId, "/circuitos-federales/"));

      case "organismos":
        return json(
          await buhoFetch(admin, orgId, `/organismos-federales/${Number(body.circuito_id)}/`),
        );

      case "juzgados":
        return json(
          await buhoFetch(admin, orgId, `/juzgados/${encodeURIComponent(String(body.entidad))}/`),
        );

      case "vincular": {
        const { project_id, entidad, expediente, juzgado_id, tipo_expediente, nombre, asunto, notas } = body;
        if (!project_id || !entidad || !expediente || !juzgado_id) {
          return json({ success: false, message: "Faltan datos para vincular" }, 400);
        }
        const payload: Record<string, unknown> = {
          expediente,
          nombre: nombre || expediente,
          juzgado_id: Number(juzgado_id),
          asunto: asunto || null,
          notas: notas || null,
        };
        if (entidad === "federal" && tipo_expediente) payload.tipo_expediente = tipo_expediente;

        const created = await buhoFetch<{ id?: number }>(
          admin,
          orgId,
          `/expedientes/create/${encodeURIComponent(String(entidad))}/`,
          { method: "POST", body: payload },
        );
        if (!created.ok) return json(created, created.status || 400);

        const { data: row, error } = await admin
          .from("buho_expedientes")
          .upsert(
            {
              organization_id: orgId,
              project_id,
              buho_id: created.data?.id ?? null,
              entidad,
              expediente,
              juzgado_id: Number(juzgado_id),
              tipo_expediente: tipo_expediente || null,
              nombre: nombre || expediente,
              created_by: user.id,
            },
            { onConflict: "project_id" },
          )
          .select()
          .single();
        if (error) return json({ success: false, message: error.message }, 400);
        return json({ success: true, data: row });
      }

      case "acuerdos": {
        const projectId = body.project_id as string;
        if (!projectId) return json({ success: false, message: "Falta project_id" }, 400);
        const { data: exp } = await admin
          .from("buho_expedientes")
          .select("*")
          .eq("project_id", projectId)
          .maybeSingle();
        if (!exp) return json({ success: false, message: "Expediente no vinculado" }, 404);

        const q = new URLSearchParams({
          expediente: exp.expediente,
          entidad: exp.entidad,
          limit: "200",
          tipo: "recientes",
        });
        const res = await buhoFetch<{ acuerdos?: any[] }>(admin, orgId, `/mis-acuerdos/?${q}`);
        if (res.ok) {
          const acuerdos = res.data?.acuerdos ?? [];
          for (const a of acuerdos) {
            // Los duplicados los rechaza el índice único (expediente+fecha+hash de
            // contenido); supabase-js devuelve el error en el resultado sin lanzar,
            // así que simplemente lo ignoramos.
            await admin.from("buho_acuerdos").insert({
              organization_id: orgId,
              project_id: projectId,
              buho_expediente_id: exp.id,
              expediente: a.expediente ?? exp.expediente,
              fuente: a.fuente ?? null,
              fecha_acuerdo: a.fecha_acuerdo ?? null,
              tipo_acuerdo: a.tipo_acuerdo ?? null,
              contenido: a.contenido ?? null,
              juzgado: a.juzgado ?? null,
              raw: a,
            });
          }
          await admin
            .from("buho_expedientes")
            .update({ last_synced_at: new Date().toISOString() })
            .eq("id", exp.id);
        }

        const { data: stored } = await admin
          .from("buho_acuerdos")
          .select("*")
          .eq("project_id", projectId)
          .order("fecha_acuerdo", { ascending: false });
        return json({ success: true, data: stored ?? [], sync_ok: res.ok, sync_error: res.error });
      }

      case "desvincular": {
        const projectId = body.project_id as string;
        const { data: exp } = await admin
          .from("buho_expedientes")
          .select("id, buho_id")
          .eq("project_id", projectId)
          .maybeSingle();
        if (exp?.buho_id) {
          await buhoFetch(admin, orgId, `/expedientes/delete/${exp.buho_id}/`, { method: "DELETE" });
        }
        await admin.from("buho_expedientes").delete().eq("project_id", projectId);
        return json({ success: true });
      }

      default:
        return json({ success: false, message: `Acción desconocida: ${action}` }, 400);
    }
  } catch (e) {
    return json({ success: false, message: e instanceof Error ? e.message : String(e) }, 500);
  }
});
