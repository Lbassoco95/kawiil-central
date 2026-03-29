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

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function chunkText(text: string): string[] {
  const estimatedTotal = estimateTokens(text);
  if (estimatedTotal <= MAX_TOKENS_PER_CHUNK) return [text];

  const charsPerToken = 3.5;
  const maxChars = Math.floor(MAX_TOKENS_PER_CHUNK * charsPerToken);
  const overlapChars = Math.floor(OVERLAP_TOKENS * charsPerToken);
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const lastParagraph = text.lastIndexOf("\n\n", end);
      const lastNewline = text.lastIndexOf("\n", end);
      const lastSentence = text.lastIndexOf(". ", end);
      if (lastParagraph > start + maxChars * 0.3) end = lastParagraph + 2;
      else if (lastNewline > start + maxChars * 0.3) end = lastNewline + 1;
      else if (lastSentence > start + maxChars * 0.3) end = lastSentence + 2;
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
  const clean = texts.map((t) => t.replace(/\n+/g, " ").trim());
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
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenAI error ${resp.status}: ${err}`);
  }
  const data = await resp.json();
  return data.data.map((d: { embedding: number[] }) => d.embedding);
}

async function insertChunks(
  supabase: ReturnType<typeof createClient>,
  chunks: { content: string; metadata: Record<string, unknown> }[],
  embeddings: number[][],
  common: Record<string, unknown>
) {
  const rows = chunks.map((c, i) => ({
    ...common,
    content: c.content,
    metadata: c.metadata,
    embedding: JSON.stringify(embeddings[i]),
    token_count: estimateTokens(c.content),
  }));
  const { error, data } = await supabase
    .from("document_chunks")
    .insert(rows)
    .select("id");
  if (error) throw new Error(`Insert failed: ${error.message}`);
  return data?.length || 0;
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

    const body = await req.json().catch(() => ({}));
    const orgId = body.organization_id;
    const sourcesToProcess: string[] = body.sources || [
      "extracted_data",
      "chat_message",
      "procedure",
      "comunicado",
    ];
    const limit = body.limit || 100;

    if (!orgId) {
      return new Response(
        JSON.stringify({ error: "organization_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stats: Record<string, number> = {};
    const BATCH = 25;

    // --- Process extracted_documents ---
    if (sourcesToProcess.includes("extracted_data")) {
      const { data: docs } = await supabase
        .from("extracted_documents")
        .select("id, document_id, organization_id, client_id, project_id, ai_summary, extracted_data, document_type, rfc_emisor, rfc_receptor, fiscal_period")
        .eq("organization_id", orgId)
        .eq("extraction_status", "completed")
        .not("ai_summary", "is", null)
        .limit(limit);

      const alreadyEmbedded = new Set<string>();
      if (docs && docs.length > 0) {
        const { data: existing } = await supabase
          .from("document_chunks")
          .select("source_id")
          .eq("source_type", "extracted_data")
          .eq("organization_id", orgId)
          .in("source_id", docs.map((d) => d.id));
        existing?.forEach((e) => alreadyEmbedded.add(e.source_id));
      }

      const toProcess = docs?.filter((d) => !alreadyEmbedded.has(d.id)) || [];
      let count = 0;

      for (let i = 0; i < toProcess.length; i += BATCH) {
        const batch = toProcess.slice(i, i + BATCH);
        const allChunks: { content: string; metadata: Record<string, unknown>; common: Record<string, unknown> }[] = [];

        for (const doc of batch) {
          let text = doc.ai_summary || "";
          if (doc.document_type) text = `[${doc.document_type}] ${text}`;
          if (doc.rfc_emisor) text += ` | RFC Emisor: ${doc.rfc_emisor}`;
          if (doc.rfc_receptor) text += ` | RFC Receptor: ${doc.rfc_receptor}`;
          if (doc.fiscal_period) text += ` | Periodo: ${doc.fiscal_period}`;

          const parts = chunkText(text);
          for (let ci = 0; ci < parts.length; ci++) {
            allChunks.push({
              content: parts[ci],
              metadata: {
                chunk_index: ci,
                total_chunks: parts.length,
                document_type: doc.document_type,
                rfc_emisor: doc.rfc_emisor,
              },
              common: {
                organization_id: orgId,
                document_id: doc.document_id,
                client_id: doc.client_id,
                project_id: doc.project_id,
                source_type: "extracted_data",
                source_id: doc.id,
              },
            });
          }
        }

        if (allChunks.length > 0) {
          const embeddings = await generateEmbeddings(
            allChunks.map((c) => c.content),
            openaiKey
          );
          const rows = allChunks.map((c, idx) => ({
            ...c.common,
            content: c.content,
            metadata: c.metadata,
            embedding: JSON.stringify(embeddings[idx]),
            token_count: estimateTokens(c.content),
          }));
          const { error } = await supabase.from("document_chunks").insert(rows);
          if (error) console.error("extracted_data insert error:", error);
          else count += rows.length;
        }
      }
      stats.extracted_data = count;
    }

    // --- Process chat_messages ---
    if (sourcesToProcess.includes("chat_message")) {
      const { data: convos } = await supabase
        .from("chat_conversations")
        .select("id, user_id, organization_id")
        .eq("organization_id", orgId)
        .limit(limit);

      let count = 0;
      for (const convo of convos || []) {
        const { data: msgs } = await supabase
          .from("chat_messages")
          .select("id, role, content, created_at")
          .eq("conversation_id", convo.id)
          .order("created_at", { ascending: true });

        if (!msgs || msgs.length === 0) continue;

        const { data: existing } = await supabase
          .from("document_chunks")
          .select("source_id")
          .eq("source_type", "chat_message")
          .in("source_id", msgs.map((m) => m.id));
        const alreadyDone = new Set(existing?.map((e) => e.source_id) || []);

        const toEmbed = msgs.filter(
          (m) => !alreadyDone.has(m.id) && m.content.length > 30
        );

        for (let i = 0; i < toEmbed.length; i += BATCH) {
          const batch = toEmbed.slice(i, i + BATCH);
          const texts = batch.map(
            (m) => `[${m.role}] ${m.content}`
          );
          const embeddings = await generateEmbeddings(texts, openaiKey);
          const rows = batch.map((m, idx) => ({
            organization_id: orgId,
            source_type: "chat_message" as const,
            source_id: m.id,
            content: texts[idx],
            metadata: {
              role: m.role,
              conversation_id: convo.id,
              user_id: convo.user_id,
            },
            embedding: JSON.stringify(embeddings[idx]),
            token_count: estimateTokens(texts[idx]),
          }));
          const { error } = await supabase.from("document_chunks").insert(rows);
          if (error) console.error("chat_message insert error:", error);
          else count += rows.length;
        }
      }
      stats.chat_message = count;
    }

    // --- Process internal_procedures ---
    if (sourcesToProcess.includes("procedure")) {
      const { data: procs } = await supabase
        .from("internal_procedures")
        .select("id, organization_id, title, description")
        .eq("organization_id", orgId);

      const { data: existing } = await supabase
        .from("document_chunks")
        .select("source_id")
        .eq("source_type", "procedure")
        .eq("organization_id", orgId);
      const done = new Set(existing?.map((e) => e.source_id) || []);

      const toProcess = procs?.filter((p) => !done.has(p.id)) || [];
      let count = 0;

      for (let i = 0; i < toProcess.length; i += BATCH) {
        const batch = toProcess.slice(i, i + BATCH);
        const texts = batch.map(
          (p) => `Procedimiento: ${p.title}${p.description ? ` - ${p.description}` : ""}`
        );
        const embeddings = await generateEmbeddings(texts, openaiKey);
        const rows = batch.map((p, idx) => ({
          organization_id: orgId,
          source_type: "procedure" as const,
          source_id: p.id,
          content: texts[idx],
          metadata: { title: p.title },
          embedding: JSON.stringify(embeddings[idx]),
          token_count: estimateTokens(texts[idx]),
        }));
        const { error } = await supabase.from("document_chunks").insert(rows);
        if (error) console.error("procedure insert error:", error);
        else count += rows.length;
      }
      stats.procedure = count;
    }

    // --- Process internal_comunicados ---
    if (sourcesToProcess.includes("comunicado")) {
      const { data: coms } = await supabase
        .from("internal_comunicados")
        .select("id, organization_id, title, body")
        .eq("organization_id", orgId);

      const { data: existing } = await supabase
        .from("document_chunks")
        .select("source_id")
        .eq("source_type", "comunicado")
        .eq("organization_id", orgId);
      const done = new Set(existing?.map((e) => e.source_id) || []);

      const toProcess = coms?.filter((c) => !done.has(c.id)) || [];
      let count = 0;

      for (let i = 0; i < toProcess.length; i += BATCH) {
        const batch = toProcess.slice(i, i + BATCH);
        const texts = batch.map(
          (c) => `Comunicado: ${c.title}${c.body ? ` - ${c.body}` : ""}`
        );
        const embeddings = await generateEmbeddings(texts, openaiKey);
        const rows = batch.map((c, idx) => ({
          organization_id: orgId,
          source_type: "comunicado" as const,
          source_id: c.id,
          content: texts[idx],
          metadata: { title: c.title },
          embedding: JSON.stringify(embeddings[idx]),
          token_count: estimateTokens(texts[idx]),
        }));
        const { error } = await supabase.from("document_chunks").insert(rows);
        if (error) console.error("comunicado insert error:", error);
        else count += rows.length;
      }
      stats.comunicado = count;
    }

    const totalChunks = Object.values(stats).reduce((a, b) => a + b, 0);
    console.log(`process-embeddings complete for org ${orgId}: ${totalChunks} chunks`, stats);

    return new Response(
      JSON.stringify({ success: true, organization_id: orgId, chunks_created: totalChunks, stats }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("process-embeddings error:", error);
    return new Response(
      JSON.stringify({ error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
