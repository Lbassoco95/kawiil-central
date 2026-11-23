// Confirmación pública de asistencia a una actividad (sin sesión).
// El invitado entra con su enlace personal (/invitacion/<token>).
//   action: "info"    -> datos del evento + lo que ya respondió
//   action: "respond" -> guarda su respuesta y, si pide +1, deja la solicitud pendiente
// La solicitud de +1 NO suma como acompañante hasta que alguien del equipo la aprueba en el admin.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return s || null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const token = String(body.token ?? "").trim();
    if (!UUID_RE.test(token)) return json({ error: "Enlace no válido" }, 404);

    const { data: att, error } = await admin
      .from("activity_attendees").select("*").eq("rsvp_token", token).maybeSingle();
    if (error) return json({ error: "No pudimos cargar tu invitación" }, 500);
    if (!att) return json({ error: "Enlace no válido" }, 404);

    const { data: act } = await admin
      .from("activities")
      .select("name, event_date, event_time, location, venue_confirmed, invite_image_url, status")
      .eq("id", att.activity_id).maybeSingle();
    if (!act) return json({ error: "Enlace no válido" }, 404);
    const closed = act.status === "cancelada" || act.status === "completada";

    const view = () => ({
      activity: {
        name: act.name,
        event_date: act.event_date,
        event_time: act.event_time,
        location: act.venue_confirmed ? act.location : null,
        image_url: act.invite_image_url,
        closed,
      },
      guest: {
        first_name: String(att.name).split(" ")[0],
        confirmed: att.confirmed,
        dietary: att.dietary_restriction,
        responded: !!att.rsvp_responded_at,
        plus_one_status: att.plus_one_status,
        plus_one_name: att.plus_one_name,
        plus_one_dietary: att.plus_one_dietary,
      },
    });

    if (body.action === "info") return json(view());

    if (body.action === "respond") {
      if (closed) return json({ error: "Este evento ya no recibe confirmaciones." }, 403);
      if (body.website) return json({ ok: true }); // honeypot
      if (body.attending !== "si" && body.attending !== "no") {
        return json({ error: "Dinos si vas a asistir." }, 400);
      }
      const update: Record<string, unknown> = {
        confirmed: body.attending,
        dietary_restriction: body.attending === "si" ? clean(body.dietary, 200) : att.dietary_restriction,
        rsvp_responded_at: new Date().toISOString(),
      };

      if (body.attending === "no") {
        // Sin asistencia no hay +1: se cancela cualquier solicitud en curso.
        if (att.plus_one_status === "solicitado") update.plus_one_status = "none";
      } else if (att.plus_one_status === "aprobado") {
        // +1 ya aprobado: solo puede completar nombre y alergias.
        update.plus_one_name = clean(body.plus_one_name, 120) ?? att.plus_one_name;
        update.plus_one_dietary = clean(body.plus_one_dietary, 200);
      } else if (body.want_plus_one === true) {
        const plusName = clean(body.plus_one_name, 120);
        if (!plusName) return json({ error: "Escribe el nombre de tu acompañante." }, 400);
        update.plus_one_status = "solicitado";
        update.plus_one_name = plusName;
        update.plus_one_dietary = clean(body.plus_one_dietary, 200);
      } else if (att.plus_one_status === "solicitado") {
        update.plus_one_status = "none"; // retiró su solicitud
      }

      const { error: upErr } = await admin.from("activity_attendees").update(update).eq("id", att.id);
      if (upErr) return json({ error: "No pudimos guardar tu respuesta. Inténtalo de nuevo." }, 500);
      Object.assign(att, update);
      return json({ ok: true, ...view() });
    }

    return json({ error: "Acción no válida" }, 400);
  } catch (e) {
    return json({ error: "Algo no salió como esperábamos" }, 500);
  }
});
