/**
 * Historial de un tema (updates + acuerdos + decisiones).
 */

import { supabase } from "@/integrations/supabase/client";
import { mtgDb, type MtgAgreementRow, type MtgDecisionRow, type MtgTopicUpdateRow } from "@/lib/mtg/db";

export type TopicHistoryUpdate = MtgTopicUpdateRow & {
  meeting_scheduled_at: string | null;
};

export type TopicHistoryBundle = {
  updates: TopicHistoryUpdate[];
  agreements: Array<MtgAgreementRow & { task_status?: string | null }>;
  decisions: MtgDecisionRow[];
};

export async function fetchTopicHistory(topicId: string): Promise<TopicHistoryBundle> {
  const { data: updates, error: uErr } = await mtgDb
    .from("mtg_topic_updates")
    .select("*")
    .eq("topic_id", topicId)
    .order("created_at", { ascending: true });
  if (uErr) throw uErr;

  const meetingIds = [...new Set((updates ?? []).map((u) => u.meeting_id))];
  let meetingAt = new Map<string, string>();
  if (meetingIds.length > 0) {
    const { data: meetings } = await mtgDb
      .from("mtg_meetings")
      .select("id, scheduled_at")
      .in("id", meetingIds);
    meetingAt = new Map((meetings ?? []).map((m) => [m.id, m.scheduled_at]));
  }

  const { data: agreements } = await mtgDb
    .from("mtg_agreements")
    .select("*")
    .eq("topic_id", topicId)
    .order("created_at");

  const taskIds = (agreements ?? []).map((a) => a.task_id).filter(Boolean) as string[];
  let taskStatus = new Map<string, string>();
  if (taskIds.length > 0) {
    const { data: tasks } = await supabase.from("tasks").select("id, status").in("id", taskIds);
    taskStatus = new Map((tasks ?? []).map((t) => [t.id, t.status]));
  }

  const { data: decisions } = await mtgDb
    .from("mtg_decisions")
    .select("*")
    .eq("topic_id", topicId)
    .order("created_at");

  return {
    updates: (updates ?? []).map((u) => ({
      ...(u as MtgTopicUpdateRow),
      meeting_scheduled_at: meetingAt.get(u.meeting_id) ?? null,
    })),
    agreements: (agreements ?? []).map((a) => ({
      ...(a as MtgAgreementRow),
      task_status: a.task_id ? taskStatus.get(a.task_id) ?? null : null,
    })),
    decisions: (decisions ?? []) as MtgDecisionRow[],
  };
}
