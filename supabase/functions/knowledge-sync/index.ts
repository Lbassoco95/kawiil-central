import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  const supabase = createClient(supabaseUrl, serviceKey);

  const activeLogIds: string[] = [];

  try {
    const body = await req.json().catch(() => ({}));
    const targetAgent: string | undefined = body.agent;
    const targetClientId: string | undefined = body.client_id;

    const { data: orgs } = await supabase.from("organizations").select("id");
    if (!orgs?.length) {
      return json({ message: "No organizations found" });
    }

    const orgId = orgs[0].id;
    const results: Record<string, any> = {};

    if (!targetAgent || targetAgent === "archivista") {
      const logId = await startLog(supabase, orgId, "archivista");
      activeLogIds.push(logId);
      await runArchivista(supabase, supabaseUrl, serviceKey, orgId, logId, targetClientId);
      activeLogIds.pop();
      await notifyCompletion(supabase, orgId, "Archivista", "completó el escaneo de documentos");
      results.archivista = "completed";
    }
    if (!targetAgent || targetAgent === "integrador") {
      const logId = await startLog(supabase, orgId, "integrador");
      activeLogIds.push(logId);
      await runIntegrador(supabase, orgId, anthropicKey, logId, targetClientId);
      activeLogIds.pop();
      await notifyCompletion(supabase, orgId, "Integrador", "generó perfiles de conocimiento");
      results.integrador = "completed";
    }
    if (!targetAgent || targetAgent === "nutritor") {
      const logId = await startLog(supabase, orgId, "nutritor");
      activeLogIds.push(logId);
      await runNutritor(supabase, orgId, anthropicKey, logId);
      activeLogIds.pop();
      await notifyCompletion(supabase, orgId, "Nutritor", "actualizó el feed de novedades");
      results.nutritor = "completed";
    }

    return json({ success: true, results });
  } catch (err: any) {
    console.error("knowledge-sync error:", err);
    for (const orphanId of activeLogIds) {
      await failLog(supabase, orphanId, `Error global: ${err.message}`).catch(() => {});
    }
    return json({ error: err.message }, 500);
  }
});

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ────────────── NOTIFICATIONS ──────────────
async function notifyCompletion(supabase: any, orgId: string, agentLabel: string, description: string) {
  try {
    // Get users with conocimiento permission
    const { data: permUsers } = await supabase
      .from("user_module_permissions")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("module_key", "conocimiento")
      .eq("enabled", true);

    // Also get transformadores (implicit full access)
    const { data: transformadores } = await supabase
      .from("user_roles")
      .select("user_id")
      .eq("role", "transformador");

    const userIds = new Set<string>();
    for (const u of permUsers || []) userIds.add(u.user_id);
    for (const u of transformadores || []) userIds.add(u.user_id);

    if (userIds.size === 0) return;

    const rows = Array.from(userIds).map((uid) => ({
      user_id: uid,
      organization_id: orgId,
      type: "knowledge_sync",
      title: `Agente ${agentLabel} completado`,
      body: `El agente ${agentLabel} ${description}.`,
      entity_type: "knowledge",
      entity_id: orgId,
      source_user_id: uid,
    }));

    await supabase.from("notifications").insert(rows);
  } catch (e: any) {
    console.error("notifyCompletion error:", e.message);
  }
}

// ────────────── ARCHIVISTA ──────────────
async function runArchivista(
  supabase: any,
  supabaseUrl: string,
  serviceKey: string,
  orgId: string,
  logId: string,
  targetClientId?: string,
) {
  try {
    let query = supabase
      .from("clients")
      .select("id, name, dropbox_folder_path")
      .eq("organization_id", orgId)
      .not("dropbox_folder_path", "is", null);

    if (targetClientId) {
      query = query.eq("id", targetClientId);
    }

    const { data: clients } = await query;
    let totalDocs = 0;
    const clientResults: any[] = [];

    for (const client of clients || []) {
      try {
        const resp = await fetch(`${supabaseUrl}/functions/v1/index-dropbox`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            folder_path: client.dropbox_folder_path,
            client_id: client.id,
            organization_id: orgId,
          }),
        });

        const result = await resp.json().catch(() => ({ indexed: 0 }));
        const indexed = result.indexed || result.documents_indexed || 0;
        totalDocs += indexed;

        clientResults.push({
          client_id: client.id,
          client_name: client.name,
          docs_indexed: indexed,
        });
      } catch (e: any) {
        clientResults.push({
          client_id: client.id,
          client_name: client.name,
          error: e.message,
        });
      }
    }

    const { count: chunkCount } = await supabase
      .from("document_chunks")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);

    const { count: docCount } = await supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId);

    await completeLog(supabase, logId, {
      clients_scanned: (clients || []).length,
      docs_indexed: totalDocs,
      total_docs: docCount || 0,
      total_chunks: chunkCount || 0,
      details: clientResults,
    });
  } catch (err: any) {
    await failLog(supabase, logId, err.message);
  }
}

// ────────────── INTEGRADOR ──────────────
async function runIntegrador(
  supabase: any,
  orgId: string,
  anthropicKey: string | undefined,
  logId: string,
  targetClientId?: string,
) {
  try {
    if (!anthropicKey) {
      await completeLog(supabase, logId, { skipped: true, reason: "No ANTHROPIC_API_KEY" });
      return;
    }

    const { data: lastSync } = await supabase
      .from("knowledge_sync_logs")
      .select("completed_at")
      .eq("organization_id", orgId)
      .eq("agent", "integrador")
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .single();

    const since = lastSync?.completed_at || "2020-01-01T00:00:00Z";

    let clientQuery = supabase
      .from("clients")
      .select("id, name, primary_area, services")
      .eq("organization_id", orgId)
      .eq("status", "activo");

    if (targetClientId) {
      clientQuery = clientQuery.eq("id", targetClientId);
    }

    const { data: clients } = await clientQuery;
    let insightsCreated = 0;
    const clientDetails: any[] = [];
    const projectDetails: any[] = [];

    for (const client of clients || []) {
      try {
        let chunkQuery = supabase
          .from("document_chunks")
          .select("id, content, source_type, metadata")
          .eq("client_id", client.id);

        if (since !== "2020-01-01T00:00:00Z") {
          chunkQuery = chunkQuery.gte("created_at", since);
        }

        const { data: recentChunks } = await chunkQuery.limit(50);

        if (!recentChunks?.length) {
          clientDetails.push({ client_id: client.id, client_name: client.name, chunks: 0, insight_generated: false, skipped: true });
          continue;
        }

        const chunkSummary = recentChunks
          .map((c: any, i: number) => `[${i + 1}] (${c.source_type}) ${c.content?.substring(0, 500)}`)
          .join("\n---\n");

        const claudeResp = await callClaude(anthropicKey, [
          {
            role: "user",
            content: `Eres un analista de un despacho contable y legal. Analiza los siguientes fragmentos de documentos del cliente "${client.name}" y genera:
1. Un perfil de conocimiento actualizado del cliente (qué sabemos, en qué áreas tenemos información)
2. Patrones detectados (documentos faltantes, vencimientos, cambios significativos)
3. Recomendaciones de acción

Los servicios del cliente son: ${(client.services || []).join(", ") || "no especificados"}
Área principal: ${client.primary_area || "no especificada"}

Fragmentos recientes:
${chunkSummary}

Responde en formato JSON:
{
  "profile": "texto markdown con el perfil",
  "patterns": ["patron1", "patron2"],
  "recommendations": ["recomendacion1", "recomendacion2"]
}`,
          },
        ]);

        let insightGenerated = false;
        if (claudeResp) {
          let parsed: any;
          try {
            const jsonMatch = claudeResp.match(/\{[\s\S]*\}/);
            parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
          } catch {
            parsed = null;
          }

          if (parsed?.profile) {
            await supabase.from("knowledge_insights").upsert(
              {
                organization_id: orgId,
                client_id: client.id,
                insight_type: "client_profile",
                title: `Perfil de conocimiento: ${client.name}`,
                content: parsed.profile,
                metadata: {
                  patterns: parsed.patterns || [],
                  recommendations: parsed.recommendations || [],
                  chunks_analyzed: recentChunks.length,
                },
                source_chunks: recentChunks.map((c: any) => c.id),
                updated_at: new Date().toISOString(),
              },
              { onConflict: "organization_id,client_id,insight_type", ignoreDuplicates: false },
            );
            insightsCreated++;
            insightGenerated = true;
          }

          for (const pattern of parsed?.patterns || []) {
            await supabase.from("knowledge_insights").insert({
              organization_id: orgId,
              client_id: client.id,
              insight_type: "pattern",
              title: `Patrón: ${client.name}`,
              content: pattern,
              metadata: {},
            });
            insightsCreated++;
          }
        }

        clientDetails.push({
          client_id: client.id,
          client_name: client.name,
          chunks: recentChunks.length,
          insight_generated: insightGenerated,
        });
      } catch (e: any) {
        clientDetails.push({ client_id: client.id, client_name: client.name, error: e.message });
      }
    }

    // Project-level insights
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name, area, client_id, clients(name)")
      .eq("organization_id", orgId)
      .in("status", ["activo", "pausado"]);

    for (const project of projects || []) {
      try {
        let projChunkQuery = supabase
          .from("document_chunks")
          .select("id, content, source_type")
          .eq("project_id", project.id);

        if (since !== "2020-01-01T00:00:00Z") {
          projChunkQuery = projChunkQuery.gte("created_at", since);
        }

        const { data: projChunks } = await projChunkQuery.limit(30);

        if (!projChunks?.length) {
          projectDetails.push({ project_id: project.id, project_name: project.name, client_name: project.clients?.name || null, chunks: 0, insight_generated: false, skipped: true });
          continue;
        }

        const chunkText = projChunks
          .map((c: any, i: number) => `[${i + 1}] (${c.source_type}) ${c.content?.substring(0, 400)}`)
          .join("\n---\n");

        const resp = await callClaude(anthropicKey, [
          {
            role: "user",
            content: `Analiza los fragmentos del proyecto "${project.name}" (área: ${project.area || "general"}, cliente: ${project.clients?.name || "N/A"}) y genera un resumen del estado de conocimiento en formato JSON:
{
  "summary": "resumen markdown breve del conocimiento disponible para este proyecto",
  "gaps": ["información faltante 1", "..."],
  "next_steps": ["acción recomendada 1", "..."]
}

Fragmentos:
${chunkText}`,
          },
        ]);

        let insightGenerated = false;
        if (resp) {
          let parsed: any;
          try {
            const m = resp.match(/\{[\s\S]*\}/);
            parsed = m ? JSON.parse(m[0]) : null;
          } catch {
            parsed = null;
          }

          if (parsed?.summary) {
            await supabase.from("knowledge_insights").upsert(
              {
                organization_id: orgId,
                project_id: project.id,
                client_id: project.client_id,
                area: project.area || null,
                insight_type: "project_profile",
                title: `Conocimiento: ${project.name}`,
                content: parsed.summary,
                metadata: { gaps: parsed.gaps || [], next_steps: parsed.next_steps || [] },
                source_chunks: projChunks.map((c: any) => c.id),
                updated_at: new Date().toISOString(),
              },
              { onConflict: "organization_id,project_id,insight_type", ignoreDuplicates: false },
            );
            insightsCreated++;
            insightGenerated = true;
          }
        }

        projectDetails.push({
          project_id: project.id,
          project_name: project.name,
          client_name: project.clients?.name || null,
          chunks: projChunks.length,
          insight_generated: insightGenerated,
        });
      } catch (e: any) {
        projectDetails.push({ project_id: project.id, project_name: project.name, error: e.message });
      }
    }

    await completeLog(supabase, logId, {
      clients_analyzed: (clients || []).length,
      projects_analyzed: (projects || []).length,
      insights_created: insightsCreated,
      details: [...clientDetails, ...projectDetails],
    });
  } catch (err: any) {
    await failLog(supabase, logId, err.message);
  }
}

// ────────────── NUTRITOR ──────────────
async function runNutritor(supabase: any, orgId: string, anthropicKey: string | undefined, logId: string) {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    const { data: recentInsights } = await supabase
      .from("knowledge_insights")
      .select("id, title, content, insight_type, client_id, project_id, clients(name), projects(name)")
      .eq("organization_id", orgId)
      .gte("updated_at", sevenDaysAgo)
      .order("updated_at", { ascending: false })
      .limit(30);

    const { data: recentDocs } = await supabase
      .from("documents")
      .select("id, name, client_id, project_id, document_type, created_at")
      .eq("organization_id", orgId)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(20);

    let feedItems = 0;
    const feedBreakdown = { documents: 0, alerts: 0, recommendations: 0, briefing: 0 };
    const feedDetails: any[] = [];

    for (const doc of recentDocs || []) {
      await supabase.from("knowledge_feed").insert({
        organization_id: orgId,
        feed_type: "new_document",
        title: `Nuevo documento: ${doc.name}`,
        summary: `Tipo: ${doc.document_type || "general"}. Indexado automáticamente.`,
        related_client_id: doc.client_id,
        related_project_id: doc.project_id,
      });
      feedItems++;
      feedBreakdown.documents++;
      feedDetails.push({ type: "new_document", name: doc.name });
    }

    for (const insight of recentInsights || []) {
      if (insight.insight_type === "pattern" || insight.insight_type === "recommendation") {
        const feedType = insight.insight_type === "pattern" ? "alert" : "recommendation";
        await supabase.from("knowledge_feed").insert({
          organization_id: orgId,
          feed_type: feedType,
          title: insight.title,
          summary: insight.content?.substring(0, 200),
          detail: insight.content,
          related_client_id: insight.client_id,
          related_project_id: insight.project_id,
        });
        feedItems++;
        if (feedType === "alert") feedBreakdown.alerts++;
        else feedBreakdown.recommendations++;
        feedDetails.push({ type: feedType, title: insight.title });
      }
    }

    // Generate briefing with Claude if we have any data
    if (anthropicKey) {
      let summaryInput = "";

      if ((recentDocs?.length || 0) > 0 || (recentInsights?.length || 0) > 0) {
        summaryInput = [
          ...(recentDocs || []).map((d: any) => `- Doc nuevo: ${d.name} (tipo: ${d.document_type || "general"})`),
          ...(recentInsights || []).map((i: any) => `- Insight (${i.insight_type}): ${i.title}`),
        ].join("\n");
      } else {
        // No recent data: fetch global stats to generate a status briefing
        const { count: totalDocs } = await supabase
          .from("documents")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId);
        const { count: totalChunks } = await supabase
          .from("document_chunks")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId);
        const { count: totalClients } = await supabase
          .from("clients")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("status", "activo");
        const { count: totalProjects } = await supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .in("status", ["activo", "pausado"]);

        summaryInput = `Estado actual de la base de conocimiento:
- ${totalDocs || 0} documentos registrados
- ${totalChunks || 0} fragmentos indexados con embeddings
- ${totalClients || 0} clientes activos
- ${totalProjects || 0} proyectos activos/pausados
- No se detectaron novedades en los últimos 7 días`;
      }

      const briefing = await callClaude(anthropicKey, [
        {
          role: "user",
          content: `Genera un briefing ejecutivo de máximo 5 párrafos para el equipo de un despacho contable y legal mexicano. Resume el estado actual y novedades:

${summaryInput}

Responde en markdown, tono profesional y conciso. Si no hay novedades recientes, da un resumen del estado general y sugiere acciones para mejorar la base de conocimiento.`,
        },
      ]);

      if (briefing) {
        await supabase.from("knowledge_feed").insert({
          organization_id: orgId,
          feed_type: "insight",
          title: `Briefing — ${new Date().toLocaleDateString("es-MX")}`,
          summary: "Resumen ejecutivo del aprendizaje reciente",
          detail: briefing,
        });
        feedItems++;
        feedBreakdown.briefing++;
        feedDetails.push({ type: "briefing", title: `Briefing — ${new Date().toLocaleDateString("es-MX")}` });
      }
    }

    await completeLog(supabase, logId, {
      feed_items_created: feedItems,
      recent_insights: (recentInsights || []).length,
      recent_docs: (recentDocs || []).length,
      breakdown: feedBreakdown,
      details: feedDetails,
    });
  } catch (err: any) {
    await failLog(supabase, logId, err.message);
  }
}

// ────────────── HELPERS ──────────────
async function startLog(supabase: any, orgId: string, agent: string): Promise<string> {
  const { data } = await supabase
    .from("knowledge_sync_logs")
    .insert({ organization_id: orgId, agent, status: "running" })
    .select("id")
    .single();
  return data?.id;
}

async function completeLog(supabase: any, logId: string, stats: any) {
  if (!logId) return;
  await supabase
    .from("knowledge_sync_logs")
    .update({ status: "completed", completed_at: new Date().toISOString(), stats })
    .eq("id", logId);
}

async function failLog(supabase: any, logId: string, error: string) {
  if (!logId) return;
  await supabase
    .from("knowledge_sync_logs")
    .update({ status: "failed", completed_at: new Date().toISOString(), error_message: error })
    .eq("id", logId);
}

async function callClaude(apiKey: string, messages: any[]): Promise<string | null> {
  try {
    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        messages,
      }),
    });

    if (!resp.ok) {
      console.error("Claude error:", resp.status, await resp.text());
      return null;
    }

    const data = await resp.json();
    const textBlock = data.content?.find((b: any) => b.type === "text");
    return textBlock?.text || null;
  } catch (e: any) {
    console.error("callClaude error:", e.message);
    return null;
  }
}
