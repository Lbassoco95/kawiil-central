import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type PipelineStage = Tables<"pipeline_stages">;
export type Lead = Tables<"leads">;

export const pipelineQueryKeys = {
  stages: ["pipeline-stages"] as const,
  leads: ["pipeline-leads"] as const,
  lead: (id: string) => ["pipeline-lead", id] as const,
  activities: (leadId: string) => ["pipeline-activities", leadId] as const,
  activitiesFeed: (limit: number) => ["pipeline-activities-feed", limit] as const,
  emailLog: (leadId: string) => ["pipeline-email-log", leadId] as const,
  templates: ["pipeline-email-templates"] as const,
  templateUsage: ["pipeline-template-usage"] as const,
  sequences: ["pipeline-email-sequences"] as const,
  sequenceSteps: (sequenceId: string) => ["pipeline-sequence-steps", sequenceId] as const,
  stats: (from?: string, to?: string) => ["pipeline-stats", from, to] as const,
  tasks: (leadId: string) => ["pipeline-tasks", leadId] as const,
  allTasks: ["pipeline-all-tasks"] as const,
  automations: ["pipeline-automations"] as const,
};

export function usePipelineStages() {
  return useQuery({
    queryKey: pipelineQueryKeys.stages,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("*")
        .order("position", { ascending: true });
      if (error) throw error;
      return data as PipelineStage[];
    },
  });
}

export function usePipelineLeads(activeOnly = true) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: [...pipelineQueryKeys.leads, activeOnly],
    queryFn: async () => {
      let qb = supabase.from("leads").select("*").order("updated_at", { ascending: false });
      if (activeOnly) qb = qb.eq("is_active", true);
      const { data, error } = await qb;
      if (error) throw error;
      return data as Lead[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("pipeline-leads-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads" },
        () => {
          qc.invalidateQueries({ queryKey: pipelineQueryKeys.leads });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  return q;
}

export function useMoveLeadStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, newStageId }: { leadId: string; newStageId: string }) => {
      const { data, error } = await supabase.rpc("move_lead_stage", {
        p_lead_id: leadId,
        p_new_stage_id: newStageId,
      });
      if (error) throw error;
      const j = data as { ok?: boolean; error?: string };
      if (!j?.ok) throw new Error(j?.error || "move_lead_stage failed");
      return j;
    },
    onSuccess: (_data, variables) => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.leads });
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.lead(variables.leadId) });
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.activities(variables.leadId) });
    },
  });
}

export function useAssignLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ leadId, ownerId }: { leadId: string; ownerId: string | null }) => {
      const { data, error } = await supabase.rpc("assign_lead", {
        p_lead_id: leadId,
        p_owner_id: ownerId,
      });
      if (error) throw error;
      const j = data as { ok?: boolean; error?: string };
      if (!j?.ok) throw new Error(j?.error || "assign_lead failed");
      return j;
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.leads });
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.lead(v.leadId) });
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.activities(v.leadId) });
    },
  });
}

export function useLeadDetail(leadId: string | undefined) {
  return useQuery({
    queryKey: pipelineQueryKeys.lead(leadId || ""),
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase.from("leads").select("*").eq("id", leadId!).single();
      if (error) throw error;
      return data as Lead;
    },
  });
}

export function useLeadActivities(leadId: string | undefined) {
  return useQuery({
    queryKey: pipelineQueryKeys.activities(leadId || ""),
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_activities")
        .select("*")
        .eq("lead_id", leadId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
}

export function useLeadEmailLog(leadId: string | undefined) {
  return useQuery({
    queryKey: pipelineQueryKeys.emailLog(leadId || ""),
    enabled: !!leadId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("email_log").select("*").eq("lead_id", leadId!);
      if (error) throw error;
      return [...(data ?? [])].sort((a, b) => {
        const ta = new Date(a.sent_at ?? a.received_at ?? a.created_at).getTime();
        const tb = new Date(b.sent_at ?? b.received_at ?? b.created_at).getTime();
        return tb - ta;
      }) as Tables<"email_log">[];
    },
  });
}

export function useSyncInboxEmails() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("sync-inbox-emails", { body: {} });
      if (error) throw error;
      return data as { ok?: boolean; synced?: number; error?: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.leads });
      qc.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "pipeline-email-log",
      });
      qc.invalidateQueries({
        predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "pipeline-activities",
      });
    },
  });
}

/**
 * Busca en el buzón (bandeja + enviados) los correos del prospecto y los migra
 * al lead, para retomar el seguimiento de conversaciones que ya existían fuera
 * del pipeline.
 */
export function useImportLeadEmails() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { leadId: string; email?: string | null }) => {
      const { data, error } = await supabase.functions.invoke("import-lead-emails", {
        body: { lead_id: vars.leadId, email: vars.email || undefined },
      });
      if (error) throw error;
      const res = data as {
        ok?: boolean;
        imported?: number;
        skipped?: number;
        examined?: number;
        error?: string;
      };
      if (res?.error) throw new Error(res.error);
      return res;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.emailLog(v.leadId) });
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.activities(v.leadId) });
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.lead(v.leadId) });
    },
  });
}

export function useEmailTemplates() {
  return useQuery({
    queryKey: pipelineQueryKeys.templates,
    queryFn: async () => {
      const { data, error } = await supabase.from("email_templates").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useEmailSequences() {
  return useQuery({
    queryKey: pipelineQueryKeys.sequences,
    queryFn: async () => {
      const { data, error } = await supabase.from("email_sequences").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function usePipelineStats(dateFrom?: string | null, dateTo?: string | null) {
  return useQuery({
    queryKey: pipelineQueryKeys.stats(dateFrom ?? undefined, dateTo ?? undefined),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_pipeline_stats", {
        p_date_from: dateFrom ?? null,
        p_date_to: dateTo ?? null,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string } & Partial<Tables<"leads">>) => {
      const { id, ...rest } = payload;
      const { data, error } = await supabase.from("leads").update(rest).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.leads });
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.lead(v.id) });
    },
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: Tables<"leads">["Insert"]) => {
      const { data, error } = await supabase.from("leads").insert(row).select().single();
      if (error) throw error;
      return data as Lead;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.leads });
    },
  });
}

// --- Lead Tasks ---

export interface LeadTask {
  id: string;
  lead_id: string;
  assigned_to: string | null;
  created_by: string | null;
  title: string;
  description: string | null;
  task_type: string;
  due_date: string;
  completed_at: string | null;
  is_completed: boolean;
  priority: string;
  result: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  leads?: {
    full_name: string;
    email: string | null;
    phone: string | null;
    stage_id: string;
    pipeline_stages?: { name: string; color: string } | null;
  } | null;
}

export function useLeadTasks(leadId: string | undefined) {
  return useQuery({
    queryKey: pipelineQueryKeys.tasks(leadId || ""),
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_tasks" as never)
        .select("*")
        .eq("lead_id", leadId!)
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as LeadTask[];
    },
  });
}

export function useAllTasks(filter: "overdue" | "today" | "upcoming" | "all" = "all") {
  return useQuery({
    queryKey: [...pipelineQueryKeys.allTasks, filter],
    queryFn: async () => {
      const now = new Date();
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(now);
      todayEnd.setHours(23, 59, 59, 999);
      const next7 = new Date(now);
      next7.setDate(next7.getDate() + 7);

      let qb = supabase
        .from("lead_tasks" as never)
        .select("*, leads(full_name, email, phone, stage_id, pipeline_stages(name, color))")
        .eq("is_completed", false)
        .order("due_date", { ascending: true });

      if (filter === "overdue") {
        qb = qb.lt("due_date", now.toISOString());
      } else if (filter === "today") {
        qb = qb.gte("due_date", todayStart.toISOString()).lte("due_date", todayEnd.toISOString());
      } else if (filter === "upcoming") {
        qb = qb.gt("due_date", todayEnd.toISOString()).lte("due_date", next7.toISOString());
      }

      const { data, error } = await qb;
      if (error) throw error;
      return (data || []) as unknown as LeadTask[];
    },
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, leadId }: { taskId: string; leadId: string }) => {
      const { error } = await supabase
        .from("lead_tasks" as never)
        .update({ is_completed: true, completed_at: new Date().toISOString() } as never)
        .eq("id", taskId);
      if (error) throw error;
      return { taskId, leadId };
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.tasks(v.leadId) });
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.allTasks });
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.activities(v.leadId) });
    },
  });
}

export function useRescheduleTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ taskId, leadId, newDate }: { taskId: string; leadId: string; newDate: string }) => {
      const { error } = await supabase
        .from("lead_tasks" as never)
        .update({ due_date: newDate } as never)
        .eq("id", taskId);
      if (error) throw error;
      return { taskId, leadId };
    },
    onSuccess: (_, v) => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.tasks(v.leadId) });
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.allTasks });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// v2.5 · Pipeline vision alignment
// ─────────────────────────────────────────────────────────────────────────────

export interface LeadActivityFeedItem {
  id: string;
  lead_id: string;
  type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
  lead?: { full_name: string | null } | null;
}

/**
 * Feed org-wide de actividades recientes del pipeline.
 */
export function useLeadActivitiesFeed(limit = 10) {
  return useQuery({
    queryKey: pipelineQueryKeys.activitiesFeed(limit),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_activities")
        .select("id, lead_id, type, metadata, created_at, leads(full_name)")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      type Row = {
        id: string;
        lead_id: string;
        type: string;
        metadata: Record<string, unknown> | null;
        created_at: string;
        leads: { full_name: string | null } | { full_name: string | null }[] | null;
      };
      return ((data || []) as Row[]).map((r) => ({
        id: r.id,
        lead_id: r.lead_id,
        type: r.type,
        metadata: r.metadata,
        created_at: r.created_at,
        lead: Array.isArray(r.leads) ? r.leads[0] ?? null : r.leads,
      })) satisfies LeadActivityFeedItem[];
    },
  });
}

export interface StageAggregate {
  count: number;
  sumMxn: number;
}

/**
 * Agrega leads por stage_id → { count, sumMxn } usando los datos en memoria.
 * No hace query extra; úsalo junto a usePipelineLeads().
 */
export function aggregateStageValues(leads: Lead[]): Map<string, StageAggregate> {
  const m = new Map<string, StageAggregate>();
  for (const l of leads) {
    const bucket = m.get(l.stage_id) ?? { count: 0, sumMxn: 0 };
    bucket.count += 1;
    const v = (l as Lead & { estimated_value?: number | null }).estimated_value;
    if (v && !Number.isNaN(Number(v))) bucket.sumMxn += Number(v);
    m.set(l.stage_id, bucket);
  }
  return m;
}

/**
 * Hook de conveniencia: devuelve Map<stage_id, { count, sumMxn }> derivado de usePipelineLeads.
 */
export function usePipelineStageValues(activeOnly = true) {
  const { data: leads = [] } = usePipelineLeads(activeOnly);
  return aggregateStageValues(leads);
}

export type PipelineAutomationKey =
  | "auto_cool_down_14d"
  | "auto_advance_on_reply"
  | "auto_score_boost_on_open";

export interface PipelineAutomationRow {
  id: string;
  organization_id: string;
  key: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
}

export function usePipelineAutomations() {
  return useQuery({
    queryKey: pipelineQueryKeys.automations,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_automations")
        .select("id, organization_id, key, enabled, config")
        .order("key", { ascending: true });
      if (error) throw error;
      return (data || []) as PipelineAutomationRow[];
    },
  });
}

export function useUpdatePipelineAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase
        .from("pipeline_automations")
        .update({ enabled })
        .eq("id", id);
      if (error) throw error;
      return { id, enabled };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pipelineQueryKeys.automations });
    },
  });
}

/**
 * Conteo de uso por plantilla (count en email_log por template_id).
 * Devuelve Map<template_id, count>.
 */
export function useTemplateUsage() {
  return useQuery({
    queryKey: pipelineQueryKeys.templateUsage,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_log")
        .select("template_id");
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of (data || []) as Array<{ template_id: string | null }>) {
        if (!row.template_id) continue;
        map.set(row.template_id, (map.get(row.template_id) ?? 0) + 1);
      }
      return map;
    },
  });
}

/**
 * Descarga un CSV de leads filtrados en memoria. Client-side, sin RPC.
 */
export function downloadLeadsCsv(
  leads: Lead[],
  stageNameById: (id: string) => string,
): void {
  const headers = [
    "Nombre",
    "Empresa",
    "Email",
    "Telefono",
    "Pais",
    "Etapa",
    "Score",
    "Prioridad",
    "Monto MXN",
    "Campana",
    "Creado",
    "Ultima actividad",
  ];
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const rows = leads.map((l) => {
    const any = l as Lead & { estimated_value?: number | null; last_activity_at?: string | null };
    return [
      l.full_name,
      l.company_name ?? "",
      l.email ?? "",
      l.phone ?? "",
      l.country_name ?? l.country_code ?? "",
      stageNameById(l.stage_id),
      l.score ?? 0,
      l.priority,
      any.estimated_value ?? "",
      l.campaign_name ?? "",
      l.created_at,
      any.last_activity_at ?? "",
    ].map(escape).join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
