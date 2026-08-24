import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { pipelineQueryKeys } from "@/hooks/usePipeline";

/**
 * Partners / convenios del pipeline y sus comisiones.
 *
 * Las tablas son nuevas (migración 20260824190000) y todavía no están en los
 * tipos generados de Supabase, por eso los `as never` en `.from(...)`.
 */

export interface PipelinePartner {
  id: string;
  organization_id: string;
  name: string;
  kind: string;
  status: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  website: string | null;
  country: string | null;
  commission_type: string;
  commission_value: number | null;
  commission_base: string;
  commission_currency: string;
  payment_terms: string | null;
  agreement_start: string | null;
  agreement_end: string | null;
  agreement_notes: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PartnerCommission {
  id: string;
  organization_id: string;
  partner_id: string;
  lead_id: string;
  commission_type: string;
  commission_value: number | null;
  commission_base: string;
  base_amount: number | null;
  amount: number | null;
  currency: string;
  status: string;
  accrued_at: string;
  paid_at: string | null;
  notes: string | null;
}

/** Lead referido, con lo mínimo para listarlo bajo su partner. */
export interface ReferredLead {
  id: string;
  full_name: string;
  company_name: string | null;
  email: string | null;
  stage_id: string;
  estimated_value: number | null;
  partner_id: string;
  is_active: boolean;
  created_at: string;
}

export const partnerQueryKeys = {
  partners: ["pipeline-partners"] as const,
  commissions: ["partner-commissions"] as const,
  referredLeads: ["partner-referred-leads"] as const,
};

export function usePipelinePartners() {
  return useQuery({
    queryKey: partnerQueryKeys.partners,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pipeline_partners" as never)
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as PipelinePartner[];
    },
  });
}

export function usePartnerCommissions() {
  return useQuery({
    queryKey: partnerQueryKeys.commissions,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("partner_commissions" as never)
        .select("*")
        .order("accrued_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as PartnerCommission[];
    },
  });
}

/** Todos los leads con partner asignado (incluye inactivos para el histórico). */
export function useReferredLeads() {
  return useQuery({
    queryKey: partnerQueryKeys.referredLeads,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("id, full_name, company_name, email, stage_id, estimated_value, partner_id, is_active, created_at")
        .not("partner_id", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ReferredLead[];
    },
  });
}

export function useCreatePartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: Partial<PipelinePartner>) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sesión no válida");
      const { data: orgId, error: orgErr } = await supabase.rpc("get_user_org_id", {
        _user_id: u.user.id,
      });
      if (orgErr) throw orgErr;
      if (!orgId) throw new Error("No se encontró la organización del usuario");

      const { data, error } = await supabase
        .from("pipeline_partners" as never)
        .insert({ ...row, organization_id: orgId, created_by: u.user.id } as never)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as PipelinePartner;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerQueryKeys.partners });
    },
  });
}

export function useUpdatePartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Partial<PipelinePartner>) => {
      const { data, error } = await supabase
        .from("pipeline_partners" as never)
        .update(patch as never)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as PipelinePartner;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerQueryKeys.partners });
    },
  });
}

export function useDeletePartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pipeline_partners" as never).delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerQueryKeys.partners });
      qc.invalidateQueries({ queryKey: partnerQueryKeys.referredLeads });
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.leads });
    },
  });
}

/** Cambia estatus / monto / notas de una comisión devengada. */
export function useUpdateCommission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: { id: string; status?: string; amount?: number | null; notes?: string | null; paid_at?: string | null }) => {
      const { data, error } = await supabase
        .from("partner_commissions" as never)
        .update(patch as never)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as PartnerCommission;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: partnerQueryKeys.commissions });
    },
  });
}
