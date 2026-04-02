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
  emailLog: (leadId: string) => ["pipeline-email-log", leadId] as const,
  templates: ["pipeline-email-templates"] as const,
  sequences: ["pipeline-email-sequences"] as const,
  stats: (from?: string, to?: string) => ["pipeline-stats", from, to] as const,
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.leads });
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
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_log")
        .select("*")
        .eq("lead_id", leadId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
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
