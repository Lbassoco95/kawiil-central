import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export const accountingEmailTemplatesKey = ["accounting_email_templates"] as const;

export type AccountingEmailTemplate = Tables<"email_templates">;

export function useAccountingEmailTemplates() {
  return useQuery({
    queryKey: accountingEmailTemplatesKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .eq("scope", "accounting")
        .eq("is_active", true)
        .order("name");
      if (error) {
        // Logueamos con contexto para diagnosticar reportes de "no aparece la opción".
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          console.warn("[useAccountingEmailTemplates] query failed", {
            user_id: user?.id ?? null,
            email: user?.email ?? null,
            error,
          });
        } catch (innerErr) {
          console.warn("[useAccountingEmailTemplates] query failed (no auth)", {
            error,
            innerErr,
          });
        }
        throw error;
      }
      if (!Array.isArray(data) || data.length === 0) {
        // Caso poco probable salvo borrado/desactivado masivo; lo dejamos
        // visible en DevTools para que un usuario afectado pueda reportar.
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          console.warn("[useAccountingEmailTemplates] empty result", {
            user_id: user?.id ?? null,
            email: user?.email ?? null,
          });
        } catch {
          // ignore
        }
      }
      return data ?? [];
    },
    // Mantener cache cálido entre aperturas del compose (~5 min stale, 30 min en memoria).
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: true,
  });
}

export function useCreateAccountingEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      payload: Omit<TablesInsert<"email_templates">, "organization_id" | "scope" | "created_by"> & {
        scope?: "accounting";
      },
    ) => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("No autenticado");
      const { data: orgRes, error: orgErr } = await supabase.rpc("get_user_org_id", {
        _user_id: u.user.id,
      });
      if (orgErr) throw orgErr;
      const orgId = orgRes as unknown as string;

      const insertRow: TablesInsert<"email_templates"> = {
        ...payload,
        organization_id: orgId,
        scope: "accounting",
        created_by: u.user.id,
      };

      const { data, error } = await supabase
        .from("email_templates")
        .insert(insertRow)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: accountingEmailTemplatesKey });
    },
  });
}

export function useUpdateAccountingEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { id: string } & TablesUpdate<"email_templates">) => {
      const { id, ...rest } = payload;
      const { data, error } = await supabase
        .from("email_templates")
        .update(rest)
        .eq("id", id)
        .eq("scope", "accounting")
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: accountingEmailTemplatesKey });
    },
  });
}

export function useDeleteAccountingEmailTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("email_templates")
        .update({ is_active: false })
        .eq("id", id)
        .eq("scope", "accounting");
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: accountingEmailTemplatesKey });
    },
  });
}
