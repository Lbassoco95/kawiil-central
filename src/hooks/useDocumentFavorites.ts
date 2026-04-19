import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const TABLE = "document_favorites" as const;

/**
 * Lista los IDs de documentos marcados como favoritos por el usuario actual.
 * Si la tabla no existe (migración no aplicada), devuelve `[]` sin romper la UI.
 */
export function useDocumentFavorites() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["document-favorites", user?.id ?? null],
    queryFn: async () => {
      if (!user) return new Set<string>();
      const { data, error } = await (supabase as any)
        .from(TABLE)
        .select("document_id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (error) {
        if (error.code === "42P01" || /relation .* does not exist/i.test(error.message)) {
          return new Set<string>();
        }
        throw error;
      }
      return new Set<string>((data ?? []).map((r: any) => r.document_id as string));
    },
    enabled: !!user,
    staleTime: 30_000,
  });
}

export function useToggleDocumentFavorite() {
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { documentId: string; isFavorite: boolean }) => {
      if (!user) throw new Error("Sin sesión");
      if (vars.isFavorite) {
        const { error } = await (supabase as any)
          .from(TABLE)
          .delete()
          .eq("user_id", user.id)
          .eq("document_id", vars.documentId);
        if (error) throw error;
        return { documentId: vars.documentId, nowFavorite: false } as const;
      }
      const { error } = await (supabase as any)
        .from(TABLE)
        .insert({ user_id: user.id, document_id: vars.documentId });
      if (error && error.code !== "23505") throw error;
      return { documentId: vars.documentId, nowFavorite: true } as const;
    },
    onSuccess: (res) => {
      qc.setQueryData<Set<string>>(["document-favorites", user?.id ?? null], (prev) => {
        const next = new Set(prev ?? []);
        if (res.nowFavorite) next.add(res.documentId);
        else next.delete(res.documentId);
        return next;
      });
    },
    onError: (err: any) => {
      const msg = String(err?.message ?? err ?? "");
      if (/relation .* does not exist/i.test(msg) || err?.code === "42P01") {
        toast.error(
          "La tabla document_favorites aún no existe. Aplica la migración 20260504120000_document_favorites.sql.",
        );
        return;
      }
      toast.error("No se pudo actualizar el favorito: " + msg);
    },
  });
}
