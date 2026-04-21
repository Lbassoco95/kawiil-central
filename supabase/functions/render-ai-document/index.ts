import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  type KawiilOutputFormat,
  type KawiilTemplateKey,
  KAWIIL_OUTPUT_FORMATS,
  isKawiilTemplateKey,
  normalizeTemplateData,
  type RenderAiDocumentRequest,
  type RenderedFormat,
  resolveBranding,
} from "../_shared/ai-templates/index.ts";
import {
  FORMAT_EXT,
  FORMAT_MIME,
  buildPreviewMarkdown,
  sanitizeFileName,
  uint8ArrayToBase64,
} from "./common.ts";
import { renderKawiilPdf } from "./pdf.ts";
import { renderKawiilDocx } from "./docx.ts";
import { renderKawiilXlsx } from "./xlsx.ts";
import { renderKawiilPptx } from "./pptx.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function parseRequest(body: unknown): RenderAiDocumentRequest {
  if (!body || typeof body !== "object") throw new Error("Solicitud inválida.");
  const req = body as Partial<RenderAiDocumentRequest>;
  if (!req.title || typeof req.title !== "string") throw new Error("title es obligatorio.");
  if (!isKawiilTemplateKey(req.template_key)) {
    throw new Error("template_key inválido.");
  }
  const formats = Array.isArray(req.requested_formats) && req.requested_formats.length
    ? req.requested_formats.filter((f): f is KawiilOutputFormat => (KAWIIL_OUTPUT_FORMATS as readonly string[]).includes(f))
    : ["pdf" as KawiilOutputFormat];
  if (!formats.length) throw new Error("requested_formats debe incluir al menos un formato válido.");
  if (!req.content || typeof req.content !== "object") throw new Error("content es obligatorio.");

  return {
    title: req.title,
    template_key: req.template_key,
    requested_formats: formats,
    content: req.content as Record<string, unknown>,
    confidence: typeof req.confidence === "number" ? req.confidence : 1,
    reason: typeof req.reason === "string" ? req.reason : "",
    preview_markdown: typeof req.preview_markdown === "string" ? req.preview_markdown : "",
    branding: req.branding,
  };
}

async function renderFormat(
  format: KawiilOutputFormat,
  input: { templateKey: KawiilTemplateKey; title: string; data: unknown; branding: ReturnType<typeof resolveBranding> },
): Promise<Uint8Array> {
  switch (format) {
    case "pdf":
      return renderKawiilPdf(input);
    case "docx":
      return renderKawiilDocx(input);
    case "xlsx":
      return renderKawiilXlsx(input);
    case "pptx":
      return renderKawiilPptx(input);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = parseRequest(await req.json());
    const normalized = normalizeTemplateData(payload.template_key, payload.content);
    const branding = resolveBranding({
      orgName: payload.branding?.org_name,
      logoUrl: payload.branding?.logo_url,
      primaryColor: payload.branding?.primary_color,
    });

    const requestedPrimary: KawiilOutputFormat = payload.requested_formats[0];
    const safeTitle = sanitizeFileName(payload.title);

    const formats: RenderedFormat[] = [];
    const failures: Array<{ format: KawiilOutputFormat; error: string }> = [];
    for (const format of payload.requested_formats) {
      try {
        const bytes = await renderFormat(format, {
          templateKey: payload.template_key,
          title: payload.title,
          data: normalized,
          branding,
        });
        formats.push({
          format,
          file_name: `${safeTitle}.${FORMAT_EXT[format]}`,
          file_ext: FORMAT_EXT[format],
          mime_type: FORMAT_MIME[format],
          content_base64: uint8ArrayToBase64(bytes),
        });
      } catch (formatErr) {
        // Un formato individual fallando NO debe tirar todo el request: registramos
        // y seguimos con los demás (p. ej. PDF falla con emojis → DOCX sí se entrega).
        const msg = formatErr instanceof Error ? formatErr.message : String(formatErr);
        console.error(`render-ai-document: falló render de ${format}:`, msg);
        failures.push({ format, error: msg });
      }
    }

    if (!formats.length) {
      const reasons = failures.map((f) => `${f.format}: ${f.error}`).join(" | ") || "sin detalle";
      return new Response(
        JSON.stringify({ error: `No se pudo renderizar ningún formato (${reasons})` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Si el primario pedido falló pero hay otros formatos disponibles, usamos el
    // primero que sí se rindió (útil para que el UI no muestre "primario: PDF"
    // cuando el PDF falló pero tenemos DOCX).
    const primary: KawiilOutputFormat = formats.some((f) => f.format === requestedPrimary)
      ? requestedPrimary
      : formats[0].format;

    const previewSummary = typeof (payload.content as { summary?: string }).summary === "string"
      ? (payload.content as { summary?: string }).summary
      : undefined;
    const preview = payload.preview_markdown?.trim() || buildPreviewMarkdown(payload.title, payload.template_key, previewSummary);

    return new Response(
      JSON.stringify({
        success: true,
        template_key: payload.template_key,
        title: payload.title,
        primary_format: primary,
        preview_markdown: preview,
        formats,
        partial_failures: failures.length ? failures : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("render-ai-document error:", error);
    const message = error instanceof Error ? error.message : "Error desconocido";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
