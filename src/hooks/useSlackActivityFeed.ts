import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { parseSlackEntityRef } from "@/lib/slackDeepLink";

export type SlackActivityTab = "all" | "mentions" | "threads" | "dms" | "reactions";

export interface SlackActivityItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  entity_ref: string | null;
  channel_id: string | null;
  message_ts: string | null;
  source_user_id: string | null;
  is_read: boolean;
  created_at: string;
  source_profile: {
    user_id: string;
    full_name: string | null;
    avatar_url: string | null;
  } | null;
}

const SLACK_ACTIVITY_TYPES = [
  "slack_mention",
  "slack_message",
  "slack_reaction",
  "slack_thread_reply",
  "slack_dm",
] as const;

/**
 * Feed de actividad Slack. Lee de `notifications` con `entity_type = 'slack'`.
 *
 * Comportamiento de tabs (mapeo a tipos existentes hoy + fallback por heurística):
 * - all:        todos los tipos Slack.
 * - mentions:   slack_mention.
 * - threads:    slack_thread_reply (fallback: título/body contiene "hilo").
 * - dms:        slack_dm (fallback: título/body contiene "mensaje directo").
 * - reactions:  slack_reaction.
 */
export function useSlackActivityFeed(tab: SlackActivityTab = "all", onlyUnread = false) {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["slack-activity", user?.id, tab, onlyUnread],
    enabled: !!user,
    staleTime: 15_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    queryFn: async (): Promise<SlackActivityItem[]> => {
      if (!user) return [];
      let q = supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .eq("entity_type", "slack")
        .order("created_at", { ascending: false })
        .limit(150);

      if (onlyUnread) q = q.eq("is_read", false);

      if (tab === "mentions") q = q.eq("type", "slack_mention");
      else if (tab === "reactions") q = q.eq("type", "slack_reaction");
      else q = q.in("type", [...SLACK_ACTIVITY_TYPES]);

      const { data, error } = await q;
      if (error) throw error;

      const rows = (data ?? []) as Array<{
        id: string;
        type: string;
        title: string;
        body: string | null;
        entity_ref: string | null;
        source_user_id: string | null;
        is_read: boolean;
        created_at: string;
      }>;

      const sourceIds = [...new Set(rows.map((r) => r.source_user_id).filter(Boolean))] as string[];
      let profileMap: Record<string, { user_id: string; full_name: string | null; avatar_url: string | null }> = {};
      if (sourceIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("user_id, full_name, avatar_url")
          .in("user_id", sourceIds);
        for (const p of profiles ?? []) {
          profileMap[p.user_id] = p as never;
        }
      }

      const mapped: SlackActivityItem[] = rows.map((r) => {
        const parts = parseSlackEntityRef(r.entity_ref);
        return {
          id: r.id,
          type: r.type,
          title: r.title,
          body: r.body,
          entity_ref: r.entity_ref,
          channel_id: parts?.channel ?? null,
          message_ts: parts?.ts ?? null,
          source_user_id: r.source_user_id,
          is_read: r.is_read,
          created_at: r.created_at,
          source_profile: r.source_user_id ? profileMap[r.source_user_id] ?? null : null,
        };
      });

      if (tab === "threads") {
        return mapped.filter(
          (m) =>
            m.type === "slack_thread_reply" ||
            /hilo|thread/i.test(m.title || "") ||
            /hilo|thread/i.test(m.body || ""),
        );
      }
      if (tab === "dms") {
        return mapped.filter(
          (m) =>
            m.type === "slack_dm" ||
            /mensaje directo|dm|direct message/i.test(m.title || "") ||
            /mensaje directo|dm|direct message/i.test(m.body || ""),
        );
      }
      return mapped;
    },
  });

  const unreadCounts = useMemo(() => {
    const items = query.data ?? [];
    const counts = { all: 0, mentions: 0, threads: 0, dms: 0, reactions: 0 };
    for (const i of items) {
      if (!i.is_read) counts.all += 1;
    }
    return counts;
  }, [query.data]);

  return { ...query, unreadCounts };
}

/** Contador rápido de menciones Slack no leídas — para badge en el rail. */
export function useSlackUnreadMentionsCount() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["slack-unread-mentions-count", user?.id],
    enabled: !!user,
    staleTime: 15_000,
    refetchInterval: 60_000,
    queryFn: async (): Promise<number> => {
      if (!user) return 0;
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("entity_type", "slack")
        .eq("is_read", false)
        .eq("type", "slack_mention");
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useMarkSlackActivityRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["slack-activity", user?.id] });
      qc.invalidateQueries({ queryKey: ["slack-unread-mentions-count", user?.id] });
      qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", user?.id] });
      qc.invalidateQueries({ queryKey: ["user-notifications", user?.id] });
      qc.invalidateQueries({ queryKey: ["unread-notifications-count", user?.id] });
    },
  });
}

export function useMarkAllSlackActivityRead() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async () => {
      if (!user) return;
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("entity_type", "slack")
        .eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["slack-activity", user?.id] });
      qc.invalidateQueries({ queryKey: ["slack-unread-mentions-count", user?.id] });
      qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", user?.id] });
      qc.invalidateQueries({ queryKey: ["user-notifications", user?.id] });
      qc.invalidateQueries({ queryKey: ["unread-notifications-count", user?.id] });
    },
  });
}
