import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Edge Supabase: ~256 MB RAM y ~2 s de CPU por request (I/O async no cuenta).
 * No se puede “subir la VM”; hay que hacer poco trabajo por invocación.
 * 1 página/request minimiza pico de CPU/memoria tras cargar el PDF.
 */
const PAGE_BATCH = 1;
const MAX_CHARS_PER_SEGMENT = 2800;
/** Tope de caracteres por página (PDFs con texto enorme en una página). */
const MAX_CHARS_PER_PAGE = 8000;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_TOKENS_PER_CHUNK = 550;
const OVERLAP_TOKENS = 80;
const EMBED_BATCH = 4;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

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

async function downloadStorageObject(
  svc: ReturnType<typeof createClient>,
  bucket: string,
  path: string,
): Promise<Uint8Array | null> {
  const { data, error } = await svc.storage.from(bucket).download(path);
  if (error || !data) {
    console.warn("storage download failed", bucket, path, error?.message);
    return null;
  }
  return new Uint8Array(await data.arrayBuffer());
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
    };

    const bucket = body.bucket || "chat-uploads";
    const path = body.path;
    const name = body.name || "documento.pdf";
    const mime = (body.mime_type || "").toLowerCase();
    const pageStart = Math.max(1, Math.floor(Number(body.page_start) || 1));
    const indexId = body.attachment_index_id || crypto.randomUUID();

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

    const svc = createClient(supabaseUrl, serviceKey);
    let bytes = await downloadStorageObject(svc, bucket, path);
    if (!bytes || bytes.length === 0) {
      return new Response(JSON.stringify({ error: "No se pudo descargar el archivo" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (bytes.length > MAX_PDF_BYTES) {
      return new Response(
        JSON.stringify({
          error: `PDF demasiado grande (~${Math.round(bytes.length / (1024 * 1024))} MB). Máx. ${Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB para indexar en el servidor.`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (pageStart === 1) {
      const { error: delErr } = await svc.from("document_chunks")
        .delete()
        .eq("organization_id", orgId)
        .eq("source_type", "chat_attachment")
        .contains("metadata", { storage_path: path });
      if (delErr) {
        console.warn("delete old chat_attachment chunks:", delErr.message);
      }
    }

    const { getDocumentProxy } = await import(
      "https://esm.sh/unpdf@0.12.1",
    ) as {
      getDocumentProxy: (data: Uint8Array) => Promise<{
        numPages: number;
        destroy?: () => Promise<void>;
        getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: { str?: string }[] }> }>;
      }>;
    };

    const pdf = await getDocumentProxy(bytes);
    // Soltar el buffer original; el proxy puede mantener copia interna.
    bytes = new Uint8Array(0);
    const totalPages = pdf.numPages || 0;
    if (totalPages === 0) {
      return new Response(
        JSON.stringify({
          attachment_index_id: indexId,
          pages_done: 0,
          total_pages: 0,
          done: true,
          next_page: null,
          chunks_this_batch: 0,
          warning: "PDF sin páginas legibles",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const end = Math.min(totalPages, pageStart + PAGE_BATCH - 1);

    let inserted = 0;
    let chunkIndex = 0;
    let buffer = "";
    let segPageFrom = pageStart;

    const embedAndInsert = async (plain: string, pageFrom: number, pageTo: number) => {
      const t = plain.trim();
      if (t.length === 0) return;
      const parts = chunkText(t);
      for (let i = 0; i < parts.length; i += EMBED_BATCH) {
        const slice = parts.slice(i, i + EMBED_BATCH);
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
        if (i + EMBED_BATCH < parts.length) await sleepMs(250);
      }
    };

    for (let p = pageStart; p <= end; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      let pageText = "";
      for (const item of tc.items) {
        if (item && typeof item.str === "string") pageText += item.str;
      }
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
          await embedAndInsert(t, pf, pt);
        }
      }
    }
    if (buffer.trim().length > 0) {
      await embedAndInsert(buffer.trim(), segPageFrom, end);
    }

    try {
      await pdf.destroy?.();
    } catch {
      /* ignore */
    }

    const done = end >= totalPages;
    return new Response(
      JSON.stringify({
        attachment_index_id: indexId,
        pages_done: end,
        total_pages: totalPages,
        done,
        next_page: done ? null : end + 1,
        chunks_this_batch: inserted,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("index-chat-attachment:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
