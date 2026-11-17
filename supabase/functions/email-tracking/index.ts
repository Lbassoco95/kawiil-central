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

function pixelResponse(): Response {
  return new Response(PIXEL_GIF, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

/** Solo http(s); rechaza javascript:, data:, etc. */
function parseHttpUrl(u: string | null): URL | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    if (x.protocol !== "http:" && x.protocol !== "https:") return null;
    return x;
  } catch {
    return null;
  }
}

/**
 * Anti open-redirect: el destino debe aparecer en el cuerpo del correo registrado.
 * Así un atacante no puede usar un eid válido (o inventado) para redirigir a un sitio malicioso.
 */
function emailBodyHaystack(bodyHtml: string | null, bodyText: string | null): string {
  return `${bodyHtml || ""}\n${bodyText || ""}`.trim();
}

/**
 * Si hay cuerpo guardado, el destino debe aparecer ahí (anti open-redirect).
 * Si el log no tiene body (filas viejas), devolvemos null → el caller permite
 * el redirect solo porque el eid ya es un UUID real de email_log.
 */
function urlAllowedByEmailBody(
  redirect: URL,
  bodyHtml: string | null,
  bodyText: string | null,
): boolean | null {
  const haystack = emailBodyHaystack(bodyHtml, bodyText);
  if (!haystack) return null;

  const candidates = [redirect.href, redirect.toString()];
  for (const c of candidates) {
    if (haystack.includes(c)) return true;
    try {
      if (haystack.includes(decodeURIComponent(c))) return true;
    } catch {
      /* ignore */
    }
  }
  const bare = `${redirect.origin}${redirect.pathname}`;
  return haystack.includes(bare);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const eid = url.searchParams.get("eid");
    const t = url.searchParams.get("t") || "open";
    const redirectParsed = parseHttpUrl(url.searchParams.get("u"));

    if (!eid) {
      return new Response("Bad request", { status: 400 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const { data: logRow } = await svc
      .from("email_log")
      .select("id, lead_id, body_html, body_text")
      .eq("id", eid)
      .maybeSingle();

    // Sin fila válida: nunca redirigir (evita open redirect / phishing).
    if (!logRow) {
      return t === "open" ? pixelResponse() : new Response("Not found", { status: 404 });
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
      return pixelResponse();
    }

    if (t === "click" && redirectParsed) {
      const allowed = urlAllowedByEmailBody(redirectParsed, logRow.body_html, logRow.body_text);
      if (allowed === false) {
        console.warn("email-tracking: redirect rechazado (URL no está en el correo)", {
          eid,
          host: redirectParsed.host,
        });
        return new Response("Forbidden redirect", { status: 400 });
      }

      const redirectUrl = redirectParsed.toString();
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

    return pixelResponse();
  } catch (e) {
    console.error("email-tracking:", e);
    return pixelResponse();
  }
});
