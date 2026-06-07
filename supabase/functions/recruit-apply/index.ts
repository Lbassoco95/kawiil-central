// Postulación pública a una vacante (sin sesión). Recibe el token público de
// la vacante y crea el candidato en el pipeline con service role.
//   action: "info"  -> { title, area, open } para mostrar la vacante
//   action: "apply" -> da de alta al candidato
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const token = String(body.token ?? "").trim();
    if (!token) return json({ error: "Falta el token" }, 400);

    const { data: proc } = await admin
      .from("rh_recruitment_processes")
      .select("id, organization_id, title, area, status, apply_open")
      .eq("apply_token", token)
      .maybeSingle();

    if (!proc) return json({ error: "Vacante no encontrada" }, 404);
    const open = proc.apply_open && proc.status === "open";

    if (body.action === "info") {
      return json({ title: proc.title, area: proc.area, open });
    }

    if (body.action === "apply") {
      if (!open) return json({ error: "Esta vacante ya no recibe postulaciones." }, 403);
      // Honeypot anti-spam: si viene lleno, fingimos éxito y no insertamos.
      if (body.company) return json({ ok: true });
      const fullName = String(body.full_name ?? "").trim();
      if (!fullName) return json({ error: "El nombre es obligatorio." }, 400);

      // Fase inicial y estado por defecto del proceso.
      const { data: stage } = await admin
        .from("rh_recruitment_stages").select("id").eq("process_id", proc.id)
        .order("position", { ascending: true }).limit(1).maybeSingle();
      const { data: state } = await admin
        .from("rh_recruitment_states").select("id").eq("process_id", proc.id)
        .eq("is_default", true).limit(1).maybeSingle();

      // CV opcional (base64).
      let resumeUrl: string | null = null;
      if (body.cv_base64 && body.cv_name) {
        try {
          const bin = Uint8Array.from(atob(String(body.cv_base64).split(",").pop() ?? ""), (c) => c.charCodeAt(0));
          const ext = String(body.cv_name).split(".").pop()?.toLowerCase() || "pdf";
          const path = `${proc.organization_id}/intake/${proc.id}_${Date.now()}.${ext}`;
          const { error: upErr } = await admin.storage.from("cv").upload(path, bin, {
            upsert: true, contentType: body.cv_type || "application/octet-stream",
          });
          if (!upErr) resumeUrl = path;
        } catch { /* CV opcional: si falla, continúa */ }
      }

      const { data: cand, error } = await admin.from("rh_candidates").insert({
        organization_id: proc.organization_id,
        process_id: proc.id,
        stage_id: stage?.id ?? null,
        state_id: state?.id ?? null,
        full_name: fullName,
        email: String(body.email ?? "").trim() || null,
        phone: String(body.phone ?? "").trim() || null,
        source: String(body.source ?? "").trim() || "Formulario",
        resume_url: resumeUrl,
        notes: String(body.notes ?? "").trim() || null,
      }).select("id").single();
      if (error) return json({ error: "No se pudo registrar la postulación." }, 500);

      await admin.from("rh_candidate_activities").insert({
        organization_id: proc.organization_id,
        candidate_id: cand.id,
        activity_type: "note",
        content: "Postulación recibida por formulario público",
        metadata: { source: body.source ?? "Formulario" },
      });

      return json({ ok: true });
    }

    return json({ error: "Acción inválida" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
