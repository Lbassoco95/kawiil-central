import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  buildComplianceProjectDescription,
  buildComplianceTaskDescriptionSuffix,
} from "@/lib/complianceProjectSummary";
import {
  calculateDueDates,
  complianceAnchorYmdFromProject,
  shouldIncludeComplianceOccurrence,
} from "@/lib/complianceDueDates";

type ServiceArea = Database["public"]["Enums"]["service_area"];

/** Actualiza la descripción de los proyectos cumplimiento activos del cliente según `client_compliance_config`. */
export async function syncComplianceProjectDescription(clientId: string): Promise<void> {
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("name")
    .eq("id", clientId)
    .single();
  if (clientErr) throw clientErr;
  if (!client) return;

  const { data: configs, error: cfgErr } = await supabase
    .from("client_compliance_config")
    .select(
      "registration_number, authorization_date, compliance_officer_name, compliance_entity_types(name, code, group_name)",
    )
    .eq("client_id", clientId)
    .eq("is_active", true);
  if (cfgErr) throw cfgErr;

  const description = buildComplianceProjectDescription(client.name, (configs || []) as any);

  const { error: upErr } = await supabase
    .from("projects")
    .update({ description })
    .eq("client_id", clientId)
    .eq("area", "cumplimiento")
    .neq("status", "cancelado");

  if (upErr) throw upErr;
}

function complianceTaskDedupeKey(templateId: string, dueDate: string | null | undefined, period: string) {
  return `${templateId}|${dueDate ?? ""}|${period}`;
}

/**
 * Inserta tareas desde plantillas para los entity_type indicados, sin duplicar
 * (cliente + plantilla + due_date + compliance_period).
 */
async function syncComplianceTasksForTemplates(params: {
  clientId: string;
  userId: string;
  projectId: string;
  organizationId: string;
  entityTypeIds: string[];
  responsibleUserId: string;
}): Promise<number> {
  const { clientId, userId, projectId, organizationId, entityTypeIds, responsibleUserId } = params;
  const year = new Date().getFullYear();

  const { data: projectMeta, error: metaErr } = await supabase
    .from("projects")
    .select("start_date, created_at")
    .eq("id", projectId)
    .single();
  if (metaErr) throw metaErr;

  const anchorYmd = complianceAnchorYmdFromProject(projectMeta?.start_date, projectMeta?.created_at);

  const { error: pruneErr } = await supabase
    .from("tasks")
    .delete()
    .eq("client_id", clientId)
    .eq("project_id", projectId)
    .eq("status", "pendiente")
    .not("compliance_template_id", "is", null)
    .lt("due_date", anchorYmd);
  if (pruneErr) throw pruneErr;

  const { data: templates, error: tplErr } = await supabase
    .from("compliance_task_templates")
    .select("*")
    .in("entity_type_id", entityTypeIds)
    .eq("is_active", true)
    .order("sort_order");
  if (tplErr) throw tplErr;

  const { data: existingRows, error: exErr } = await supabase
    .from("tasks")
    .select("compliance_template_id, due_date, compliance_period")
    .eq("client_id", clientId)
    .not("compliance_template_id", "is", null);
  if (exErr) throw exErr;

  const existingKeys = new Set<string>();
  for (const row of existingRows || []) {
    existingKeys.add(
      complianceTaskDedupeKey(
        row.compliance_template_id as string,
        row.due_date as string | null,
        (row.compliance_period as string | null) ?? "",
      ),
    );
  }

  const { data: cfgRows, error: cfgErr } = await supabase
    .from("client_compliance_config")
    .select(
      "registration_number, authorization_date, compliance_officer_name, compliance_entity_types(name, code, group_name)",
    )
    .eq("client_id", clientId)
    .eq("is_active", true);
  if (cfgErr) throw cfgErr;

  const taskContextSuffix =
    cfgRows?.length ? buildComplianceTaskDescriptionSuffix(cfgRows as any) : "";

  const tasksToInsert: Record<string, unknown>[] = [];

  for (const tpl of templates || []) {
    const dates = calculateDueDates(
      {
        periodicity: tpl.periodicity as string,
        due_day: tpl.due_day as number | null,
        due_month: tpl.due_month as number | null,
        due_month_2: tpl.due_month_2 as number | null,
      },
      year,
    );

    for (const { dueDate, period } of dates) {
      if (
        !shouldIncludeComplianceOccurrence(
          dueDate,
          period,
          tpl.periodicity as string,
          anchorYmd,
        )
      ) {
        continue;
      }

      const k = complianceTaskDedupeKey(tpl.id, dueDate || null, period);
      if (existingKeys.has(k)) continue;
      existingKeys.add(k);

      let priority = "media";
      if (dueDate) {
        const daysUntil = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000);
        if (daysUntil <= 7) priority = "urgente";
        else if (daysUntil <= 30) priority = "alta";
      }

      const baseDesc = ((tpl.description as string | null) || "").trim();
      const description = [baseDesc, taskContextSuffix].filter(Boolean).join("") || null;

      tasksToInsert.push({
        title: tpl.task_name,
        description,
        area: "cumplimiento",
        priority,
        status: "pendiente",
        due_date: dueDate || null,
        assigned_to: responsibleUserId,
        project_id: projectId,
        organization_id: organizationId,
        created_by: userId,
        compliance_template_id: tpl.id,
        compliance_periodicity: tpl.periodicity,
        compliance_period: period,
        client_id: clientId,
      });
    }
  }

  let inserted = 0;
  for (let i = 0; i < tasksToInsert.length; i += 100) {
    const batch = tasksToInsert.slice(i, i + 100);
    if (batch.length === 0) continue;
    const { error } = await supabase.from("tasks").insert(batch as any);
    if (error) {
      console.error("[ensureComplianceProjectForClient] insert tasks batch failed", error);
      throw error;
    }
    inserted += batch.length;
  }

  return inserted;
}

/**
 * Garantiza servicio + proyecto de cumplimiento, sincroniza descripción del proyecto y,
 * si se pasan `entityTypeIds`, genera tareas desde plantillas (deduplicado por cliente/plantilla/fecha/periodo).
 */
export async function ensureComplianceProjectForClient(params: {
  clientId: string;
  userId: string;
  entityTypeIds?: string[];
}): Promise<{ projectId: string; tasksCreated: number }> {
  const { clientId, userId, entityTypeIds } = params;

  const { data: orgId, error: orgErr } = await supabase.rpc("get_user_org_id", {
    _user_id: userId,
  });
  if (orgErr) throw orgErr;

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, name, services, responsible_user_id")
    .eq("id", clientId)
    .single();

  if (clientErr) throw clientErr;
  if (!client) throw new Error("Cliente no encontrado");

  const services = (client.services || []) as string[];
  if (!services.includes("cumplimiento")) {
    const next = [...services, "cumplimiento"] as ServiceArea[];
    const { error: updErr } = await supabase
      .from("clients")
      .update({ services: next })
      .eq("id", clientId);
    if (updErr) throw updErr;
  }

  const { data: existing, error: existErr } = await supabase
    .from("projects")
    .select("id")
    .eq("client_id", clientId)
    .eq("area", "cumplimiento")
    .neq("status", "cancelado")
    .limit(1);

  if (existErr) throw existErr;

  if (!existing?.length) {
    const { error: insErr } = await supabase.from("projects").insert({
      name: `Cumplimiento — ${client.name}`,
      client_id: clientId,
      area: "cumplimiento",
      organization_id: orgId!,
      created_by: userId,
      responsible_user_id: client.responsible_user_id || userId,
      tax_obligations: [],
    } as any);

    if (insErr) {
      console.error("[ensureComplianceProjectForClient] insert project failed", insErr);
      throw insErr;
    }
  }

  await syncComplianceProjectDescription(clientId);

  const { data: projRow, error: projErr } = await supabase
    .from("projects")
    .select("id")
    .eq("client_id", clientId)
    .eq("area", "cumplimiento")
    .neq("status", "cancelado")
    .limit(1)
    .maybeSingle();

  if (projErr) throw projErr;
  const projectId = projRow?.id;
  if (!projectId) throw new Error("No se encontró el proyecto de cumplimiento tras crearlo o sincronizarlo.");

  let tasksCreated = 0;
  if (entityTypeIds && entityTypeIds.length > 0) {
    tasksCreated = await syncComplianceTasksForTemplates({
      clientId,
      userId,
      projectId,
      organizationId: orgId!,
      entityTypeIds,
      responsibleUserId: client.responsible_user_id || userId,
    });
  }

  return { projectId, tasksCreated };
}
