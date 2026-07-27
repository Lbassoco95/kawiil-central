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

/** Valor guardado: una categoría, o "ninguna" (el usuario excluyó al remitente de toda sección). */
export type StoredCategory = SenderCategory | "ninguna";

/** Mapa remitente(lowercase) → categoría guardada, propio de cada usuario. */
export function useSenderCategories() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["sender-categories"],
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await (supabase as any)
        .from("email_sender_categories")
        .select("sender_email, category");
      if (error) throw error;
      const map = new Map<string, string>();
      for (const row of data ?? []) {
        map.set(String(row.sender_email).toLowerCase(), String(row.category));
      }
      return map;
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });
}

/** Establece la categoría de un remitente (propia del usuario).
 *  - una categoría → se clasifica ahí; "ninguna" → excluido de toda sección (solo bandeja);
 *  - null → borra la preferencia y vuelve a la predefinida (heurística). */
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
      category: StoredCategory | null;
      senderName?: string;
    }) => {
      const addr = senderEmail.trim().toLowerCase();
      if (!addr) return;

      if (category === null) {
        const { error } = await (supabase as any)
          .from("email_sender_categories")
          .delete()
          .eq("user_id", user!.id)
          .eq("sender_email", addr);
        if (error) throw error;
        return;
      }
      const { error } = await (supabase as any)
        .from("email_sender_categories")
        .upsert(
          {
            user_id: user!.id,
            sender_email: addr,
            category,
            sender_name: senderName ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,sender_email" },
        );
      if (error) throw error;
    },
    onSuccess: (_r, vars) => {
      queryClient.invalidateQueries({ queryKey: ["sender-categories"] });
      queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
      toast.success(
        vars.category === "ninguna"
          ? "Quitado de las secciones · se queda en la bandeja"
          : vars.category
            ? `Guardado: ${SENDER_CATEGORY_LABEL[vars.category]} · se clasificará solo`
            : "Preferencia restablecida",
      );
    },
    onError: (err: Error) => toast.error("No se pudo guardar la categoría: " + err.message),
  });
}
