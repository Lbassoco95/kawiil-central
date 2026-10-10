import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Empresas del grupo (Yoltik, Tonatiuh, Ixim, …). Cuando el despacho paga por
 * cuenta de una de ellas, esa empresa nos debe: es una cuenta por cobrar
 * intercompañía. Catálogo configurable por Finanzas.
 */
export interface GroupCompany {
  id: string;
  organization_id: string;
  name: string;
  rfc: string | null;
  notes: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useGroupCompanies(includeInactive = false) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["group-companies", includeInactive],
    queryFn: async (): Promise<GroupCompany[]> => {
      let q = (supabase as any)
        .from("group_companies")
        .select("*")
        .order("name", { ascending: true });
      if (!includeInactive) q = q.eq("is_active", true);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as GroupCompany[];
    },
    enabled: !!user,
  });
}

async function currentOrgId(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .single();
  if (error || !data?.organization_id) throw new Error("No se encontró la organización del usuario");
  return data.organization_id as string;
}

export function useCreateGroupCompany() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (params: { name: string; rfc?: string | null; notes?: string | null }) => {
      const organization_id = await currentOrgId(user!.id);
      const { data, error } = await (supabase as any)
        .from("group_companies")
        .insert({
          organization_id,
          name: params.name.trim(),
          rfc: params.rfc?.trim() || null,
          notes: params.notes?.trim() || null,
          created_by: user!.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as GroupCompany;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group-companies"] });
      toast.success("Empresa del grupo agregada");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo agregar la empresa"),
  });
}

export function useUpdateGroupCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      id: string;
      name?: string;
      rfc?: string | null;
      notes?: string | null;
      is_active?: boolean;
    }) => {
      const { id, ...rest } = params;
      const updates: Record<string, unknown> = {};
      if (rest.name !== undefined) updates.name = rest.name.trim();
      if (rest.rfc !== undefined) updates.rfc = rest.rfc?.trim() || null;
      if (rest.notes !== undefined) updates.notes = rest.notes?.trim() || null;
      if (rest.is_active !== undefined) updates.is_active = rest.is_active;
      const { error } = await (supabase as any).from("group_companies").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["group-companies"] });
      toast.success("Empresa actualizada");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar"),
  });
}
