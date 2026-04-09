import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export const MAIL_DIRECTORY_QUERY_KEY = ["mail-directory-contacts"] as const;

export type MailDirectoryContact = {
  email: string;
  display_name: string | null;
  last_seen_at: string;
};

function isNotConnectedResponse(data: unknown): boolean {
  return (data as { code?: string } | null)?.code === "NOT_CONNECTED";
}

export function useMailDirectoryContacts(enabled: boolean) {
  const { user } = useAuth();

  return useQuery({
    queryKey: [...MAIL_DIRECTORY_QUERY_KEY, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_mail_directory")
        .select("email, display_name, last_seen_at")
        .order("last_seen_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      return (data ?? []) as MailDirectoryContact[];
    },
    enabled: !!user && enabled,
    staleTime: 60_000,
  });
}

export type SyncMailDirectoryVars = { silent?: boolean };

export function useSyncMailDirectory() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (_opts?: SyncMailDirectoryVars) => {
      if (!user?.id) throw new Error("Sesión requerida");
      const { data, error } = await supabase.functions.invoke("microsoft-api", {
        body: { action: "mail-directory-sync", params: { top: 180 } },
      });
      if (isNotConnectedResponse(data)) {
        return { upserted: 0, notConnected: true as const };
      }
      if (error) throw error;
      if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
        throw new Error(String((data as { error: string }).error));
      }
      const contacts = (data as { contacts?: { email: string; displayName?: string }[] }).contacts ?? [];
      if (contacts.length === 0) {
        return { upserted: 0, notConnected: false as const };
      }
      const now = new Date().toISOString();
      const rows = contacts.map((c) => ({
        user_id: user.id,
        email: String(c.email).trim().toLowerCase(),
        display_name: c.displayName?.trim() || null,
        last_seen_at: now,
      }));
      const { error: upErr } = await supabase.from("user_mail_directory").upsert(rows, {
        onConflict: "user_id,email",
      });
      if (upErr) throw upErr;
      return { upserted: rows.length, notConnected: false as const };
    },
    onSuccess: (res, vars) => {
      void queryClient.invalidateQueries({ queryKey: [...MAIL_DIRECTORY_QUERY_KEY, user?.id] });
      if (res.notConnected || vars?.silent) return;
      if (res.upserted > 0) {
        toast.success(`Directorio actualizado (${res.upserted} direcciones)`);
      } else {
        toast.message("Directorio revisado; no hay direcciones nuevas en el buzón reciente.");
      }
    },
    onError: (e: Error) => {
      toast.error(e.message || "No se pudo actualizar el directorio");
    },
  });
}
