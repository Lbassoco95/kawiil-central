import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Solo embeddings + DB. El PDF se parsea en el navegador (`client_pdf_page`).
 * Incluir PDF.js/unpdf en Edge provocaba RUNTIME_ERROR / WORKER_LIMIT en producción.
 */
const PAGE_BATCH = 1;
const MAX_CHARS_PER_SEGMENT = 2800;
const MAX_CHARS_PER_PAGE = 8000;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_TOKENS_PER_CHUNK = 550;
const OVERLAP_TOKENS = 80;
const EMBED_BATCH = 1;
const CHUNKS_PER_HTTP = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function chunkText(
  text: string,
  maxTokens = MAX_TOKENS_PER_CHUNK,
  overlapTokens = OVERLAP_TOKENS,
): string[] {
  const estimatedTotal = estimateTokens(text);
  if (estimatedTotal <= maxTokens) return text.trim().length > 0 ? [text.trim()] : [];

  const charsPerToken = 3.5;
  const maxChars = Math.floor(maxTokens * charsPerToken);
  const overlapChars = Math.floor(overlapTokens * charsPerToken);
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);

    if (end < text.length) {
      const lastParagraph = text.lastIndexOf("\n\n", end);
      const lastNewline = text.lastIndexOf("\n", end);
      const lastSentence = text.lastIndexOf(". ", end);

      if (lastParagraph > start + maxChars * 0.3) {
        end = lastParagraph + 2;
      } else if (lastNewline > start + maxChars * 0.3) {
        end = lastNewline + 1;
      } else if (lastSentence > start + maxChars * 0.3) {
        end = lastSentence + 2;
      }
    }

    const slice = text.slice(start, end).trim();
    if (slice.length > 20) chunks.push(slice);
    start = end - overlapChars;
    if (start >= text.length) break;
  }

  return chunks;
}

async function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function embedBatch(texts: string[], apiKey: string): Promise<number[][]> {
  const clean = texts.map((t) => t.replace(/\n+/g, " ").trim());
  let lastErr = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const resp = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: clean,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      return data.data.map((d: { embedding: number[] }) => d.embedding);
    }
    lastErr = await resp.text();
    if (resp.status === 429 && attempt < 4) {
      let wait = 2000 * (attempt + 1);
      const ra = resp.headers.get("retry-after");
      if (ra) {
        const s = parseInt(ra, 10);
        if (!Number.isNaN(s) && s > 0) wait = Math.min(60_000, s * 1000);
      }
      await sleepMs(wait);
      continue;
    }
    throw new Error(`OpenAI embeddings ${resp.status}: ${lastErr.slice(0, 400)}`);
  }
  throw new Error(lastErr.slice(0, 400));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY no configurada" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: profile } = await userClient.from("profiles")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();

    const orgId = profile?.organization_id as string | undefined;
    if (!orgId) {
      return new Response(JSON.stringify({ error: "Sin organización" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json() as {
      bucket?: string;
      path: string;
      name?: string;
      mime_type?: string;
      page_start?: number;
      attachment_index_id?: string | null;
      client_id?: string | null;
      project_id?: string | null;
      client_pdf_page?: { total_pages: number; text: string };
      resume_from_chunk?: number;
      continuation_chunk_index?: number;
    };

    const bucket = body.bucket || "chat-uploads";
    const path = body.path;
    const name = body.name || "documento.pdf";
    const mime = (body.mime_type || "").toLowerCase();
    const pageStart = Math.max(1, Math.floor(Number(body.page_start) || 1));
    const indexId = body.attachment_index_id || crypto.randomUUID();
    const resumeFromChunk = Math.max(0, Math.floor(Number(body.resume_from_chunk) || 0));
    const continuationChunkIndex = Math.max(0, Math.floor(Number(body.continuation_chunk_index) || 0));

    const prefix = `${orgId}/${user.id}/`;
    if (!path || typeof path !== "string" || !path.startsWith(prefix)) {
      return new Response(JSON.stringify({ error: "Ruta de adjunto no válida para este usuario" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isPdf = mime === "application/pdf" || name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      return new Response(JSON.stringify({ error: "Solo se indexan archivos PDF en esta versión" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const useClientText = body.client_pdf_page != null &&
      typeof body.client_pdf_page.total_pages === "number" &&
      body.client_pdf_page.total_pages >= 1 &&
      typeof body.client_pdf_page.text === "string";

    if (!useClientText) {
      return new Response(
        JSON.stringify({
          error:
            "Falta el texto del PDF extraído en el navegador. Actualiza la aplicación a la última versión e inténtalo de nuevo.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const totalPages = Math.floor(body.client_pdf_page!.total_pages);
    const svc = createClient(supabaseUrl, serviceKey);

    if (pageStart === 1 && resumeFromChunk === 0 && !body.attachment_index_id) {
      const { error: delErr } = await svc.from("document_chunks")
        .delete()
        .eq("organization_id", orgId)
        .eq("source_type", "chat_attachment")
        .contains("metadata", { storage_path: path });
      if (delErr) {
        console.warn("delete old chat_attachment chunks:", delErr.message);
      }
    }

    if (pageStart > totalPages) {
      return new Response(JSON.stringify({ error: "page_start fuera de rango" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const end = Math.min(totalPages, pageStart + PAGE_BATCH - 1);

    let inserted = 0;
    let chunkIndex = continuationChunkIndex;
    let buffer = "";
    let segPageFrom = pageStart;

    const embedAndInsert = async (
      plain: string,
      pageFrom: number,
      pageTo: number,
      opts?: { resumeFromPart?: number; maxPartsThisHttp?: number },
    ): Promise<{ resumeNextPart: number | null }> => {
      const t = plain.trim();
      if (t.length === 0) return { resumeNextPart: null };
      const parts = chunkText(t);
      const resumeFrom = Math.min(parts.length, Math.max(0, opts?.resumeFromPart ?? 0));
      const maxParts = opts?.maxPartsThisHttp ?? 999_999;
      const endExclusive = Math.min(parts.length, resumeFrom + maxParts);

      for (let i = resumeFrom; i < endExclusive; i += EMBED_BATCH) {
        const slice = parts.slice(i, Math.min(i + EMBED_BATCH, endExclusive));
        const embeddings = await embedBatch(slice, openaiKey);
        const idx0 = chunkIndex;
        const rows = slice.map((content, j) => ({
          organization_id: orgId,
          document_id: null,
          client_id: body.client_id || null,
          project_id: body.project_id || null,
          source_type: "chat_attachment",
          source_id: indexId,
          content,
          metadata: {
            attachment_index_id: indexId,
            storage_path: path,
            filename: name,
            page_from: pageFrom,
            page_to: pageTo,
            chunk_index: idx0 + j,
          },
          embedding: JSON.stringify(embeddings[j]),
          token_count: estimateTokens(content),
        }));
        chunkIndex += slice.length;

        const { error: insErr } = await svc.from("document_chunks").insert(rows);
        if (insErr) {
          console.error("insert chunks:", insErr);
          throw new Error(insErr.message);
        }
        inserted += rows.length;
        if (i + EMBED_BATCH < endExclusive) await sleepMs(200);
      }

      const resumeNextPart = endExclusive < parts.length ? endExclusive : null;
      return { resumeNextPart };
    };

    const jsonOk = (payload: Record<string, unknown>) =>
      new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    let activeResume = resumeFromChunk;
    for (let p = pageStart; p <= end; p++) {
      let pageText = body.client_pdf_page!.text;
      if (p !== pageStart) pageText = "";
      if (pageText.length > MAX_CHARS_PER_PAGE) {
        pageText = pageText.slice(0, MAX_CHARS_PER_PAGE) + "\n[…página truncada por tamaño…]";
      }
      buffer += pageText + "\n";

      if (buffer.length >= MAX_CHARS_PER_SEGMENT || p === end) {
        const t = buffer.trim();
        buffer = "";
        const pf = segPageFrom;
        const pt = p;
        segPageFrom = p + 1;
        if (t.length > 0) {
          const { resumeNextPart } = await embedAndInsert(t, pf, pt, {
            resumeFromPart: activeResume,
            maxPartsThisHttp: CHUNKS_PER_HTTP,
          });
          if (resumeNextPart != null) {
            return jsonOk({
              attachment_index_id: indexId,
              pages_done: pageStart,
              total_pages: totalPages,
              done: false,
              next_page: pageStart,
              resume_from_chunk_next: resumeNextPart,
              continuation_chunk_index_next: chunkIndex,
              chunks_this_batch: inserted,
            });
          }
          activeResume = 0;
        }
      }
    }
    if (buffer.trim().length > 0) {
      const { resumeNextPart } = await embedAndInsert(buffer.trim(), segPageFrom, end, {
        resumeFromPart: activeResume,
        maxPartsThisHttp: CHUNKS_PER_HTTP,
      });
      if (resumeNextPart != null) {
        return jsonOk({
          attachment_index_id: indexId,
          pages_done: pageStart,
          total_pages: totalPages,
          done: false,
          next_page: pageStart,
          resume_from_chunk_next: resumeNextPart,
          continuation_chunk_index_next: chunkIndex,
          chunks_this_batch: inserted,
        });
      }
    }

    const done = end >= totalPages;
    return jsonOk({
      attachment_index_id: indexId,
      pages_done: end,
      total_pages: totalPages,
      done,
      next_page: done ? null : end + 1,
      resume_from_chunk_next: null,
      continuation_chunk_index_next: chunkIndex,
      chunks_this_batch: inserted,
    });
  } catch (e) {
    console.error("index-chat-attachment:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
