import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Solo embeddings + DB. El PDF se parsea en el navegador (`client_pdf_page`).
 * Varios trozos y varias páginas por invocación + embeddings batch en OpenAI (pocos round-trips).
 *
 * Operación: deploy manual tras cambios:
 *   supabase functions deploy index-chat-attachment --project-ref qppfampapbxdgednkofc
 * Secretos: OPENAI_API_KEY
 */
const MAX_CHARS_PER_PAGE = 8000;
const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
/** Caracteres por trozo (si vuelve 546, bajar a ~900). */
const EMBED_SLICE_CHARS = 1600;
const EMBED_SLICE_OVERLAP = 40;
/**
 * Trozos por invocación (una llamada OpenAI `input[]` + insert). OpenAI admite hasta ~2048 inputs;
 * 80 trozos ≈ varias páginas densas y reduce round-trips frente a lotes de 12.
 */
const MAX_CHUNKS_PER_INVOCATION = 80;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

async function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function embedManyTexts(texts: string[], apiKey: string): Promise<number[][]> {
  if (texts.length === 0) return [];
  const cleaned = texts.map((t) => t.replace(/\n+/g, " ").trim());
  let lastErr = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    const resp = await fetch(OPENAI_EMBEDDINGS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: cleaned,
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const rows = data.data as { index: number; embedding: number[] }[];
      rows.sort((a, b) => a.index - b.index);
      return rows.map((r) => r.embedding);
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
      /** Varias páginas consecutivas: pages[0] = texto de `page_start`, pages[1] = page_start+1, … */
      client_pdf_pages?: { total_pages: number; pages: string[] };
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

    const batchIn = body.client_pdf_pages;
    const singleIn = body.client_pdf_page;
    let totalPages: number;
    let pageStrings: string[];

    if (
      batchIn &&
      typeof batchIn.total_pages === "number" &&
      batchIn.total_pages >= 1 &&
      Array.isArray(batchIn.pages) &&
      batchIn.pages.length >= 1
    ) {
      totalPages = Math.floor(batchIn.total_pages);
      pageStrings = batchIn.pages.map((p) => (typeof p === "string" ? p : ""));
    } else if (
      singleIn &&
      typeof singleIn.total_pages === "number" &&
      singleIn.total_pages >= 1 &&
      typeof singleIn.text === "string"
    ) {
      totalPages = Math.floor(singleIn.total_pages);
      pageStrings = [singleIn.text];
    } else {
      return new Response(
        JSON.stringify({
          error:
            "Falta el texto del PDF extraído en el navegador. Actualiza la aplicación e inténtalo de nuevo.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (charOffset > 0 && pageStrings.length !== 1) {
      return new Response(
        JSON.stringify({ error: "Con resume_from_chunk solo se admite una página por petición." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (pageStart + pageStrings.length - 1 > totalPages) {
      return new Response(JSON.stringify({ error: "Lote de páginas fuera de rango respecto a total_pages" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
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

    const clampPageText = (t: string): string => {
      if (t.length <= MAX_CHARS_PER_PAGE) return t;
      return t.slice(0, MAX_CHARS_PER_PAGE) + "\n[…página truncada por tamaño…]";
    };

    const jsonOk = (payload: Record<string, unknown>) =>
      new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const ptFirst = clampPageText(pageStrings[0] ?? "");
    if (charOffset > ptFirst.length) {
      return new Response(JSON.stringify({ error: "resume_from_chunk fuera del texto de página" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (pageStrings.length === 1 && (ptFirst.length === 0 || charOffset >= ptFirst.length)) {
      const done = pageStart >= totalPages;
      return jsonOk({
        attachment_index_id: indexId,
        pages_done: pageStart,
        total_pages: totalPages,
        done,
        next_page: done ? null : pageStart + 1,
        resume_from_chunk_next: null,
        continuation_chunk_index_next: chunkIndex,
        chunks_this_batch: 0,
      });
    }

    type SliceItem = {
      content: string;
      charFrom: number;
      charTo: number;
      chunkIndex: number;
      pageNum: number;
    };
    const items: SliceItem[] = [];
    let pIdx = 0;
    let cursor = charOffset;
    let ci = chunkIndex;
    let resumeIfNoEmbeds = charOffset;
    /** Página y texto activos tras el bucle (para respuestas sin items). */
    let tailAbsPage = pageStart;
    let tailPageText = ptFirst;

    outer: while (pIdx < pageStrings.length) {
      tailPageText = clampPageText(pageStrings[pIdx] ?? "");
      tailAbsPage = pageStart + pIdx;
      if (pIdx > 0) cursor = 0;

      if (tailPageText.length === 0) {
        pIdx += 1;
        continue;
      }

      if (cursor >= tailPageText.length) {
        pIdx += 1;
        continue;
      }

      while (items.length < MAX_CHUNKS_PER_INVOCATION && cursor < tailPageText.length) {
        const sliceEnd = Math.min(cursor + EMBED_SLICE_CHARS, tailPageText.length);
        const content = tailPageText.slice(cursor, sliceEnd).trim();
        if (content.length >= 12) {
          items.push({
            content,
            charFrom: cursor,
            charTo: sliceEnd,
            chunkIndex: ci,
            pageNum: tailAbsPage,
          });
          ci += 1;
          if (items.length >= MAX_CHUNKS_PER_INVOCATION) {
            break outer;
          }
        }
        if (sliceEnd >= tailPageText.length) {
          resumeIfNoEmbeds = tailPageText.length;
          pIdx += 1;
          continue outer;
        }
        cursor = Math.max(0, sliceEnd - EMBED_SLICE_OVERLAP);
        resumeIfNoEmbeds = cursor;
      }

      pIdx += 1;
    }

    let inserted = 0;

    if (items.length > 0) {
      const embeddings = await embedManyTexts(
        items.map((i) => i.content),
        openaiKey,
      );
      if (embeddings.length !== items.length) {
        throw new Error("OpenAI devolvió un número distinto de embeddings");
      }
      const rows = items.map((it, i) => ({
        organization_id: orgId,
        document_id: null,
        client_id: body.client_id || null,
        project_id: body.project_id || null,
        source_type: "chat_attachment",
        source_id: indexId,
        content: it.content,
        metadata: {
          attachment_index_id: indexId,
          storage_path: path,
          filename: name,
          page_from: it.pageNum,
          page_to: it.pageNum,
          chunk_index: it.chunkIndex,
          char_from: it.charFrom,
          char_to: it.charTo,
        },
        embedding: JSON.stringify(embeddings[i]),
        token_count: estimateTokens(it.content),
      }));
      const { error: insErr } = await svc.from("document_chunks").insert(rows);
      if (insErr) {
        console.error("insert chunks:", insErr);
        throw new Error(insErr.message);
      }
      inserted = items.length;
      chunkIndex = ci;
    }

    if (items.length === 0) {
      if (resumeIfNoEmbeds < tailPageText.length) {
        return jsonOk({
          attachment_index_id: indexId,
          pages_done: tailAbsPage,
          total_pages: totalPages,
          done: false,
          next_page: tailAbsPage,
          resume_from_chunk_next: resumeIfNoEmbeds,
          continuation_chunk_index_next: chunkIndex,
          chunks_this_batch: 0,
        });
      }
      const endAbs = pageStart + pageStrings.length - 1;
      const done0 = endAbs >= totalPages;
      return jsonOk({
        attachment_index_id: indexId,
        pages_done: endAbs,
        total_pages: totalPages,
        done: done0,
        next_page: done0 ? null : endAbs + 1,
        resume_from_chunk_next: null,
        continuation_chunk_index_next: chunkIndex,
        chunks_this_batch: 0,
      });
    }

    const last = items[items.length - 1];
    const lastPageText = clampPageText(pageStrings[last.pageNum - pageStart] ?? "");

    if (last.charTo < lastPageText.length) {
      return jsonOk({
        attachment_index_id: indexId,
        pages_done: last.pageNum,
        total_pages: totalPages,
        done: false,
        next_page: last.pageNum,
        resume_from_chunk_next: Math.max(0, last.charTo - EMBED_SLICE_OVERLAP),
        continuation_chunk_index_next: chunkIndex,
        chunks_this_batch: inserted,
      });
    }

    const nextAfterLast = last.pageNum + 1;
    if (nextAfterLast > totalPages) {
      return jsonOk({
        attachment_index_id: indexId,
        pages_done: totalPages,
        total_pages: totalPages,
        done: true,
        next_page: null,
        resume_from_chunk_next: null,
        continuation_chunk_index_next: chunkIndex,
        chunks_this_batch: inserted,
      });
    }

    return jsonOk({
      attachment_index_id: indexId,
      pages_done: last.pageNum,
      total_pages: totalPages,
      done: false,
      next_page: nextAfterLast,
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
