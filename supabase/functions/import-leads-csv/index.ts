import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^\ufeff/, ""));
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    header.forEach((h, j) => {
      row[h] = cols[j] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function norm(s: string | undefined): string | null {
  if (!s || !s.trim()) return null;
  return s.trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await userClient.from("profiles")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    const orgId = profile?.organization_id as string | undefined;
    if (!orgId) {
      return new Response(JSON.stringify({ error: "Sin organización" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const form = await req.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return new Response(JSON.stringify({ error: "Falta archivo file en multipart" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const text = await file.text();
    const records = parseCsv(text);

    const svc = createClient(supabaseUrl, serviceKey);

    const { data: regStage } = await svc.from("pipeline_stages")
      .select("id")
      .eq("organization_id", orgId)
      .eq("slug", "registrado")
      .maybeSingle();

    if (!regStage?.id) {
      return new Response(JSON.stringify({ error: "No hay etapa registrado para la organización" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let inserted = 0;
    let duplicates = 0;
    const errors: string[] = [];

    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      const fullName = norm(r.full_name || r.nombre || r.name) || "Sin nombre";
      const email = norm(r.email || r.correo)?.toLowerCase() ?? null;
      const metaLeadId = norm(r.meta_lead_id || r.meta_id);
      const phone = norm(r.phone || r.telefono || r.tel);

      if (email) {
        const { data: ex } = await svc.from("leads")
          .select("id")
          .eq("organization_id", orgId)
          .ilike("email", email)
          .maybeSingle();
        if (ex) {
          duplicates++;
          continue;
        }
      }
      if (metaLeadId) {
        const { data: ex2 } = await svc.from("leads")
          .select("id")
          .eq("organization_id", orgId)
          .eq("meta_lead_id", metaLeadId)
          .maybeSingle();
        if (ex2) {
          duplicates++;
          continue;
        }
      }

      const { data: ins, error: insErr } = await svc.from("leads").insert({
        organization_id: orgId,
        full_name: fullName,
        email,
        phone,
        whatsapp: norm(r.whatsapp),
        company_name: norm(r.company_name || r.empresa),
        campaign_name: norm(r.campaign_name || r.campana),
        meta_lead_id: metaLeadId,
        stage_id: regStage.id,
        source: "import",
        priority: "medium",
      }).select("id").single();

      if (insErr) {
        errors.push(`Fila ${i + 2}: ${insErr.message}`);
        continue;
      }
      inserted++;
      if (ins?.id) {
        await svc.from("lead_activities").insert({
          lead_id: ins.id,
          user_id: user.id,
          type: "lead_created",
          metadata: { source: "csv_import" },
        });
      }
    }

    return new Response(
      JSON.stringify({ inserted, duplicates, errors, total_rows: records.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("import-leads-csv:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
