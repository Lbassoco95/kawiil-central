/**
 * Adjuntos de un correo del lead.
 *
 * `email_log` guarda `has_attachments` pero no los archivos: pesan y ya viven
 * en el buzón. Esta función los lista bajo demanda y entrega uno por uno en
 * base64 para descargarlo desde la ficha del lead.
 *
 *   { email_log_id }                  -> lista (id, nombre, tipo, tamaño)
 *   { email_log_id, attachment_id }   -> ese adjunto con su contenido
 *
 * Requiere: secrets AZURE_* o MICROSOFT_* (client credentials), SENDER_EMAIL y
 * permiso de aplicación Mail.Read en Azure AD.
 * Deploy: `supabase functions deploy lead-email-attachments` (verify_jwt true).
 */
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Tope del contenido que se devuelve al navegador (base64 infla ~33%). */
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

async function getAppOnlyGraphToken(): Promise<string> {
  const tenant = Deno.env.get("AZURE_TENANT_ID") || Deno.env.get("MICROSOFT_TENANT_ID");
  const clientId = Deno.env.get("AZURE_CLIENT_ID") || Deno.env.get("MICROSOFT_CLIENT_ID");
  const secret = Deno.env.get("AZURE_CLIENT_SECRET") || Deno.env.get("MICROSOFT_CLIENT_SECRET");
  if (!tenant || !clientId || !secret) {
    throw new Error("Faltan AZURE_* o MICROSOFT_* para client credentials");
  }
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Token: ${JSON.stringify(j)}`);
  return j.access_token as string;
}

type GraphAttachment = {
  id?: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentBytes?: string;
  "@odata.type"?: string;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "No autorizado" }, 401);

    const body = await req.json() as { email_log_id?: string; attachment_id?: string };
    if (!body.email_log_id) return jsonResponse({ error: "email_log_id requerido" }, 400);

    // RLS del usuario: sólo puede ver adjuntos de un correo que ya puede leer.
    const { data: row, error: rowErr } = await userClient
      .from("email_log")
      .select("id, graph_message_id, has_attachments, subject")
      .eq("id", body.email_log_id)
      .single();
    if (rowErr || !row) return jsonResponse({ error: "Correo no encontrado" }, 404);
    if (!row.graph_message_id) {
      return jsonResponse(
        { error: "Este correo no está ligado a un mensaje del buzón, así que no hay adjuntos que leer" },
        400,
      );
    }

    const mailbox = Deno.env.get("SENDER_EMAIL") || "contacto@kawiil.mx";
    const token = await getAppOnlyGraphToken();
    const base =
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}` +
      `/messages/${encodeURIComponent(row.graph_message_id as string)}/attachments`;

    // ── Un adjunto con su contenido ─────────────────────────────────
    if (body.attachment_id) {
      const res = await fetch(`${base}/${encodeURIComponent(body.attachment_id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Graph attachment: ${err.slice(0, 300)}`);
      }
      const att = await res.json() as GraphAttachment;
      if (!att.contentBytes) {
        return jsonResponse(
          {
            error:
              "El adjunto no es un archivo descargable (puede ser un correo adjunto o un enlace a la nube)",
          },
          400,
        );
      }
      if ((att.size ?? 0) > MAX_ATTACHMENT_BYTES) {
        return jsonResponse(
          { error: "El adjunto pesa demasiado para descargarlo desde aquí; ábrelo en Outlook" },
          413,
        );
      }
      return jsonResponse({
        ok: true,
        attachment: {
          id: att.id,
          name: att.name || "adjunto",
          contentType: att.contentType || "application/octet-stream",
          size: att.size ?? null,
          contentBytes: att.contentBytes,
        },
      });
    }

    // ── Listado (sin contenido) ─────────────────────────────────────
    const listRes = await fetch(`${base}?$select=id,name,contentType,size,isInline`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!listRes.ok) {
      const err = await listRes.text();
      throw new Error(`Graph attachments: ${err.slice(0, 300)}`);
    }
    const listJson = await listRes.json();
    const all = (Array.isArray(listJson.value) ? listJson.value : []) as GraphAttachment[];

    // Las imágenes incrustadas en la firma no son adjuntos útiles para el usuario.
    const attachments = all
      .filter((a) => !a.isInline)
      .map((a) => ({
        id: a.id,
        name: a.name || "adjunto",
        contentType: a.contentType || "application/octet-stream",
        size: a.size ?? null,
        // Graph suele incluir @odata.type; si no viene, se asume archivo.
        downloadable:
          !a["@odata.type"] || a["@odata.type"].toLowerCase().includes("fileattachment"),
      }));

    return jsonResponse({ ok: true, attachments, inline_skipped: all.length - attachments.length });
  } catch (e) {
    console.error("lead-email-attachments:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
