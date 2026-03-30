import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const OPENAI_URL = "https://api.openai.com/v1/embeddings";
const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIMS = 1536;
const BATCH_SIZE = 25;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) {
      return json({ error: "OPENAI_API_KEY not set" }, 500);
    }

    const body = await req.json().catch(() => ({}));
    const { organization_id, since } = body;

    if (!organization_id) {
      return json({ error: "organization_id is required" }, 400);
    }

    const sinceDate = since || "2020-01-01T00:00:00Z";
    let tasksIndexed = 0;
    let projectsIndexed = 0;
    let chunksCreated = 0;

    // ── Index tasks ──
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, title, description, client_id, project_id, priority, status, due_date, area, updated_at")
      .eq("organization_id", organization_id)
      .gte("updated_at", sinceDate)
      .order("updated_at", { ascending: false })
      .limit(500);

    for (const task of tasks || []) {
      const existingChunk = await supabase
        .from("document_chunks")
        .select("id")
        .eq("source_type", "task")
        .eq("source_id", task.id)
        .limit(1)
        .single();

      const { data: comments } = await supabase
        .from("task_comments")
        .select("content")
        .eq("task_id", task.id)
        .order("created_at", { ascending: true })
        .limit(20);

      const commentText = (comments || [])
        .map((c: any) => c.content)
        .filter(Boolean)
        .join("\n");

      const content = [
        `Tarea: ${task.title}`,
        task.description ? `Descripción: ${task.description}` : "",
        task.area ? `Área: ${task.area}` : "",
        task.priority ? `Prioridad: ${task.priority}` : "",
        task.status ? `Estado: ${task.status}` : "",
        task.due_date ? `Vencimiento: ${task.due_date}` : "",
        commentText ? `Comentarios:\n${commentText}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      if (content.length < 30) continue;

      const embedding = await getEmbedding(openaiKey, content);
      if (!embedding) continue;

      if (existingChunk.data?.id) {
        await supabase
          .from("document_chunks")
          .update({
            content,
            embedding: JSON.stringify(embedding),
            token_count: Math.ceil(content.length / 3.5),
            metadata: { task_status: task.status, task_priority: task.priority, updated_at: task.updated_at },
          })
          .eq("id", existingChunk.data.id);
      } else {
        await supabase.from("document_chunks").insert({
          organization_id,
          client_id: task.client_id || null,
          project_id: task.project_id || null,
          source_type: "task",
          source_id: task.id,
          content,
          embedding: JSON.stringify(embedding),
          token_count: Math.ceil(content.length / 3.5),
          metadata: { task_status: task.status, task_priority: task.priority },
        });
        chunksCreated++;
      }
      tasksIndexed++;
    }

    // ── Index projects ──
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name, description, area, client_id, status, phases, service_tags, updated_at")
      .eq("organization_id", organization_id)
      .gte("updated_at", sinceDate)
      .order("updated_at", { ascending: false })
      .limit(200);

    for (const project of projects || []) {
      const existingChunk = await supabase
        .from("document_chunks")
        .select("id")
        .eq("source_type", "project")
        .eq("source_id", project.id)
        .limit(1)
        .single();

      const { data: comments } = await supabase
        .from("project_comments")
        .select("content")
        .eq("project_id", project.id)
        .order("created_at", { ascending: true })
        .limit(20);

      const commentText = (comments || [])
        .map((c: any) => c.content)
        .filter(Boolean)
        .join("\n");

      const phases = Array.isArray(project.phases)
        ? project.phases.map((p: any) => p.name).join(", ")
        : "";
      const tags = Array.isArray(project.service_tags)
        ? project.service_tags.join(", ")
        : "";

      const content = [
        `Proyecto: ${project.name}`,
        project.description ? `Descripción: ${project.description}` : "",
        project.area ? `Área: ${project.area}` : "",
        project.status ? `Estado: ${project.status}` : "",
        phases ? `Fases: ${phases}` : "",
        tags ? `Servicios: ${tags}` : "",
        commentText ? `Comentarios:\n${commentText}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      if (content.length < 30) continue;

      const embedding = await getEmbedding(openaiKey, content);
      if (!embedding) continue;

      if (existingChunk.data?.id) {
        await supabase
          .from("document_chunks")
          .update({
            content,
            embedding: JSON.stringify(embedding),
            token_count: Math.ceil(content.length / 3.5),
            metadata: { project_status: project.status, project_area: project.area, updated_at: project.updated_at },
          })
          .eq("id", existingChunk.data.id);
      } else {
        await supabase.from("document_chunks").insert({
          organization_id,
          client_id: project.client_id || null,
          project_id: project.id,
          source_type: "project",
          source_id: project.id,
          content,
          embedding: JSON.stringify(embedding),
          token_count: Math.ceil(content.length / 3.5),
          metadata: { project_status: project.status, project_area: project.area },
        });
        chunksCreated++;
      }
      projectsIndexed++;
    }

    const result = {
      success: true,
      tasks_indexed: tasksIndexed,
      projects_indexed: projectsIndexed,
      chunks_created: chunksCreated,
      total_tasks: (tasks || []).length,
      total_projects: (projects || []).length,
    };
    console.log("index-platform-data result:", result);
    return json(result);
  } catch (error) {
    console.error("index-platform-data error:", error);
    return json({ error: (error as Error).message }, 500);
  }
});

async function getEmbedding(apiKey: string, text: string): Promise<number[] | null> {
  try {
    const resp = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: [text.replace(/\n+/g, " ").trim().substring(0, 8000)],
        model: EMBED_MODEL,
        dimensions: EMBED_DIMS,
      }),
    });
    if (!resp.ok) {
      console.error("OpenAI embedding error:", resp.status);
      return null;
    }
    const data = await resp.json();
    return data.data?.[0]?.embedding || null;
  } catch (e) {
    console.error("getEmbedding error:", e);
    return null;
  }
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
