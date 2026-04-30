// =============================================================
// reconcile-ai-artifact-formats
//
// Toma un artefacto existente (normalmente `render_status = 'pending'` o
// solicitado a demanda desde el visor) y:
//
//   1. Lee su `content` markdown.
//   2. Lo convierte al shape `generico` (markdownToGenericContent).
//   3. Invoca `render-ai-document` pidiendo DOCX + PDF por defecto (+ heurísticos XLSX/PPTX).
//   4. Sube los bytes al bucket `documents` en `ai-artifacts/<org>/<user>/…`.
//   5. Fusiona los nuevos `output_formats` con los ya existentes (no duplica)
//      y actualiza `primary_format`, `storage_*`, `render_status = 'ready'`.
//
// Reglas:
//   - Solo miembros de la misma organización pueden reconciliar un artefacto
//     (se valida con `profiles.organization_id` vs `artifact.organization_id`).
//   - Si `render-ai-document` vuelve a fallar, se devuelve 502 y se marca
//     `render_status = 'failed'` con el último error.
// =============================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  detectExtraFormats,
  markdownToGenericContent,
  type KawiilOutputFormat,
} from "../_shared/markdown-to-generic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALL_FORMATS: readonly KawiilOutputFormat[] = ["pdf", "docx", "xlsx", "pptx"] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RenderedFormat {
  format: KawiilOutputFormat;
  file_name: string;
  file_ext: string;
  mime_type: string;
  content_base64: string;
}

interface StoredOutput {
  format: KawiilOutputFormat;
  storage_bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  is_primary: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "No autorizado" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return json({ error: "No autorizado" }, 401);
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => null) as {
      artifact_id?: unknown;
      formats?: unknown;
    } | null;

    const artifactId = typeof body?.artifact_id === "string" ? body.artifact_id : "";
    if (!artifactId || !UUID_RE.test(artifactId)) {
      return json({ error: "artifact_id inválido" }, 400);
    }

    const requestedFormats = Array.isArray(body?.formats)
      ? (body!.formats as unknown[])
          .filter((f): f is KawiilOutputFormat => typeof f === "string" && (ALL_FORMATS as readonly string[]).includes(f))
      : [];

    const svc = createClient(supabaseUrl, serviceKey);

    const { data: profile, error: profileErr } = await svc
      .from("profiles")
      .select("organization_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (profileErr || !profile?.organization_id) {
      console.error("reconcile: error leyendo profile", profileErr);
      return json({ error: "No se pudo resolver la organización del usuario" }, 500);
    }
    const userOrgId = profile.organization_id as string;

    const { data: artifact, error: artifactErr } = await svc
      .from("ai_artifacts")
      .select("*")
      .eq("id", artifactId)
      .maybeSingle();
    if (artifactErr) {
      console.error("reconcile: error consultando artifact", artifactErr);
      return json({ error: "No se pudo leer el artefacto" }, 500);
    }
    if (!artifact) return json({ error: "Artefacto no encontrado" }, 404);
    if (artifact.organization_id !== userOrgId) {
      return json({ error: "No autorizado para este artefacto" }, 403);
    }

    const markdown = typeof artifact.content === "string" ? artifact.content : "";
    if (!markdown.trim()) {
      return json({ error: "El artefacto no tiene contenido markdown para re-renderizar" }, 400);
    }

    const title = typeof artifact.title === "string" && artifact.title.trim()
      ? artifact.title
      : "Documento";

    const generic = markdownToGenericContent(markdown, title);

    // Sin `formats` en el body → Word + PDF de lectura + heurísticos (xlsx/pptx).
    // Con `formats` explícitos → esos formatos + heurísticos de apoyo (p. ej. tablas largas).
    const heuristicExtras = detectExtraFormats(markdown, generic);
    let mergedFormats: Set<KawiilOutputFormat>;
    if (requestedFormats.length === 0) {
      mergedFormats = new Set<KawiilOutputFormat>(["docx", "pdf", ...heuristicExtras]);
    } else {
      mergedFormats = new Set<KawiilOutputFormat>([...requestedFormats]);
      for (const h of heuristicExtras) mergedFormats.add(h);
    }
    const FMT_ORDER: KawiilOutputFormat[] = ["docx", "xlsx", "pptx", "pdf"];
    const finalFormats = (FMT_ORDER.filter((f) => mergedFormats.has(f)) as KawiilOutputFormat[]);
    const primaryForRender: KawiilOutputFormat = finalFormats.includes("docx")
      ? "docx"
      : (finalFormats.includes("xlsx") ? "xlsx" : (finalFormats.includes("pptx") ? "pptx" : finalFormats[0]));

    // Marcamos pending mientras trabajamos para que el UI muestre "Generando…"
    // aunque la llamada venga de un reintento automático.
    await svc
      .from("ai_artifacts")
      .update({ render_status: "pending", render_error: null, updated_at: new Date().toISOString() })
      .eq("id", artifactId);

    // 1 reintento si el render falla (además del intento original).
    let renderJson: {
      success?: boolean;
      primary_format?: KawiilOutputFormat;
      preview_markdown?: string;
      formats?: RenderedFormat[];
      error?: string;
    } | null = null;
    let renderErr: string | null = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/render-ai-document`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
            apikey: anonKey,
          },
          body: JSON.stringify({
            title,
            template_key: "generico",
            requested_formats: finalFormats,
            primary_format: primaryForRender,
            content: generic,
            confidence: 0.9,
            reason: "reconcile-ai-artifact-formats",
            preview_markdown: markdown,
          }),
        });
        const parsed = await resp.json().catch(() => null) as typeof renderJson;
        if (resp.ok && parsed?.success && Array.isArray(parsed.formats) && parsed.formats.length) {
          renderJson = parsed;
          renderErr = null;
          break;
        }
        renderErr = parsed?.error || `render-ai-document HTTP ${resp.status}`;
        console.warn(`reconcile: render intento ${attempt}/2 falló:`, renderErr);
      } catch (e) {
        renderErr = e instanceof Error ? e.message : String(e);
        console.error(`reconcile: render intento ${attempt}/2 threw:`, renderErr);
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500));
    }

    if (!renderJson) {
      await svc
        .from("ai_artifacts")
        .update({
          render_status: "failed",
          render_error: renderErr?.slice(0, 500) || "render falló",
          updated_at: new Date().toISOString(),
        })
        .eq("id", artifactId);
      return json({ error: renderErr || "No se pudo generar ningún formato" }, 502);
    }

    const rendered = renderJson.formats!;
    const primaryFormat: KawiilOutputFormat =
      renderJson.primary_format && (ALL_FORMATS as readonly string[]).includes(renderJson.primary_format)
        ? (renderJson.primary_format as KawiilOutputFormat)
        : rendered[0].format;

    const storageBucket = "documents";
    const safeTitle = title.replace(/[^\w\- ]+/g, "_").trim().replace(/\s+/g, "_").slice(0, 80) || "documento";

    // Conservamos `output_formats` previos que no se regeneraron para no perder
    // descargas anteriores si el usuario pidió un subconjunto.
    const existing: StoredOutput[] = Array.isArray(artifact.output_formats)
      ? (artifact.output_formats as StoredOutput[])
      : [];
    const regeneratedFmts = new Set(rendered.map((f) => f.format));
    const kept = existing.filter((o) => !regeneratedFmts.has(o.format));

    const fresh: StoredOutput[] = [];
    for (const fmt of rendered) {
      const bytes = base64ToUint8Array(fmt.content_base64);
      const storagePath = `ai-artifacts/${artifact.organization_id}/${artifact.user_id}/${artifact.id}_${safeTitle}.${fmt.file_ext}`;
      // upsert:true permite regenerar un formato ya existente sin colisionar.
      const { error: upErr } = await svc.storage.from(storageBucket).upload(storagePath, bytes, {
        contentType: fmt.mime_type,
        upsert: true,
      });
      if (upErr) {
        console.error("reconcile: upload falló", fmt.format, upErr);
        await svc
          .from("ai_artifacts")
          .update({
            render_status: "failed",
            render_error: `Upload ${fmt.format}: ${upErr.message}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", artifactId);
        return json({ error: upErr.message }, 500);
      }
      fresh.push({
        format: fmt.format,
        storage_bucket: storageBucket,
        storage_path: storagePath,
        file_name: `${safeTitle}.${fmt.file_ext}`,
        mime_type: fmt.mime_type,
        is_primary: fmt.format === primaryFormat,
      });
    }

    // Limpiar `is_primary` de los kept para evitar que haya 2 primarios.
    const mergedOutputs: StoredOutput[] = [
      ...fresh,
      ...kept.map((o) => ({ ...o, is_primary: false })),
    ];

    const primary = mergedOutputs.find((o) => o.format === primaryFormat) || mergedOutputs[0];
    const contentTypeUpdated = primary.format === "pdf" ? "pdf" : "office";

    const { error: updErr } = await svc
      .from("ai_artifacts")
      .update({
        content_type: contentTypeUpdated,
        template_key: artifact.template_key || "generico",
        template_data: artifact.template_data || generic,
        output_formats: mergedOutputs,
        primary_format: primary.format,
        office_kind:
          primary.format === "docx" ? "word_document"
            : primary.format === "xlsx" ? "spreadsheet"
              : primary.format === "pptx" ? "presentation"
                : null,
        file_ext: primary.format,
        mime_type: primary.mime_type,
        storage_bucket: primary.storage_bucket,
        storage_path: primary.storage_path,
        render_status: "ready",
        render_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", artifactId);
    if (updErr) {
      console.error("reconcile: update fila falló", updErr);
      return json({ error: updErr.message }, 500);
    }

    return json({
      success: true,
      artifact_id: artifactId,
      primary_format: primary.format,
      formats: mergedOutputs.map((o) => o.format),
    });
  } catch (err) {
    console.error("reconcile-ai-artifact-formats unexpected error:", err);
    const message = err instanceof Error ? err.message : "Error desconocido";
    return json({ error: message }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
