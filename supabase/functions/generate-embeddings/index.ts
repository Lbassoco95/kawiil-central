import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const OPENAI_EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_TOKENS_PER_CHUNK = 700;
const OVERLAP_TOKENS = 100;

interface ChunkInput {
  content: string;
  metadata?: Record<string, unknown>;
}

interface EmbeddingRequest {
  texts?: string[];
  chunks?: ChunkInput[];
  source_type: string;
  source_id?: string;
  document_id?: string;
  client_id?: string;
  project_id?: string;
  organization_id: string;
  auto_chunk?: boolean;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function chunkText(
  text: string,
  maxTokens = MAX_TOKENS_PER_CHUNK,
  overlapTokens = OVERLAP_TOKENS
): string[] {
  const estimatedTotal = estimateTokens(text);
  if (estimatedTotal <= maxTokens) return [text];

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

    chunks.push(text.slice(start, end).trim());
    start = end - overlapChars;
    if (start >= text.length) break;
  }

  return chunks.filter((c) => c.length > 20);
}

async function generateEmbeddings(
  texts: string[],
  apiKey: string
): Promise<number[][]> {
  const cleanTexts = texts.map((t) => t.replace(/\n+/g, " ").trim());

  const response = await fetch(OPENAI_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: cleanTexts,
      model: EMBEDDING_MODEL,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI Embeddings API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return data.data.map(
    (item: { embedding: number[] }) => item.embedding
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return new Response(
        JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body: EmbeddingRequest = await req.json();
    const {
      texts,
      chunks: inputChunks,
      source_type,
      source_id,
      document_id,
      client_id,
      project_id,
      organization_id,
      auto_chunk = true,
    } = body;

    if (!organization_id || !source_type) {
      return new Response(
        JSON.stringify({ error: "organization_id and source_type are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let chunksToEmbed: ChunkInput[] = [];

    if (inputChunks && inputChunks.length > 0) {
      chunksToEmbed = inputChunks;
    } else if (texts && texts.length > 0) {
      for (const text of texts) {
        if (auto_chunk) {
          const parts = chunkText(text);
          chunksToEmbed.push(
            ...parts.map((p, i) => ({
              content: p,
              metadata: { chunk_index: i, total_chunks: parts.length },
            }))
          );
        } else {
          chunksToEmbed.push({ content: text });
        }
      }
    } else {
      return new Response(
        JSON.stringify({ error: "Provide texts[] or chunks[]" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    chunksToEmbed = chunksToEmbed.filter((c) => c.content.trim().length > 20);

    if (chunksToEmbed.length === 0) {
      return new Response(
        JSON.stringify({ inserted: 0, message: "No valid chunks to embed" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const BATCH_SIZE = 50;
    let totalInserted = 0;

    for (let i = 0; i < chunksToEmbed.length; i += BATCH_SIZE) {
      const batch = chunksToEmbed.slice(i, i + BATCH_SIZE);
      const embeddings = await generateEmbeddings(
        batch.map((c) => c.content),
        openaiKey
      );

      const rows = batch.map((chunk, idx) => ({
        organization_id,
        document_id: document_id || null,
        client_id: client_id || null,
        project_id: project_id || null,
        source_type,
        source_id: source_id || null,
        content: chunk.content,
        metadata: chunk.metadata || {},
        embedding: JSON.stringify(embeddings[idx]),
        token_count: estimateTokens(chunk.content),
      }));

      const { error: insertError, data: inserted } = await supabase
        .from("document_chunks")
        .insert(rows)
        .select("id");

      if (insertError) {
        console.error("Insert error:", insertError);
        throw new Error(`DB insert failed: ${insertError.message}`);
      }

      totalInserted += inserted?.length || 0;
    }

    console.log(
      `Embedded ${totalInserted} chunks for ${source_type}/${source_id || "batch"} in org ${organization_id}`
    );

    return new Response(
      JSON.stringify({
        inserted: totalInserted,
        source_type,
        source_id,
        organization_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("generate-embeddings error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
