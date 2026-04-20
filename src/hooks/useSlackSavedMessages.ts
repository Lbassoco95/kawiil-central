import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type SlackSavedStatus = "in_progress" | "archived" | "completed";

export interface SlackSavedMessage {
  id: string;
  user_id: string;
  organization_id: string;
  channel_id: string;
  message_ts: string;
  thread_ts: string | null;
  status: SlackSavedStatus;
  snippet: string | null;
  author_slack_user_id: string | null;
  author_name: string | null;
  channel_name: string | null;
  saved_at: string;
  updated_at: string;
}

export interface SaveSlackMessageInput {
  channel_id: string;
  message_ts: string;
  thread_ts?: string | null;
  snippet?: string | null;
  author_slack_user_id?: string | null;
  author_name?: string | null;
  channel_name?: string | null;
}

const EMPTY_LIST: SlackSavedMessage[] = [];

/**
 * Lista de mensajes Slack guardados por el usuario filtrada por estado.
 * Si se pasa `undefined` como status, regresa TODOS (para contadores globales).
 */
export function useSlackSavedMessages(status?: SlackSavedStatus) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["slack-saved", user?.id, status ?? "all"],
    enabled: !!user,
    staleTime: 15_000,
    queryFn: async (): Promise<SlackSavedMessage[]> => {
      if (!user) return EMPTY_LIST;
      let q = supabase
        .from("slack_saved_messages")
        .select("*")
        .eq("user_id", user.id)
        .order("saved_at", { ascending: false })
        .limit(200);
      if (status) q = q.eq("status", status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SlackSavedMessage[];
    },
  });
}

/**
 * Set de keys `channel|ts` ya guardados (en estado in_progress) para UI optimista
 * (bookmark lleno vs vacío) en SlackMessageList.
 */
export function useSlackSavedKeySet(status: SlackSavedStatus = "in_progress") {
  const query = useSlackSavedMessages(status);
  return useMemo(() => {
    const set = new Set<string>();
    for (const m of query.data ?? []) set.add(`${m.channel_id}|${m.message_ts}`);
    return set;
  }, [query.data]);
}

/** Contador rápido para badge del rail. */
export function useSlackSavedCount(status: SlackSavedStatus = "in_progress") {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["slack-saved-count", user?.id, status],
    enabled: !!user,
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<number> => {
      if (!user) return 0;
      const { count, error } = await supabase
        .from("slack_saved_messages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", status);
      if (error) throw error;
      return count ?? 0;
    },
  });
}

function invalidateSaved(qc: ReturnType<typeof useQueryClient>, userId?: string) {
  qc.invalidateQueries({ queryKey: ["slack-saved", userId] });
  qc.invalidateQueries({ queryKey: ["slack-saved-count", userId] });
}

export function useSaveSlackMessage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: SaveSlackMessageInput) => {
      if (!user) throw new Error("No hay sesión");
      const { data: profile, error: perr } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user.id)
        .single();
      if (perr) throw perr;
      if (!profile?.organization_id) throw new Error("Sin organización activa");

      const payload = {
        user_id: user.id,
        organization_id: profile.organization_id,
        channel_id: input.channel_id,
        message_ts: input.message_ts,
        thread_ts: input.thread_ts ?? null,
        snippet: input.snippet?.slice(0, 500) ?? null,
        author_slack_user_id: input.author_slack_user_id ?? null,
        author_name: input.author_name ?? null,
        channel_name: input.channel_name ?? null,
        status: "in_progress" as const,
      };

      const { data, error } = await supabase
        .from("slack_saved_messages")
        .upsert(payload, { onConflict: "user_id,channel_id,message_ts" })
        .select()
        .single();
      if (error) throw error;
      return data as SlackSavedMessage;
    },
    onSuccess: () => {
      invalidateSaved(qc, user?.id);
      toast.success("Guardado para más tarde");
    },
    onError: (err: Error) => {
      toast.error("No se pudo guardar: " + err.message);
    },
  });
}

export function useUpdateSlackSavedStatus() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: SlackSavedStatus }) => {
      const { error } = await supabase
        .from("slack_saved_messages")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidateSaved(qc, user?.id);
      const labels: Record<SlackSavedStatus, string> = {
        in_progress: "Marcado como en curso",
        archived: "Archivado",
        completed: "Completado",
      };
      toast.success(labels[vars.status]);
    },
    onError: (err: Error) => {
      toast.error("No se pudo actualizar: " + err.message);
    },
  });
}

export function useDeleteSlackSavedMessage() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await supabase.from("slack_saved_messages").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateSaved(qc, user?.id);
      toast.success("Eliminado");
    },
    onError: (err: Error) => {
      toast.error("No se pudo eliminar: " + err.message);
    },
  });
}

/**
 * Elimina el guardado por `channel_id` + `message_ts` (usado desde el toggle del bookmark
 * en el hover de mensaje cuando el usuario quiere "quitar" en lugar de buscar el id).
 */
export function useUnsaveSlackMessageByRef() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ channel_id, message_ts }: { channel_id: string; message_ts: string }) => {
      if (!user) throw new Error("No hay sesión");
      const { error } = await supabase
        .from("slack_saved_messages")
        .delete()
        .eq("user_id", user.id)
        .eq("channel_id", channel_id)
        .eq("message_ts", message_ts);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateSaved(qc, user?.id);
    },
    onError: (err: Error) => {
      toast.error("No se pudo quitar: " + err.message);
    },
  });
}
