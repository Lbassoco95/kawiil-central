import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
/**
 * client-portal
 * -------------
 * Consulta pública (solo lectura) del avance de un juicio/trámite para el cliente.
 *
 * Body: { token: string, code: string }
 * Respuesta: { lawsuit, client_name, stages, entries, documents } con lo que el equipo
 * marcó como visible: actuaciones con `client_visible` y documentos con
 * `metadata.client_shared = true` (URLs firmadas de 10 minutos).
 *
 * Seguridad: `verify_jwt = false` (el cliente no tiene cuenta). El acceso exige el token
 * del enlace y un código; tras 5 intentos fallidos el enlace se bloquea 15 minutos.
 * Las tablas solo se leen aquí, con service role; nada se expone al cliente por RLS.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const SIGNED_URL_SECONDS = 600;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as { token?: unknown; code?: unknown };
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return json({ error: "Enlace no válido" }, 404);
    if (!/^\d{6}$/.test(code)) return json({ error: "Ingresa el código de 6 dígitos", code: "code_format" }, 400);

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: link } = await sb
      .from("lawsuit_client_links")
      .select("id, lawsuit_id, code_hash, active, failed_attempts, locked_until")
      .eq("token_hash", await sha256Hex(token))
      .maybeSingle();
    if (!link || !link.active) return json({ error: "Enlace no válido o desactivado" }, 404);

    if (link.locked_until && new Date(link.locked_until).getTime() > Date.now()) {
      return json({ error: "Demasiados intentos. Intenta de nuevo en unos minutos.", code: "locked" }, 429);
    }

    const expected = await sha256Hex(`${token}:${code}`);
    if (!safeEqual(expected, link.code_hash)) {
      const attempts = (link.failed_attempts ?? 0) + 1;
      const lock = attempts >= MAX_ATTEMPTS;
      await sb
        .from("lawsuit_client_links")
        .update({
          failed_attempts: lock ? 0 : attempts,
          locked_until: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
        })
        .eq("id", link.id);
      return json({ error: "Código incorrecto", code: "bad_code" }, 401);
    }

    await sb
      .from("lawsuit_client_links")
      .update({ failed_attempts: 0, locked_until: null, last_viewed_at: new Date().toISOString() })
      .eq("id", link.id);

    const { data: lawsuit } = await sb
      .from("project_lawsuits")
      .select(
        "id, project_id, name, lawsuit_type, case_number, court, status, current_stage, stages, filed_date, next_hearing_date, next_deadline_date, next_deadline_note",
      )
      .eq("id", link.lawsuit_id)
      .maybeSingle();
    if (!lawsuit) return json({ error: "Enlace no válido" }, 404);

    const { data: project } = await sb
      .from("projects")
      .select("client_id, clients(name)")
      .eq("id", lawsuit.project_id)
      .maybeSingle();
    // deno-lint-ignore no-explicit-any
    const clientName = ((project as any)?.clients?.name as string | undefined) ?? null;

    const stages = (Array.isArray(lawsuit.stages) ? lawsuit.stages : [])
      // deno-lint-ignore no-explicit-any
      .filter((s: any) => s && typeof s.label === "string")
      // deno-lint-ignore no-explicit-any
      .map((s: any) => ({
        label: s.label as string,
        completed: s.completed === true,
        completed_at: typeof s.completed_at === "string" ? s.completed_at : null,
      }));

    const { data: entries } = await sb
      .from("project_lawsuit_entries")
      .select("entry_date, content")
      .eq("lawsuit_id", lawsuit.id)
      .eq("client_visible", true)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100);

    const { data: docRows } = await sb
      .from("documents")
      .select("id, name, file_path, file_size, mime_type, created_at, source, metadata")
      .eq("project_id", lawsuit.project_id)
      .eq("metadata->>lawsuit_id", lawsuit.id)
      .eq("metadata->>client_shared", "true")
      .eq("source", "supabase")
      .order("created_at", { ascending: false })
      .limit(100);

    const documents = [];
    for (const d of docRows ?? []) {
      if (!d.file_path) continue;
      const bucket = (d.metadata as { bucket?: unknown } | null)?.bucket;
      const { data: signed } = await sb.storage
        .from(typeof bucket === "string" && bucket ? bucket : "documents")
        .createSignedUrl(d.file_path, SIGNED_URL_SECONDS, { download: d.name });
      if (!signed?.signedUrl) continue;
      documents.push({
        id: d.id,
        name: d.name,
        size: d.file_size,
        created_at: d.created_at,
        url: signed.signedUrl,
      });
    }

    return json({
      client_name: clientName,
      lawsuit: {
        name: lawsuit.name,
        lawsuit_type: lawsuit.lawsuit_type,
        case_number: lawsuit.case_number,
        court: lawsuit.court,
        status: lawsuit.status,
        current_stage: lawsuit.current_stage,
        filed_date: lawsuit.filed_date,
        next_hearing_date: lawsuit.next_hearing_date,
        next_deadline_date: lawsuit.next_deadline_date,
        next_deadline_note: lawsuit.next_deadline_note,
      },
      stages,
      entries: entries ?? [],
      documents,
    });
  } catch (e) {
    console.error("client-portal error", e);
    return json({ error: "No se pudo cargar la información" }, 500);
  }
});
