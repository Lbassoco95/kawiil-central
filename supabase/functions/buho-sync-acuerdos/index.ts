// Cron: sincroniza los acuerdos de todos los expedientes vinculados a Búho Legal.
// Por cada organización hace UNA consulta a /mis-acuerdos/ (trae acuerdos de todos
// sus expedientes → económico frente al límite de consultas diarias), hace upsert de
// los nuevos (índice único evita duplicados) y notifica al responsable del juicio.
//
// Protegido por header `x-cron-secret` == secreto CRON_SECRET.
import { createClient } from "npm:@supabase/supabase-js@2";
import { buhoFetch } from "../_shared/buhoClient.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return new Response(JSON.stringify({ success: false, message: "No autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

  const summary = { orgs: 0, nuevos: 0, errores: [] as string[] };

  try {
    // Expedientes vinculados agrupados por organización.
    const { data: expedientes, error } = await admin
      .from("buho_expedientes")
      .select("id, organization_id, project_id, entidad, expediente");
    if (error) throw error;

    const byOrg = new Map<string, typeof expedientes>();
    for (const e of expedientes ?? []) {
      const list = byOrg.get(e.organization_id) ?? [];
      list.push(e);
      byOrg.set(e.organization_id, list);
    }

    for (const [orgId, exps] of byOrg) {
      summary.orgs++;
      const res = await buhoFetch<{ acuerdos?: any[] }>(
        admin,
        orgId,
        "/mis-acuerdos/?tipo=recientes&limit=500",
      );
      if (!res.ok) {
        summary.errores.push(`org ${orgId}: ${res.error}`);
        continue;
      }
      const acuerdos = res.data?.acuerdos ?? [];

      for (const a of acuerdos) {
        // Emparejar el acuerdo con un expediente vinculado (expediente + fuente/entidad).
        const match = exps.find(
          (e) => e.expediente === a.expediente && (!a.fuente || e.entidad === a.fuente),
        );
        if (!match) continue;

        const { data: inserted, error: insErr } = await admin
          .from("buho_acuerdos")
          .insert({
            organization_id: orgId,
            project_id: match.project_id,
            buho_expediente_id: match.id,
            expediente: a.expediente ?? match.expediente,
            fuente: a.fuente ?? null,
            fecha_acuerdo: a.fecha_acuerdo ?? null,
            tipo_acuerdo: a.tipo_acuerdo ?? null,
            contenido: a.contenido ?? null,
            juzgado: a.juzgado ?? null,
            raw: a,
          })
          .select("id")
          .maybeSingle();

        // 23505 = duplicado (ya sincronizado): se ignora silenciosamente.
        if (insErr) {
          if (insErr.code !== "23505") summary.errores.push(`acuerdo: ${insErr.message}`);
          continue;
        }
        if (!inserted) continue;
        summary.nuevos++;

        // Notificar al responsable del juicio.
        const { data: proj } = await admin
          .from("projects")
          .select("responsible_user_id, name")
          .eq("id", match.project_id)
          .single();
        if (proj?.responsible_user_id) {
          await admin.from("notifications").insert({
            user_id: proj.responsible_user_id,
            type: "buho_acuerdo",
            title: `Nuevo acuerdo · ${a.tipo_acuerdo || "actuación"}`,
            body: `${proj.name}: ${(a.contenido || "").slice(0, 180)}`,
            entity_type: "project",
            entity_id: match.project_id,
            source_user_id: null,
            organization_id: orgId,
          });
        }
      }

      await admin
        .from("buho_expedientes")
        .update({ last_synced_at: new Date().toISOString() })
        .in("id", exps.map((e) => e.id));
    }

    return new Response(JSON.stringify({ success: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ success: false, message: e instanceof Error ? e.message : String(e), summary }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
