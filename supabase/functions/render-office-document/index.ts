/**
 * @deprecated Esta edge function fue reemplazada por `render-ai-document` en v2.5.
 *
 * Se mantiene 1 release como shim que traduce el payload legacy
 * (title + requested_kind + spreadsheet|word_document|presentation)
 * al nuevo formato (template_key=generico + content.sections) y llama
 * internamente a `render-ai-document`.
 *
 * Después de verificar que no quedan callers directos, este directorio
 * puede eliminarse por completo.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type LegacyKind = "spreadsheet" | "word_document" | "presentation";

const LEGACY_KIND_TO_FORMAT: Record<LegacyKind, "xlsx" | "docx" | "pptx"> = {
  spreadsheet: "xlsx",
  word_document: "docx",
  presentation: "pptx",
};

function legacyToKawiilContent(payload: Record<string, unknown>): Record<string, unknown> {
  // deno-lint-ignore no-explicit-any
  const sections: Array<{ heading?: string; paragraphs?: string[]; tables?: any[] }> = [];

  const wd = payload.word_document as { sections?: Array<{ heading?: string; paragraphs?: string[]; tables?: Array<{ headers?: string[]; rows: string[][] }> }> } | undefined;
  if (wd?.sections?.length) {
    for (const s of wd.sections) {
      sections.push({
        heading: s.heading,
        paragraphs: s.paragraphs,
        tables: s.tables?.map((t) => ({ headers: t.headers || [], rows: t.rows || [] })),
      });
    }
  }

  const sp = payload.spreadsheet as { sheets?: Array<{ name?: string; rows?: Array<{ cells?: unknown[] }> }> } | undefined;
  if (sp?.sheets?.length) {
    for (const sh of sp.sheets) {
      sections.push({
        heading: sh.name || "Hoja",
        tables: [{ headers: [], rows: (sh.rows || []).map((r) => (r.cells || []).map((c) => String(c ?? ""))) }],
      });
    }
  }

  const pr = payload.presentation as { slides?: Array<{ title?: string; bullets?: string[]; notes?: string; table?: { headers?: string[]; rows: string[][] } }> } | undefined;
  if (pr?.slides?.length) {
    for (const sl of pr.slides) {
      sections.push({
        heading: sl.title || "Diapositiva",
        paragraphs: sl.bullets,
        tables: sl.table ? [{ headers: sl.table.headers || [], rows: sl.table.rows || [] }] : undefined,
      });
    }
  }

  if (!sections.length) {
    sections.push({ heading: "Documento", paragraphs: ["Sin contenido proporcionado."] });
  }

  return { sections };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const title = typeof body.title === "string" ? body.title : "Documento";
    const requestedKind = body.requested_kind as LegacyKind | undefined;
    const secondaryFormat = requestedKind ? LEGACY_KIND_TO_FORMAT[requestedKind] : undefined;
    const requestedFormats: string[] = secondaryFormat ? ["pdf", secondaryFormat] : ["pdf"];

    const payload = {
      title,
      template_key: "generico",
      requested_formats: requestedFormats,
      content: legacyToKawiilContent(body),
      confidence: typeof body.confidence === "number" ? body.confidence : 0.9,
      reason: typeof body.reason === "string" ? body.reason : "migración automática desde render-office-document (deprecated)",
      preview_markdown: typeof body.preview_markdown === "string" ? body.preview_markdown : "",
    };

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const resp = await fetch(`${supabaseUrl}/functions/v1/render-ai-document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        apikey: anonKey,
      },
      body: JSON.stringify(payload),
    });
    const json = await resp.json().catch(() => ({ error: "invalid_json" }));

    if (!resp.ok || !json?.success) {
      return new Response(JSON.stringify({ success: false, error: json?.error || `render-ai-document error ${resp.status}` }), {
        status: resp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Para mantener compatibilidad con callers viejos, devolvemos el primer binario "office"
    // (el formato secundario) como `content_base64`, que es lo que el handler legacy espera.
    const formats: Array<{ format: string; content_base64: string; mime_type: string; file_ext: string; file_name: string }> = json.formats || [];
    const legacyFormat = formats.find((f) => secondaryFormat ? f.format === secondaryFormat : f.format !== "pdf") || formats[0];
    if (!legacyFormat) {
      return new Response(JSON.stringify({ success: false, error: "render-ai-document no devolvió archivos" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        deprecated: true,
        message: "render-office-document está deprecado. Llama directamente a render-ai-document con template_key + requested_formats.",
        content_base64: legacyFormat.content_base64,
        mime_type: legacyFormat.mime_type,
        file_ext: legacyFormat.file_ext,
        file_name: legacyFormat.file_name,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("render-office-document shim error:", err);
    return new Response(JSON.stringify({ success: false, error: err instanceof Error ? err.message : "Error desconocido" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
