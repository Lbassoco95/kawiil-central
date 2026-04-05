import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PIXEL_GIF = Uint8Array.from(
  atob(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  ),
  (c) => c.charCodeAt(0),
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const eid = url.searchParams.get("eid");
    const t = url.searchParams.get("t") || "open";
    let redirectUrl = url.searchParams.get("u");

    if (!eid) {
      return new Response("Bad request", { status: 400 });
    }

    function safeRedirectUrl(u: string | null): string | null {
      if (!u) return null;
      try {
        const x = new URL(u);
        if (x.protocol !== "http:" && x.protocol !== "https:") return null;
        return x.toString();
      } catch {
        return null;
      }
    }
    redirectUrl = safeRedirectUrl(redirectUrl);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const { data: logRow } = await svc.from("email_log").select("id, lead_id").eq("id", eid).maybeSingle();
    if (!logRow) {
      if (t === "click" && redirectUrl) {
        return Response.redirect(redirectUrl, 302);
      }
      return new Response(PIXEL_GIF, {
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    const now = new Date().toISOString();

    if (t === "open") {
      await svc.from("email_tracking_events").insert({
        email_log_id: logRow.id,
        lead_id: logRow.lead_id,
        event_type: "open",
        metadata: {},
      });
      await svc.from("email_log").update({
        opened_at: now,
        status: "opened",
      }).eq("id", eid);
    } else if (t === "click" && redirectUrl) {
      await svc.from("email_tracking_events").insert({
        email_log_id: logRow.id,
        lead_id: logRow.lead_id,
        event_type: "click",
        metadata: { url: redirectUrl.slice(0, 2000) },
      });
      await svc.from("email_log").update({
        clicked_at: now,
        status: "clicked",
      }).eq("id", eid);
      return Response.redirect(redirectUrl, 302);
    }

    return new Response(PIXEL_GIF, {
      headers: {
        "Content-Type": "image/gif",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (e) {
    console.error("email-tracking:", e);
    return new Response(PIXEL_GIF, {
      headers: { "Content-Type": "image/gif" },
    });
  }
});
