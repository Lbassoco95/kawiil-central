import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { sendSlackNotification } from "@/lib/slackNotifications";
import { logEntityActivity } from "@/lib/activityLog";
import { createNotifications } from "@/lib/notificationHelpers";
import { extractDropboxFilenameFromUrl } from "@/lib/dropboxLinkLabel";
import { calculateNextOccurrenceDate, formatRecurrenceDate } from "@/lib/recurrenceUtils";
import { assertCanRenameTask } from "@/lib/renamePermission";
import { commentPlainText } from "@/lib/commentContent";

/** Bloquea completar una tarea padre si el checklist tiene ítems abiertos o subtareas enlazadas no cerradas. */
async function assertCanCompleteParentTask(taskId: string) {
  const { data: row, error } = await supabase
    .from("tasks")
    .select("checklist")
    .eq("id", taskId)
    .single();
  if (error) throw error;
  const checklist = (row?.checklist as unknown as Record<string, unknown>[]) ?? [];
  const childIds: string[] = [];
  for (const raw of checklist) {
    const item = raw as { completed?: boolean; task_id?: string | null };
    if (item.task_id) {
      childIds.push(item.task_id);
      continue;
    }
    if (!item.completed) {
      throw new Error(
        "No puedes marcar la tarea como completada mientras haya subtareas sin marcar en la lista."
      );
    }
  }
  if (childIds.length === 0) return;
  const unique = [...new Set(childIds)];
  const { data: children, error: cErr } = await supabase.from("tasks").select("id, status").in("id", unique);
  if (cErr) throw cErr;
  const byId = new Map((children ?? []).map((c) => [c.id, c.status]));
  for (const cid of unique) {
    const st = byId.get(cid);
    if (st !== "completada" && st !== "cancelada") {
      throw new Error(
        "No puedes marcar la tarea como completada mientras haya subtareas abiertas. Complétalas o cancélalas antes."
      );
    }
  }
}

export type Task = Tables<"tasks"> & {
  clients?: { name: string } | null;
  projects?: { name: string } | null;
  assignee_profile?: { full_name: string; email: string } | null;
  /** Tarea principal (solo se rellena para subtareas, para poder enlazarla en las listas). */
  parent_task?: { id: string; title: string | null } | null;
  /** Tipo de acción (columnas nuevas; aún no en los tipos generados de Supabase). */
  action_type?: string | null;
  follow_up_date?: string | null;
  derived_to?: string | null;
};

export type TaskComment = Tables<"task_comments"> & {
  profile?: { full_name: string; avatar_url: string | null } | null;
};

export function useTasks(filters?: { area?: string; status?: string; search?: string }) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["tasks", filters],
    queryFn: async () => {
      // Se incluyen las subtareas para que sean visibles y accionables desde /tareas
      // (antes se filtraban con is_subtask y quedaban "huérfanas": visibles en el dashboard
      // pero ausentes en la lista). Se marcan con `parent_task` para enlazarlas a su tarea principal.
      let query = supabase
        .from("tasks")
        .select("*, clients(name), projects(name)")
        .order("created_at", { ascending: false });

      if (filters?.area && filters.area !== "todas") {
        query = query.eq("area", filters.area);
      }
      if (filters?.status) {
        query = query.eq("status", filters.status as any);
      }
      if (filters?.search) {
        query = query.ilike("title", `%${filters.search}%`);
      }

      const { data, error } = await query;
      if (error) throw error;
      const rows = (data ?? []) as Task[];

      // Resolver el título de la tarea principal para cada subtarea (una sola consulta extra).
      const parentIds = [
        ...new Set(
          rows
            .filter((r) => r.is_subtask && r.parent_task_id)
            .map((r) => r.parent_task_id as string),
        ),
      ];
      if (parentIds.length > 0) {
        const { data: parents } = await supabase
          .from("tasks")
          .select("id, title")
          .in("id", parentIds);
        const titleById = new Map((parents ?? []).map((p) => [p.id, p.title]));
        for (const r of rows) {
          if (r.is_subtask && r.parent_task_id) {
            r.parent_task = { id: r.parent_task_id, title: titleById.get(r.parent_task_id) ?? null };
          }
        }
      }
      return rows;
    },
    enabled: !!user,
  });
}

/** Tareas del tablero (`tasks`) asignadas al usuario (incluye subtareas para que sigan visibles en “Mis tareas”). */
export function useMyAssignedTasks() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["tasks", "mine", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*, clients(name), projects(name)")
        .eq("assigned_to", user!.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Task[];
    },
    enabled: !!user?.id,
  });
}

export function useTasksForCalendar(startDate?: string, endDate?: string) {
  const { user } = useAuth();

  type CalendarTaskRow = Pick<
    Task,
    "id" | "title" | "due_date" | "status" | "priority" | "area" | "client_id" | "project_id" | "assigned_to"
  > & { clients?: { name: string } | null; projects?: { name: string } | null };

  return useQuery({
    queryKey: ["tasks-calendar", user?.id, startDate, endDate],
    queryFn: async () => {
      const selectCols =
        "id, title, due_date, status, priority, area, client_id, project_id, assigned_to, clients(name), projects(name)";

      let query = supabase
        .from("tasks")
        .select(selectCols)
        .not("due_date", "is", null)
        .neq("status", "completada" as any)
        .neq("status", "cancelada" as any)
        .order("due_date", { ascending: true });

      if (startDate) query = query.gte("due_date", startDate);
      if (endDate) query = query.lte("due_date", endDate);

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as CalendarTaskRow[];
    },
    enabled: !!user && !!startDate && !!endDate,
  });
}

export function useTaskDetail(taskId: string | undefined) {
  const { user } = useAuth();

  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*, clients(name), projects(name, area, start_date, created_at)")
        .eq("id", taskId!)
        .single();
      if (error) throw error;

      // Fetch creator profile
      let creator_profile: { full_name: string; email: string } | null = null;
      if (data.created_by) {
        const { data: cp } = await supabase
          .from("profiles")
          .select("full_name, email")
          .eq("user_id", data.created_by)
          .single();
        creator_profile = cp;
      }

      let parent_task: { id: string; title: string } | null = null;
      if (data.parent_task_id) {
        const { data: p } = await supabase.from("tasks").select("id, title").eq("id", data.parent_task_id).single();
        if (p) parent_task = p;
      }

      return { ...data, creator_profile, parent_task } as Task & {
        creator_profile: { full_name: string; email: string } | null;
        parent_task: { id: string; title: string } | null;
      };
    },
    enabled: !!user && !!taskId,
  });

  const commentsQuery = useQuery({
    queryKey: ["task-comments", taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_comments")
        .select("*")
        .eq("task_id", taskId!)
        .order("created_at", { ascending: true });
      if (error) throw error;

      // Fetch profiles for comment authors
      const userIds = [...new Set(data.map((c) => c.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, avatar_url")
        .in("user_id", userIds);

      return data.map((comment) => ({
        ...comment,
        profile: profiles?.find((p) => p.user_id === comment.user_id) || null,
      })) as TaskComment[];
    },
    enabled: !!user && !!taskId,
  });

  const assigneesQuery = useQuery({
    queryKey: ["task-assignees", taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("task_assignees")
        .select("*")
        .eq("task_id", taskId!);
      if (error) throw error;

      const userIds = data.map((a) => a.user_id);
      if (userIds.length === 0) return [];

      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, avatar_url")
        .in("user_id", userIds);

      return data.map((a) => ({
        ...a,
        profile: profiles?.find((p) => p.user_id === a.user_id),
      }));
    },
    enabled: !!user && !!taskId,
  });

  const documentsQuery = useQuery({
    queryKey: ["task-documents", taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("task_id", taskId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!taskId,
  });

  return {
    task: taskQuery.data,
    isLoading: taskQuery.isLoading,
    comments: commentsQuery.data ?? [],
    assignees: assigneesQuery.data ?? [],
    documents: documentsQuery.data ?? [],
  };
}

/** Tareas creadas desde un correo específico (para "Tareas relacionadas" en el módulo Correo). */
export function useTasksBySourceEmail(sourceEmailId: string | null | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["tasks-by-source-email", sourceEmailId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("tasks")
        .select("id, title, status, priority, due_date, assigned_to")
        .eq("source_email_id", sourceEmailId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; title: string; status: string; priority: string; due_date: string | null; assigned_to: string | null }>;
    },
    enabled: !!user && !!sourceEmailId,
    staleTime: 30_000,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      title: string;
      description?: string;
      area?: string;
      priority?: string;
      status?: string;
      due_date?: string;
      assigned_to?: string;
      client_id?: string;
      project_id?: string;
      phase_key?: string;
      additional_assignees?: string[];
      dropbox_links?: string[];
      criticality_level?: string;
      delay_category?: string;
      delay_notes?: string;
      parent_task_id?: string | null;
      is_subtask?: boolean;
      is_recurring?: boolean;
      recurrence_pattern?: string;
      recurrence_type?: string;
      next_recurrence_date?: string;
      // Origen: correo desde el que se creó la tarea (para "Tareas relacionadas" en Correo).
      source_email_id?: string;
      source_email_subject?: string;
      source_email_from?: string;
      // Tipo de acción: propia | seguimiento | derivar | registro (+ datos asociados).
      action_type?: string;
      follow_up_date?: string;
      derived_to?: string;
    }) => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();

      if (!profile) throw new Error("No profile found");

      const { additional_assignees, dropbox_links, ...taskData } = input;

      const { data, error } = await supabase
        .from("tasks")
        .insert({
          ...taskData,
          organization_id: profile.organization_id,
          created_by: user!.id,
          dropbox_links:
            dropbox_links?.map((url) => {
              const name = extractDropboxFilenameFromUrl(url);
              return { url, added_at: new Date().toISOString(), ...(name ? { name } : {}) };
            }) ?? [],
        } as unknown as TablesInsert<"tasks">)
        .select()
        .single();

      if (error) throw error;

      // Add additional assignees
      if (additional_assignees && additional_assignees.length > 0) {
        const assigneeRows = additional_assignees.map((uid) => ({
          task_id: data.id,
          user_id: uid,
        }));
        await supabase.from("task_assignees").insert(assigneeRows);
      }

      return data;
    },
    onSuccess: async (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project"] });
      if (variables.source_email_id) {
        queryClient.invalidateQueries({ queryKey: ["tasks-by-source-email", variables.source_email_id] });
      }
      if (variables.project_id) {
        queryClient.invalidateQueries({ queryKey: ["project-tasks", variables.project_id] });
        queryClient.invalidateQueries({ queryKey: ["compliance-tasks", variables.project_id] });
      }
      queryClient.invalidateQueries({ queryKey: ["task"] });
      queryClient.invalidateQueries({ queryKey: ["personal-rendimiento-task-log"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-all-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["briefing-team-deadlines"] });
      toast.success("Tarea creada exitosamente");

      if (data && data.organization_id) {
        void logEntityActivity(user!.id, data.organization_id, {
          entityType: "task",
          entityId: data.id,
          action: "created",
          details: { title: data.title, area: data.area, priority: data.priority },
        });
        if (!variables.is_subtask) {
          sendSlackNotification("task_created", {
            title: data.title,
            priority: data.priority,
            area: data.area,
          });
        }

        // Notify assigned users
        const assignedIds: string[] = [];
        if (variables.assigned_to) assignedIds.push(variables.assigned_to);
        if (variables.additional_assignees) assignedIds.push(...variables.additional_assignees);
        const uniqueIds = [...new Set(assignedIds)];

        if (uniqueIds.length > 0) {
          let parentTitle: string | null = null;
          if (variables.parent_task_id) {
            const { data: p } = await supabase.from("tasks").select("title").eq("id", variables.parent_task_id).single();
            parentTitle = p?.title ?? null;
          }
          const isSub = variables.is_subtask || !!variables.parent_task_id;
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          const parentLink =
            variables.parent_task_id != null
              ? `${origin}/tareas?taskId=${variables.parent_task_id}`
              : undefined;
          createNotifications(
            uniqueIds.map((uid) => ({
              user_id: uid,
              type: "task_assigned",
              title:
                isSub && parentTitle
                  ? `Subtarea de «${parentTitle}»: te asignaron «${data.title}»`
                  : `Te asignaron la tarea "${data.title}"`,
              body:
                isSub && parentTitle
                  ? [data.description?.substring(0, 160), parentLink && `Tarea principal: ${parentLink}`]
                      .filter(Boolean)
                      .join("\n") || parentLink
                  : data.description?.substring(0, 200) || undefined,
              entity_type: "task" as const,
              entity_id: variables.parent_task_id ?? data.id,
              source_user_id: user!.id,
            }))
          );
        }
      }
    },
    onError: (err: Error) => {
      toast.error("Error al crear tarea: " + err.message);
    },
  });
}

export function useAddComment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ taskId, content, mentions }: { taskId: string; content: string; mentions?: string[] }) => {
      const { error } = await supabase.from("task_comments").insert({
        task_id: taskId,
        user_id: user!.id,
        content,
        mentions: mentions ?? [],
      });
      if (error) throw error;
    },
    onSuccess: async (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["task-comments", vars.taskId] });
      queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-notifications-count"] });
      toast.success("Comentario guardado");

      if (vars.mentions && vars.mentions.length > 0) {
        sendSlackNotification("comment_mention", {
          task_title: "Tarea",
          comment_preview: commentPlainText(vars.content).substring(0, 100),
          mentioned_ids: vars.mentions,
        });

        // Create in-app notifications for mentioned users
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("organization_id, full_name")
            .eq("user_id", user!.id)
            .single();

          if (profile) {
            const notifications = vars.mentions
              .filter((uid) => uid !== user!.id)
              .map((uid) => ({
                user_id: uid,
                type: "mention" as const,
                title: `${profile.full_name} te mencionó en una tarea`,
                body: commentPlainText(vars.content).substring(0, 200),
                entity_type: "task",
                entity_id: vars.taskId,
                source_user_id: user!.id,
                organization_id: profile.organization_id,
              }));

            if (notifications.length > 0) {
              await supabase.from("notifications").insert(notifications);
            }
          }
        } catch {
          // Non-critical, don't block
        }
      }
    },
    onError: (err: Error) => {
      toast.error("Error al guardar comentario: " + err.message);
    },
  });
}

export function useUpdateComment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      commentId,
      content,
      mentions,
    }: {
      commentId: string;
      taskId: string;
      content: string;
      mentions?: string[];
      previousMentions?: string[];
    }) => {
      // Solo el autor puede editar (RLS lo refuerza además en el backend).
      const { error } = await supabase
        .from("task_comments")
        .update({ content, mentions: mentions ?? [], updated_at: new Date().toISOString() })
        .eq("id", commentId)
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: async (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["task-comments", vars.taskId] });
      queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-notifications-count"] });
      toast.success("Comentario actualizado");

      // Notifica solo a las personas mencionadas por primera vez en esta edición.
      const prev = new Set(vars.previousMentions ?? []);
      const added = (vars.mentions ?? []).filter((id) => !prev.has(id) && id !== user!.id);
      if (added.length === 0) return;

      const preview = commentPlainText(vars.content);
      sendSlackNotification("comment_mention", {
        task_title: "Tarea",
        comment_preview: preview.substring(0, 100),
        mentioned_ids: added,
      });
      try {
        const { data: profile } = await supabase
          .from("profiles")
          .select("organization_id, full_name")
          .eq("user_id", user!.id)
          .single();
        if (profile) {
          const notifications = added.map((uid) => ({
            user_id: uid,
            type: "mention" as const,
            title: `${profile.full_name} te mencionó en una tarea`,
            body: preview.substring(0, 200),
            entity_type: "task",
            entity_id: vars.taskId,
            source_user_id: user!.id,
            organization_id: profile.organization_id,
          }));
          if (notifications.length > 0) {
            await supabase.from("notifications").insert(notifications);
          }
        }
      } catch {
        // No crítico: no bloquear la edición.
      }
    },
    onError: (err: Error) => {
      toast.error("Error al actualizar comentario: " + err.message);
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      // Renombrar (cambiar el título) solo lo permite un G4 o quien creó la tarea.
      if (typeof updates.title === "string") {
        await assertCanRenameTask(id, user!.id);
      }
      if (updates.status === "completada") {
        await assertCanCompleteParentTask(id);
      }
      // Auto-set started_at when moving away from pendiente
      if (updates.status && updates.status !== "pendiente" && updates.status !== "cancelada") {
        const { data: current } = await supabase.from("tasks").select("started_at").eq("id", id).single();
        if (current && !current.started_at) {
          updates.started_at = new Date().toISOString();
        }
      }
      // Auto-set completed_at when completing
      if (updates.status === "completada") {
        updates.completed_at = new Date().toISOString();
      }
      // Clear completed_at if reopening
      if (updates.status && updates.status !== "completada") {
        updates.completed_at = null;
      }
      const { error } = await supabase.from("tasks").update(updates).eq("id", id);
      if (error) throw error;

      // Recurrencia on_complete: al marcar como completada, crear la siguiente ocurrencia
      if (updates.status === "completada") {
        const { data: taskRow } = await supabase
          .from("tasks")
          .select(
            "is_recurring, recurrence_type, recurrence_pattern, due_date, title, description, area, assigned_to, priority, client_id, project_id, phase_key, tags, dropbox_links, criticality_level, organization_id, created_by, template_id"
          )
          .eq("id", id)
          .single();

        if (taskRow?.is_recurring && taskRow.recurrence_type === "on_complete" && taskRow.recurrence_pattern) {
          const baseDate = taskRow.due_date ?? new Date().toISOString().split("T")[0];
          const nextDate = calculateNextOccurrenceDate(baseDate, taskRow.recurrence_pattern);
          const nextNextDate = calculateNextOccurrenceDate(nextDate, taskRow.recurrence_pattern);

          await supabase.from("tasks").insert({
            organization_id: taskRow.organization_id,
            project_id: taskRow.project_id,
            client_id: taskRow.client_id,
            title: taskRow.title,
            description: taskRow.description,
            area: taskRow.area,
            assigned_to: taskRow.assigned_to,
            priority: taskRow.priority,
            status: "pendiente",
            due_date: nextDate,
            tags: taskRow.tags,
            is_recurring: true,
            recurrence_pattern: taskRow.recurrence_pattern,
            recurrence_type: "on_complete",
            next_recurrence_date: nextNextDate,
            created_by: taskRow.created_by,
            template_id: (taskRow.template_id as string | null) ?? id,
            phase_key: taskRow.phase_key,
            dropbox_links: taskRow.dropbox_links ?? [],
            criticality_level: taskRow.criticality_level,
          } as TablesInsert<"tasks">);

          toast.info(
            `Próxima ocurrencia creada para el ${formatRecurrenceDate(nextDate)}`
          );
        }
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (profile?.organization_id) {
        const changeKeys = Object.keys(updates).filter((k) => k !== "id");
        void logEntityActivity(user!.id, profile.organization_id, {
          entityType: "task",
          entityId: id,
          action: "updated",
          details: { changes: changeKeys },
        });
      }
    },
    onSuccess: async (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task"] });
      queryClient.invalidateQueries({ queryKey: ["project-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project"] });
      queryClient.invalidateQueries({ queryKey: ["personal-rendimiento-task-log"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-all-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["briefing-team-deadlines"] });
      if (vars.title) {
        queryClient.invalidateQueries({ queryKey: ["linked-task-titles"] });
        queryClient.invalidateQueries({ queryKey: ["accounting-periods"] });
        queryClient.invalidateQueries({ queryKey: ["annual-declarations"] });
      }
      if (vars.status) {
        sendSlackNotification("task_updated", {
          title: vars.title || "Tarea",
          status: vars.status,
        });
      }

      // Notify on reassignment
      if (vars.assigned_to) {
        const { data: trow } = await supabase
          .from("tasks")
          .select("parent_task_id, title, is_subtask")
          .eq("id", vars.id)
          .single();
        const taskTitle = vars.title ?? trow?.title ?? "Tarea";
        const entityId = trow?.is_subtask && trow.parent_task_id ? trow.parent_task_id : vars.id;
        const isSub = !!trow?.is_subtask;
        createNotifications([{
          user_id: vars.assigned_to,
          type: "task_reassigned",
          title: isSub
            ? `Te reasignaron la subtarea «${taskTitle}»`
            : `Te reasignaron la tarea "${taskTitle}"`,
          entity_type: "task",
          entity_id: entityId,
          source_user_id: user!.id,
        }]);
      }
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw error;
      if (profile?.organization_id) {
        void logEntityActivity(user!.id, profile.organization_id, {
          entityType: "task",
          entityId: id,
          action: "deleted",
        });
      }
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project"] });
      queryClient.invalidateQueries({ queryKey: ["task"] });
      queryClient.invalidateQueries({ queryKey: ["personal-rendimiento-task-log"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-all-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["briefing-team-deadlines"] });
      toast.success("Tarea eliminada");
    },
    onError: (err: Error) => toast.error("Error al eliminar tarea: " + err.message),
  });
}

export function useProfiles() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["org-profiles"],
    queryFn: async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();

      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, avatar_url, area")
        .eq("organization_id", profile!.organization_id)
        .eq("is_active", true);

      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}
