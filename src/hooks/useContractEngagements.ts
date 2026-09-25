import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type {
  ContractAnswers,
  ContractEngagement,
  ContractPackageItem,
  ContractPackageKind,
  ContractTemplate,
  ContractTemplateField,
  PricingCatalogRow,
} from "@/types/contracts";
import {
  BACKOFFICE_PLANS_FALLBACK,
  computeNetPrice,
  discountLabel,
} from "@/lib/contractPricingCatalog";
import {
  buildTokenMapFromAnswers,
  formatMoneyMx,
  mergeTokens,
} from "@/lib/contractMerge";

export const contractQueryKeys = {
  byLead: (leadId: string) => ["contract-engagements", "lead", leadId] as const,
  engagement: (id: string) => ["contract-engagement", id] as const,
  catalog: (kind: ContractPackageKind) => ["pricing-catalog", kind] as const,
  items: (engagementId: string) => ["contract-items", engagementId] as const,
  template: (engagementId: string) => ["contract-template", engagementId] as const,
};

type RpcJson = Record<string, unknown>;

function asEngagement(row: Record<string, unknown>): ContractEngagement {
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    lead_id: (row.lead_id as string) || null,
    client_id: (row.client_id as string) || null,
    origin: (row.origin as ContractEngagement["origin"]) || "onboarding",
    package_kind: row.package_kind as ContractPackageKind,
    status: row.status as ContractEngagement["status"],
    service_types: Array.isArray(row.service_types) ? (row.service_types as string[]) : [],
    answers: (row.answers as ContractAnswers) || {},
    answers_updated_at: (row.answers_updated_at as string) || null,
    answers_updated_by_role: (row.answers_updated_by_role as string) || null,
    current_version_id: (row.current_version_id as string) || null,
    client_access_token_hint: (row.client_access_token_hint as string) || null,
    client_access_expires_at: (row.client_access_expires_at as string) || null,
    document_ready_at: (row.document_ready_at as string) || null,
    signed_confirmed_at: (row.signed_confirmed_at as string) || null,
    signed_file_document_id: (row.signed_file_document_id as string) || null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function useLeadContractEngagements(leadId: string | undefined) {
  return useQuery({
    queryKey: contractQueryKeys.byLead(leadId || ""),
    enabled: !!leadId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contract_engagements" as never)
        .select("*")
        .eq("lead_id", leadId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return ((data || []) as unknown as Record<string, unknown>[]).map(asEngagement);
    },
    refetchInterval: 4000,
  });
}

export function usePricingCatalog(kind: ContractPackageKind) {
  return useQuery({
    queryKey: contractQueryKeys.catalog(kind),
    queryFn: async (): Promise<PricingCatalogRow[]> => {
      const { data, error } = await supabase
        .from("pricing_catalog" as never)
        .select("*")
        .eq("package_kind", kind)
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) {
        // Fallback local si la migración aún no está aplicada
        if (kind === "backoffice_pm") {
          return BACKOFFICE_PLANS_FALLBACK.map((p, i) => ({
            id: `fallback-${p.plan_code}`,
            organization_id: null,
            package_kind: kind,
            plan_code: p.plan_code,
            plan_name: p.plan_name,
            list_price: p.list_price,
            currency: p.currency,
            vat_included: p.vat_included,
            max_operations: p.max_operations,
            metadata: {},
            is_active: true,
            sort_order: (i + 1) * 10,
          }));
        }
        throw error;
      }
      const rows = (data || []) as unknown as PricingCatalogRow[];
      if (rows.length === 0 && kind === "backoffice_pm") {
        return BACKOFFICE_PLANS_FALLBACK.map((p, i) => ({
          id: `fallback-${p.plan_code}`,
          organization_id: null,
          package_kind: kind,
          plan_code: p.plan_code,
          plan_name: p.plan_name,
          list_price: p.list_price,
          currency: p.currency,
          vat_included: p.vat_included,
          max_operations: p.max_operations,
          metadata: {},
          is_active: true,
          sort_order: (i + 1) * 10,
        }));
      }
      return rows;
    },
  });
}

export function useContractPackageItems(engagementId: string | undefined) {
  return useQuery({
    queryKey: contractQueryKeys.items(engagementId || ""),
    enabled: !!engagementId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("contract_package_items" as never)
        .select("*")
        .eq("engagement_id", engagementId!)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as unknown as ContractPackageItem[];
    },
  });
}

export function useActiveContractTemplate(engagementId: string | undefined) {
  return useQuery({
    queryKey: contractQueryKeys.template(engagementId || ""),
    enabled: !!engagementId,
    queryFn: async () => {
      const { data: items, error: iErr } = await supabase
        .from("contract_package_items" as never)
        .select("template_id, sort_order, status")
        .eq("engagement_id", engagementId!)
        .not("template_id", "is", null)
        .order("sort_order", { ascending: true });
      if (iErr) throw iErr;
      const first = (items as unknown as { template_id: string }[])?.[0];
      if (!first?.template_id) return { template: null as ContractTemplate | null, fields: [] as ContractTemplateField[] };

      const { data: tpl, error: tErr } = await supabase
        .from("contract_templates" as never)
        .select("id, name, body_html, template_key, package_kind")
        .eq("id", first.template_id)
        .maybeSingle();
      if (tErr) throw tErr;

      const { data: fields, error: fErr } = await supabase
        .from("contract_template_fields" as never)
        .select("*")
        .eq("template_id", first.template_id)
        .order("sort_order", { ascending: true });
      if (fErr) throw fErr;

      return {
        template: tpl as unknown as ContractTemplate,
        fields: (fields || []) as unknown as ContractTemplateField[],
      };
    },
  });
}

export function useStartContractEngagement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { leadId: string; packageKind: ContractPackageKind }) => {
      const { data, error } = await supabase.rpc("start_contract_engagement" as never, {
        p_lead_id: input.leadId,
        p_package_kind: input.packageKind,
      } as never);
      if (error) throw error;
      const j = data as RpcJson;
      if (!j?.ok) {
        const err = String(j?.error || "No se pudo iniciar el onboarding");
        if (err === "lead_not_converted") {
          const stageName = j.stage_name ? String(j.stage_name) : j.stage ? String(j.stage) : null;
          throw new Error(
            stageName
              ? `lead_not_converted: el lead está en «${stageName}»; muévelo a Cerrado (etapa ganada).`
              : "lead_not_converted",
          );
        }
        throw new Error(err);
      }
      return j as {
        ok: true;
        engagement_id: string;
        access_token: string;
        package_kind: ContractPackageKind;
        reused?: boolean;
        expires_at?: string;
      };
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: contractQueryKeys.byLead(vars.leadId) });
    },
  });
}

export function useStaffPatchAnswers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { engagementId: string; answers: ContractAnswers; leadId?: string }) => {
      const { data, error } = await supabase.rpc("contract_staff_patch_answers" as never, {
        p_engagement_id: input.engagementId,
        p_answers: input.answers,
      } as never);
      if (error) throw error;
      const j = data as RpcJson;
      if (!j?.ok) throw new Error(String(j?.error || "No se pudo guardar"));
      return j;
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: contractQueryKeys.byLead(vars.leadId || "") });
      void qc.invalidateQueries({ queryKey: contractQueryKeys.engagement(vars.engagementId) });
    },
  });
}

export function useGenerateContractVersion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      engagementId: string;
      leadId?: string;
      answers: ContractAnswers;
      bodyHtml: string;
      fields: ContractTemplateField[];
      itemKey?: string;
    }) => {
      const tokenMap = buildTokenMapFromAnswers(input.answers, input.fields);
      // Formatear montos legibles
      if (tokenMap.net_price != null) tokenMap["MONTO"] = formatMoneyMx(tokenMap.net_price as number);
      if (tokenMap.list_price != null) tokenMap["MONTO LISTA"] = formatMoneyMx(tokenMap.list_price as number);
      const merged = mergeTokens(input.bodyHtml, tokenMap);

      const { data, error } = await supabase.rpc("contract_generate_version" as never, {
        p_engagement_id: input.engagementId,
        p_item_key: input.itemKey ?? null,
        p_merged_html: merged,
        p_field_values: input.answers,
      } as never);
      if (error) throw error;
      const j = data as RpcJson;
      if (!j?.ok) throw new Error(String(j?.error || "No se pudo generar"));
      return { ...j, merged_html: merged };
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: contractQueryKeys.byLead(vars.leadId || "") });
      void qc.invalidateQueries({ queryKey: contractQueryKeys.items(vars.engagementId) });
    },
  });
}

export function useConfirmContractSigned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { engagementId: string; leadId?: string }) => {
      const { data, error } = await supabase.rpc("confirm_contract_signed" as never, {
        p_engagement_id: input.engagementId,
        p_signed_file_document_id: null,
      } as never);
      if (error) throw error;
      const j = data as RpcJson;
      if (!j?.ok) throw new Error(String(j?.error || "No se pudo confirmar"));
      return j as { ok: true; client_id: string; projects: unknown[]; already?: boolean };
    },
    onSuccess: (_d, vars) => {
      void qc.invalidateQueries({ queryKey: contractQueryKeys.byLead(vars.leadId || "") });
      void qc.invalidateQueries({ queryKey: ["clients"] });
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useRotateAccessToken() {
  return useMutation({
    mutationFn: async (engagementId: string) => {
      const { data, error } = await supabase.rpc("contract_rotate_access_token" as never, {
        p_engagement_id: engagementId,
      } as never);
      if (error) throw error;
      const j = data as RpcJson;
      if (!j?.ok) throw new Error(String(j?.error || "No se pudo generar link"));
      return j as { ok: true; access_token: string; expires_at: string };
    },
  });
}

/** Acceso público (anon) por token. */
export async function fetchContractByToken(token: string) {
  const { data, error } = await supabase.rpc("contract_client_get" as never, {
    p_token: token,
  } as never);
  if (error) throw error;
  return data as RpcJson;
}

export async function patchContractByToken(token: string, answers: ContractAnswers, role: "client" | "staff" = "client") {
  const { data, error } = await supabase.rpc("contract_client_patch" as never, {
    p_token: token,
    p_answers: answers,
    p_role: role,
  } as never);
  if (error) throw error;
  const j = data as RpcJson;
  if (!j?.ok) throw new Error(String(j?.error || "No se pudo guardar"));
  return j;
}

export function enrichBillingAnswers(
  answers: ContractAnswers,
  plan: { plan_code: string; plan_name: string; list_price: number } | null,
  discountAmount: number,
  overrideNet?: number | null,
): ContractAnswers {
  if (!plan) return answers;
  const net = computeNetPrice(plan.list_price, discountAmount, overrideNet);
  return {
    ...answers,
    plan_id: plan.plan_code,
    plan_name: plan.plan_name,
    list_price: plan.list_price,
    discount_amount: discountAmount,
    net_price: net,
    discount_label: discountLabel(plan.list_price, discountAmount, net),
    currency: "MXN",
    vat_included: false,
  };
}

export function publicContractUrl(token: string): string {
  if (typeof window === "undefined") return `/contrato/${token}`;
  return `${window.location.origin}/contrato/${token}`;
}
