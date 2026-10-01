import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  mtgDb,
  type MtgMeetingRow,
  type MtgSeriesRow,
  type MtgTopicRow,
  type MtgTopicUpdateRow,
  type MtgAgreementRow,
  type MtgDecisionRow,
  type MtgExpectedNextRow,
} from "@/lib/mtg/db";
import { prepareMeetingBoard } from "@/lib/mtg/prepareMeetingBoard";
import { startMeeting, endMeeting } from "@/lib/mtg/meetingLifecycle";
import { captureAgreement, assignProjectAndCreateTask } from "@/lib/mtg/captureAgreement";
import { logMtgAudit, MTG_AUDIT_ACTION } from "@/lib/mtg/audit";

export type BoardTopicRow = MtgTopicRow & {
  update: MtgTopicUpdateRow | null;
};

export function useMtgBoard(meetingId: string | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();

  const boardQuery = useQuery({
    queryKey: ["mtg-board", meetingId],
    enabled: !!user && !!meetingId,
    queryFn: async () => {
      const { data: meeting, error: mErr } = await mtgDb
        .from("mtg_meetings")
        .select("*")
        .eq("id", meetingId!)
        .single();
      if (mErr) throw mErr;

      let series: MtgSeriesRow | null = null;
      if (meeting.series_id) {
        const { data: s, error: sErr } = await mtgDb
          .from("mtg_series")
          .select("*")
          .eq("id", meeting.series_id)
          .single();
        if (sErr) throw sErr;
        series = s as MtgSeriesRow;
      }

      await prepareMeetingBoard({ meeting: meeting as MtgMeetingRow, series });

      const { data: updates, error: uErr } = await mtgDb
        .from("mtg_topic_updates")
        .select("*")
        .eq("meeting_id", meetingId!);
      if (uErr) throw uErr;

      const topicIds = [...new Set((updates ?? []).map((u) => u.topic_id))];
      let topics: MtgTopicRow[] = [];
      if (topicIds.length > 0) {
        const { data: t, error: tErr } = await mtgDb.from("mtg_topics").select("*").in("id", topicIds);
        if (tErr) throw tErr;
        topics = (t ?? []) as MtgTopicRow[];
      } else if (series) {
        const { data: t } = await mtgDb
          .from("mtg_topics")
          .select("*")
          .eq("series_id", series.id)
          .eq("status", "open");
        topics = (t ?? []) as MtgTopicRow[];
      }

      const updateByTopic = new Map((updates ?? []).map((u) => [u.topic_id, u as MtgTopicUpdateRow]));
      const boardTopics: BoardTopicRow[] = topics.map((t) => ({
        ...t,
        update: updateByTopic.get(t.id) ?? null,
      }));

      const { data: agreements } = await mtgDb
        .from("mtg_agreements")
        .select("*")
        .eq("meeting_id", meetingId!)
        .order("created_at");

      const { data: decisions } = await mtgDb
        .from("mtg_decisions")
        .select("*")
        .eq("meeting_id", meetingId!)
        .order("sort_order");

      const { data: expected } = await mtgDb
        .from("mtg_expected_next")
        .select("*")
        .eq("meeting_id", meetingId!)
        .order("sort_order");

      // Proyectos activos de los clientes de la junta
      const clientIds = [
        ...new Set(
          [
            meeting.client_id,
            ...(series?.entities ?? []).map((e) => e.client_id),
            ...boardTopics.map((t) => t.client_id),
          ].filter(Boolean) as string[],
        ),
      ];

      let projects: { id: string; name: string; area: string | null; client_id: string | null; status: string }[] =
        [];
      if (clientIds.length > 0) {
        const { data: p } = await supabase
          .from("projects")
          .select("id, name, area, client_id, status")
          .in("client_id", clientIds)
          .eq("status", "activo");
        projects = p ?? [];
      }

      // Tareas abiertas / vencimientos
      let openTasks: {
        id: string;
        title: string;
        client_id: string | null;
        due_date: string | null;
        status: string;
        compliance_template_id: string | null;
      }[] = [];
      if (clientIds.length > 0) {
        const { data: tasks } = await supabase
          .from("tasks")
          .select("id, title, client_id, due_date, status, compliance_template_id")
          .in("client_id", clientIds)
          .not("status", "in", '("completada","cancelada")');
        openTasks = (tasks ?? []) as typeof openTasks;
      }

      let seriesMeetings: Pick<MtgMeetingRow, "id" | "scheduled_at" | "status">[] = [];
      if (series) {
        const { data: sm } = await mtgDb
          .from("mtg_meetings")
          .select("id, scheduled_at, status")
          .eq("series_id", series.id)
          .order("scheduled_at", { ascending: true });
        seriesMeetings = (sm ?? []) as typeof seriesMeetings;
      }

      return {
        meeting: meeting as MtgMeetingRow,
        series,
        boardTopics,
        agreements: (agreements ?? []) as MtgAgreementRow[],
        decisions: (decisions ?? []) as MtgDecisionRow[],
        expectedNext: (expected ?? []) as MtgExpectedNextRow[],
        projects,
        openTasks,
        deadlines: openTasks.filter((t) => !!t.compliance_template_id),
        plainTasks: openTasks.filter((t) => !t.compliance_template_id),
        seriesMeetings,
      };
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["mtg-board", meetingId] });

  const patchUpdate = useMutation({
    mutationFn: async (input: {
      updateId: string;
      patch: Partial<MtgTopicUpdateRow>;
    }) => {
      const { error } = await mtgDb
        .from("mtg_topic_updates")
        .update(input.patch)
        .eq("id", input.updateId);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  const doStart = useMutation({
    mutationFn: async () => {
      if (!user || !boardQuery.data) throw new Error("Sin datos");
      return startMeeting({
        organizationId: boardQuery.data.meeting.organization_id,
        actorUserId: user.id,
        meeting: boardQuery.data.meeting,
      });
    },
    onSuccess: invalidate,
  });

  const doEnd = useMutation({
    mutationFn: async () => {
      if (!user || !boardQuery.data) throw new Error("Sin datos");
      const pending = boardQuery.data.decisions
        .filter((d) => d.status === "pending")
        .map((d) => d.id);
      const updates = boardQuery.data.boardTopics
        .map((t) => t.update)
        .filter(Boolean) as MtgTopicUpdateRow[];
      const ended = await endMeeting({
        organizationId: boardQuery.data.meeting.organization_id,
        actorUserId: user.id,
        meeting: boardQuery.data.meeting,
        updates,
        pendingDecisionIds: pending,
        enqueueMinutes: true,
      });
      // Borrador inmediato (acuerdos/tablero); el worker enriquecerá si hay transcripción.
      try {
        const { error } = await supabase.functions.invoke("mtg-minutes-draft", {
          body: { meeting_id: ended.id },
        });
        if (error) console.warn("[mtg] minutes-draft after end", error);
      } catch (e) {
        console.warn("[mtg] minutes-draft after end", e);
      }
      return ended;
    },
    onSuccess: invalidate,
  });

  const addAgreement = useMutation({
    mutationFn: async (input: Parameters<typeof captureAgreement>[0]) => captureAgreement(input),
    onSuccess: invalidate,
  });

  const setProject = useMutation({
    mutationFn: async (input: {
      agreement: MtgAgreementRow;
      projectId: string;
      organizationId: string;
      actorUserId: string;
    }) =>
      assignProjectAndCreateTask({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        agreement: input.agreement,
        projectId: input.projectId,
      }),
    onSuccess: invalidate,
  });

  const markDecision = useMutation({
    mutationFn: async (input: {
      decisionId: string;
      resolution: string;
      organizationId: string;
      actorUserId: string;
    }) => {
      const { error } = await mtgDb
        .from("mtg_decisions")
        .update({
          status: "decided",
          resolution: input.resolution,
          decided_at: new Date().toISOString(),
          decided_by_name: null,
        })
        .eq("id", input.decisionId);
      if (error) throw error;
      await logMtgAudit({
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        entityType: "decision",
        entityId: input.decisionId,
        action: MTG_AUDIT_ACTION.DECISION_DECIDED,
        details: { resolution: input.resolution },
      });
    },
    onSuccess: invalidate,
  });

  const toggleExpectedNext = useMutation({
    mutationFn: async (input: { id: string; done: boolean }) => {
      const { error } = await mtgDb
        .from("mtg_expected_next")
        .update({ done: input.done })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });

  return {
    ...boardQuery,
    patchUpdate,
    doStart,
    doEnd,
    addAgreement,
    setProject,
    markDecision,
    toggleExpectedNext,
    invalidate,
  };
}
