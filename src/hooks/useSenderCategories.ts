import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/** Categorías válidas (alineadas con las pestañas del correo). */
export type SenderCategory = "clientes" | "sat" | "facturas" | "interno" | "notificaciones";

export const SENDER_CATEGORY_LABEL: Record<SenderCategory, string> = {
  clientes: "Clientes",
  sat: "SAT",
  facturas: "Facturas",
  interno: "Interno",
  notificaciones: "Notificaciones",
};

/** Mapa remitente(lowercase) → categoría, compartido por toda la organización. */
export function useSenderCategories() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["sender-categories"],
    queryFn: async (): Promise<Map<string, SenderCategory>> => {
      const { data, error } = await (supabase as any)
        .from("email_sender_categories")
        .select("sender_email, category");
      if (error) throw error;
      const map = new Map<string, SenderCategory>();
      for (const row of data ?? []) {
        map.set(String(row.sender_email).toLowerCase(), row.category as SenderCategory);
      }
      return map;
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });
}

/** Confirma/actualiza la categoría de un remitente para toda la organización. */
export function useSetSenderCategory() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      senderEmail,
      category,
      senderName,
    }: {
      senderEmail: string;
      category: SenderCategory | null; // null = quitar la categoría
      senderName?: string;
    }) => {
      const addr = senderEmail.trim().toLowerCase();
      if (!addr) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (!profile?.organization_id) throw new Error("Sin organización");

      if (category === null) {
        const { error } = await (supabase as any)
          .from("email_sender_categories")
          .delete()
          .eq("organization_id", profile.organization_id)
          .eq("sender_email", addr);
        if (error) throw error;
        return;
      }
      const { error } = await (supabase as any)
        .from("email_sender_categories")
        .upsert(
          {
            organization_id: profile.organization_id,
            sender_email: addr,
            category,
            sender_name: senderName ?? null,
            confirmed_by: user!.id,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,sender_email" },
        );
      if (error) throw error;
    },
    onSuccess: (_r, vars) => {
      queryClient.invalidateQueries({ queryKey: ["sender-categories"] });
      queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
      toast.success(
        vars.category
          ? `Guardado: ${SENDER_CATEGORY_LABEL[vars.category]} · el equipo lo aprovechará`
          : "Categoría quitada",
      );
    },
    onError: (err: Error) => toast.error("No se pudo guardar la categoría: " + err.message),
  });
}
