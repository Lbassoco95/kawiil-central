import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

// ─── Células (antes Áreas) ───
export interface Celula {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  color: string | null;
  responsible_user_id: string | null;
  is_active: boolean;
  organization_id: string;
  created_at: string;
}

/** @deprecated Use Celula instead */
export type Area = Celula;

export function useCelulas() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["celulas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("celulas" as any).select("*").order("name");
      if (error) throw error;
      return data as unknown as Celula[];
    },
    enabled: !!user,
  });
}

/** @deprecated Use useCelulas instead */
export const useAreas = useCelulas;

export function useUpsertCelula() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (celula: Partial<Celula> & { name: string; slug: string }) => {
      const orgId = await getOrgId(user!.id);
      const payload = { ...celula, organization_id: orgId };
      if (celula.id) {
        const { error } = await supabase.from("celulas" as any).update(payload).eq("id", celula.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("celulas" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["celulas"] }); toast.success("Célula guardada"); },
    onError: (e) => toast.error(e.message),
  });
}

/** @deprecated Use useUpsertCelula instead */
export const useUpsertArea = useUpsertCelula;

// ─── Document Types ───
export interface DocumentType {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  organization_id: string;
}

export function useDocumentTypes() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["document-types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("document_types" as any).select("*").order("name");
      if (error) throw error;
      return data as unknown as DocumentType[];
    },
    enabled: !!user,
  });
}

export function useUpsertDocumentType() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (dt: Partial<DocumentType> & { name: string }) => {
      const orgId = await getOrgId(user!.id);
      const payload = { ...dt, organization_id: orgId };
      if (dt.id) {
        const { error } = await supabase.from("document_types" as any).update(payload).eq("id", dt.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("document_types" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["document-types"] }); toast.success("Tipo de documento guardado"); },
    onError: (e) => toast.error(e.message),
  });
}

// ─── Tags ───
export interface CatalogTag {
  id: string;
  name: string;
  color: string | null;
  is_active: boolean;
  organization_id: string;
}

export function useCatalogTags() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["catalog-tags"],
    queryFn: async () => {
      const { data, error } = await supabase.from("catalog_tags" as any).select("*").order("name");
      if (error) throw error;
      return data as unknown as CatalogTag[];
    },
    enabled: !!user,
  });
}

export function useUpsertCatalogTag() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (tag: Partial<CatalogTag> & { name: string }) => {
      const orgId = await getOrgId(user!.id);
      const payload = { ...tag, organization_id: orgId };
      if (tag.id) {
        const { error } = await supabase.from("catalog_tags" as any).update(payload).eq("id", tag.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("catalog_tags" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-tags"] }); toast.success("Etiqueta guardada"); },
    onError: (e) => toast.error(e.message),
  });
}

// ─── Tax Obligations ───
export interface TaxObligationType {
  id: string;
  name: string;
  description: string | null;
  frequency: string | null;
  is_active: boolean;
  organization_id: string;
}

export function useTaxObligationTypes() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["tax-obligation-types"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tax_obligation_types" as any).select("*").order("name");
      if (error) throw error;
      return data as unknown as TaxObligationType[];
    },
    enabled: !!user,
  });
}

export function useUpsertTaxObligation() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (ob: Partial<TaxObligationType> & { name: string }) => {
      const orgId = await getOrgId(user!.id);
      const payload = { ...ob, organization_id: orgId };
      if (ob.id) {
        const { error } = await supabase.from("tax_obligation_types" as any).update(payload).eq("id", ob.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("tax_obligation_types" as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tax-obligation-types"] }); toast.success("Obligación fiscal guardada"); },
    onError: (e) => toast.error(e.message),
  });
}

// ─── Delete hooks ───
export function useDeleteCelula() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("celulas" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["celulas"] }); toast.success("Célula eliminada"); },
    onError: (e) => toast.error(e.message),
  });
}

/** @deprecated Use useDeleteCelula instead */
export const useDeleteArea = useDeleteCelula;

export function useDeleteDocumentType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("document_types" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["document-types"] }); toast.success("Tipo de documento eliminado"); },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteCatalogTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("catalog_tags" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["catalog-tags"] }); toast.success("Etiqueta eliminada"); },
    onError: (e) => toast.error(e.message),
  });
}

export function useDeleteTaxObligation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tax_obligation_types" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tax-obligation-types"] }); toast.success("Obligación fiscal eliminada"); },
    onError: (e) => toast.error(e.message),
  });
}

// Helper
async function getOrgId(userId: string): Promise<string> {
  const { data } = await supabase.rpc("get_user_org_id", { _user_id: userId });
  if (!data) throw new Error("No se pudo determinar la organización");
  return data;
}
