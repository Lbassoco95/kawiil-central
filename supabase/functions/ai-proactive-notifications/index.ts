import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

function ymdMexico(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function modelId(): string {
  return (Deno.env.get("PROACTIVE_AI_ANTHROPIC_MODEL") || "").trim() ||
    "claude-3-5-haiku-20241022";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const headerSecret = req.headers.get("x-cron-secret");
    if (!cronSecret || headerSecret !== cronSecret) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ ok: false, skip: "no_anthropic" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const todayYmd = ymdMexico(new Date());
    const recentCutoff = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();

    const { data: profiles, error: pe } = await svc
      .from("profiles")
      .select("user_id, organization_id, full_name, proactive_ai_notifications")
      .eq("is_active", true)
      .eq("invitation_accepted", true);

    if (pe) throw pe;

    const rows = profiles ?? [];
    let sent = 0;

    for (const p of rows) {
      if (p.proactive_ai_notifications === false) continue;
      const uid = p.user_id as string;
      const orgId = p.organization_id as string;
      if (!uid || !orgId) continue;

      const { data: already } = await svc
        .from("notifications")
        .select("id")
        .eq("user_id", uid)
        .eq("type", "ai_proactive_tip")
        .gte("created_at", recentCutoff)
        .limit(1)
        .maybeSingle();

      if (already) continue;

      const { data: tasks } = await svc
        .from("tasks")
        .select("id, title, due_date, status, priority")
        .eq("assigned_to", uid)
        .in("status", ["pendiente", "en_progreso", "en_revision"])
        .not("due_date", "is", null);

      const list = tasks ?? [];
      const overdue = list.filter((t) => String(t.due_date).slice(0, 10) < todayYmd);
      const dueWeek = list.filter((t) => {
        const d = String(t.due_date).slice(0, 10);
        return d >= todayYmd && d <= addDaysYmd(todayYmd, 7);
      });

      if (overdue.length === 0 && dueWeek.length === 0) continue;

      const brief =
        `Resumen para ${p.full_name || "usuario"}: ${overdue.length} tarea(s) con fecha vencida; ${dueWeek.length} con vencimiento en los próximos 7 días. ` +
        `Ejemplos vencidas: ${overdue.slice(0, 3).map((t) => t.title).join("; ") || "—"}.`;

      const resp = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: modelId(),
          max_tokens: 200,
          messages: [{
            role: "user",
            content:
              `Eres Kawiil AI. En un solo párrafo breve y motivador (español mexicano), sugiere cómo ordenar el día según este resumen operativo. ` +
              `No listes tareas numeradas; máximo 3 frases.\n\n${brief}`,
          }],
        }),
      });

      if (!resp.ok) continue;
      const data = await resp.json();
      const bodyText =
        (data.content?.find((b: { type?: string }) => b.type === "text") as { text?: string } | undefined)?.text?.trim() ||
        "Revisa tus tareas: hay pendientes con fecha próxima o vencida.";

      await svc.from("notifications").insert({
        user_id: uid,
        organization_id: orgId,
        type: "ai_proactive_tip",
        title: "Sugerencia del día",
        body: bodyText.slice(0, 1200),
        entity_type: "dashboard",
        entity_id: null,
        is_read: false,
      });
      sent += 1;
    }

    return new Response(JSON.stringify({ ok: true, sent, users: rows.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, da] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, da + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}
