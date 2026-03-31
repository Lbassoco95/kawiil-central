import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Solo embeddings + DB. El PDF se parsea en el navegador (`client_pdf_page`).
 * Sin chunkText() pesado: un trozo fijo por invocación (WORKER_LIMIT / 546).
 *
 * Operación: deploy manual tras cambios:
 *   supabase functions deploy index-chat-attachment --project-ref qppfampapbxdgednkofc
 * Secretos: OPENAI_API_KEY
 */
const MAX_CHARS_PER_PAGE = 8000;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
/** Caracteres por trozo por request (baja CPU vs chunkText sobre 8k). */
const EMBED_SLICE_CHARS = 900;
const EMBED_SLICE_OVERLAP = 36;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

async function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function embedOneText(text: string, apiKey: string): Promise<number[]> {
  const clean = text.replace(/\n+/g, " ").trim();
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
      return data.data[0].embedding as number[];
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

Deno.serve(async (req) => {
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
      /** Desplazamiento en caracteres dentro del texto de la página actual (no índice de chunkText). */
      resume_from_chunk?: number;
      continuation_chunk_index?: number;
    };

    const path = body.path;
    const name = body.name || "documento.pdf";
    const mime = (body.mime_type || "").toLowerCase();
    const pageStart = Math.max(1, Math.floor(Number(body.page_start) || 1));
    const indexId = body.attachment_index_id || crypto.randomUUID();
    const charOffset = Math.max(0, Math.floor(Number(body.resume_from_chunk) || 0));
    let chunkIndex = Math.max(0, Math.floor(Number(body.continuation_chunk_index) || 0));

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

    if (pageStart === 1 && charOffset === 0 && !body.attachment_index_id) {
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

    let pageText = body.client_pdf_page!.text;
    if (pageText.length > MAX_CHARS_PER_PAGE) {
      pageText = pageText.slice(0, MAX_CHARS_PER_PAGE) + "\n[…página truncada por tamaño…]";
    }

    const jsonOk = (payload: Record<string, unknown>) =>
      new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const endPage = pageStart;

    if (charOffset > pageText.length) {
      return new Response(JSON.stringify({ error: "resume_from_chunk fuera del texto de página" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (charOffset >= pageText.length || pageText.length === 0) {
      const done = endPage >= totalPages;
      return jsonOk({
        attachment_index_id: indexId,
        pages_done: endPage,
        total_pages: totalPages,
        done,
        next_page: done ? null : endPage + 1,
        resume_from_chunk_next: null,
        continuation_chunk_index_next: chunkIndex,
        chunks_this_batch: 0,
      });
    }

    const sliceEnd = Math.min(charOffset + EMBED_SLICE_CHARS, pageText.length);
    const content = pageText.slice(charOffset, sliceEnd).trim();
    let inserted = 0;

    if (content.length >= 12) {
      const embedding = await embedOneText(content, openaiKey);
      const row = {
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
          page_from: pageStart,
          page_to: pageStart,
          chunk_index: chunkIndex,
          char_from: charOffset,
          char_to: sliceEnd,
        },
        embedding: JSON.stringify(embedding),
        token_count: estimateTokens(content),
      };
      const { error: insErr } = await svc.from("document_chunks").insert(row);
      if (insErr) {
        console.error("insert chunk:", insErr);
        throw new Error(insErr.message);
      }
      inserted = 1;
      chunkIndex += 1;
    }

    const hasMoreOnPage = sliceEnd < pageText.length;
    if (hasMoreOnPage) {
      const nextOff = Math.max(0, sliceEnd - EMBED_SLICE_OVERLAP);
      return jsonOk({
        attachment_index_id: indexId,
        pages_done: pageStart,
        total_pages: totalPages,
        done: false,
        next_page: pageStart,
        resume_from_chunk_next: nextOff,
        continuation_chunk_index_next: chunkIndex,
        chunks_this_batch: inserted,
      });
    }

    const done = endPage >= totalPages;
    return jsonOk({
      attachment_index_id: indexId,
      pages_done: endPage,
      total_pages: totalPages,
      done,
      next_page: done ? null : endPage + 1,
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
