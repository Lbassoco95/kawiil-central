// Extrae la foto del candidato desde la 1ª página del CV (ya rasterizada por el
// navegador y enviada como imagen). Usa Claude (visión) para ubicar el recuadro
// de la foto/retrato, la recorta con imagescript, la sube al bucket privado 'cv'
// y guarda la ruta en rh_candidates.photo_url.
//
// Secret requerido: ANTHROPIC_API_KEY
//
// Contrato:
//   POST { candidate_id, image_base64, mime }
//   200  { ok: true, photo_path }              -> foto recortada y guardada
//   200  { ok: false, message }                -> no se detectó foto
//   4xx/5xx { error }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const CV_BUCKET = "cv";
const MODEL = "claude-sonnet-4-6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function anthropicErrorMessage(status: number, body: string): string {
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 200);
  if (status === 401) return "La ANTHROPIC_API_KEY es inválida o falta en Edge Functions (Secrets).";
  if (status === 404) return `El modelo ${MODEL} no está disponible para esta API key.`;
  if (status === 429) return "Límite de uso de la IA alcanzado; espera un momento y reintenta.";
  if (status === 529 || status === 503) return "El servicio de IA está saturado; reintenta en un momento.";
  return `La IA no pudo procesar la imagen (Anthropic ${status}). ${snippet}`;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const photoTool = {
  name: "report_candidate_photo",
  description: "Reporta si el CV incluye una foto/retrato del candidato y su recuadro.",
  input_schema: {
    type: "object",
    properties: {
      has_photo: { type: "boolean", description: "true si hay una foto o retrato de la persona en la página." },
      x: { type: "number", description: "Borde izquierdo del recuadro de la foto, como fracción 0..1 del ancho." },
      y: { type: "number", description: "Borde superior del recuadro, como fracción 0..1 del alto." },
      width: { type: "number", description: "Ancho del recuadro, como fracción 0..1 del ancho." },
      height: { type: "number", description: "Alto del recuadro, como fracción 0..1 del alto." },
    },
    required: ["has_photo"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) return json({ error: "IA no configurada (falta ANTHROPIC_API_KEY)." }, 500);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) return json({ error: "No autorizado" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const candidateId = String(body.candidate_id ?? "").trim();
    const imageB64 = String(body.image_base64 ?? "");
    const mime = String(body.mime ?? "image/png");
    if (!candidateId || !imageB64) return json({ error: "Faltan candidate_id o image_base64" }, 400);

    const { data: cand } = await admin
      .from("rh_candidates")
      .select("id, organization_id")
      .eq("id", candidateId)
      .maybeSingle();
    if (!cand) return json({ error: "Candidato no encontrado" }, 404);

    const { data: prof } = await admin
      .from("profiles").select("organization_id").eq("user_id", caller.id).maybeSingle();
    if (!prof || prof.organization_id !== cand.organization_id) {
      return json({ error: "No tienes acceso a este candidato." }, 403);
    }

    // 1) Claude ubica el recuadro de la foto.
    const aiResp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 400,
        system:
          "Eres un asistente que localiza la fotografía/retrato de una persona dentro de la página de un CV. " +
          "Devuelve el recuadro que contenga SOLO la cara y hombros de la persona (no logotipos ni iconos). " +
          "Si no hay foto real de la persona, has_photo=false. Usa SIEMPRE la herramienta report_candidate_photo.",
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mime, data: imageB64 } },
            { type: "text", text: "¿Hay una foto de la persona? Si sí, dame su recuadro en fracciones 0..1." },
          ],
        }],
        tools: [photoTool],
        tool_choice: { type: "tool", name: "report_candidate_photo" },
      }),
    });
    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("Anthropic error:", aiResp.status, t.slice(0, 300));
      return json({ error: anthropicErrorMessage(aiResp.status, t) }, 502);
    }
    const aiJson = await aiResp.json();
    const toolUse = (aiJson.content as Array<{ type: string; name?: string; input?: unknown }>)?.find(
      (b) => b.type === "tool_use" && b.name === "report_candidate_photo",
    );
    const r = (toolUse?.input ?? {}) as Record<string, unknown>;
    const frac = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
    if (!r.has_photo) return json({ ok: false, message: "El CV no tiene una foto reconocible de la persona." });

    let x = frac(r.x), y = frac(r.y), w = frac(r.width), h = frac(r.height);
    if (x == null || y == null || w == null || h == null || w <= 0 || h <= 0) {
      return json({ ok: false, message: "No se pudo ubicar el recuadro de la foto." });
    }

    // 2) Recortar CUADRADO y centrado en la cara (para que el avatar circular
    //    quede alineado). Se añade un margen del 20% alrededor del recuadro.
    const img = await Image.decode(b64ToBytes(imageB64));
    const W = img.width, H = img.height;

    // Recuadro detectado en píxeles + margen.
    const padX = w * 0.20, padY = h * 0.20;
    const bx = Math.max(0, x - padX) * W;
    const by = Math.max(0, y - padY) * H;
    const bw = Math.min(1, w + padX * 2) * W;
    const bh = Math.min(1, h + padY * 2) * H;

    // Cuadrado centrado en el centro del recuadro.
    const ccx = bx + bw / 2, ccy = by + bh / 2;
    let side = Math.min(Math.max(bw, bh), W, H);
    let sx = Math.round(ccx - side / 2);
    let sy = Math.round(ccy - side / 2);
    side = Math.round(side);
    sx = Math.max(0, Math.min(sx, W - side));
    sy = Math.max(0, Math.min(sy, H - side));
    const s = Math.max(1, Math.min(side, W - sx, H - sy));
    if (s < 8) return json({ ok: false, message: "La foto detectada es demasiado pequeña." });

    img.crop(sx, sy, s, s);
    const png = await img.encode();

    // 3) Subir y guardar la ruta.
    const path = `${cand.organization_id}/${cand.id}/foto_${Date.now()}.png`;
    const { error: upErr } = await admin.storage.from(CV_BUCKET).upload(path, png, {
      upsert: true,
      contentType: "image/png",
    });
    if (upErr) return json({ error: `No se pudo guardar la foto: ${upErr.message}` }, 502);

    await admin.from("rh_candidates").update({ photo_url: path }).eq("id", cand.id);

    return json({ ok: true, photo_path: path });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("extract-cv-photo error:", message);
    return json({ error: message }, 500);
  }
});
