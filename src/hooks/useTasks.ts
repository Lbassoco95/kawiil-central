import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { sendSlackNotification } from "@/lib/slackNotifications";
import { logActivity } from "@/lib/activityLog";

export type Task = Tables<"tasks"> & {
  clients?: { name: string } | null;
  projects?: { name: string } | null;
  assignee_profile?: { full_name: string; email: string } | null;
};

export type TaskComment = Tables<"task_comments"> & {
  profile?: { full_name: string; avatar_url: string | null } | null;
};

export function useTasks(filters?: { area?: string; status?: string; search?: string }) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["tasks", filters],
    queryFn: async () => {
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
      return data as Task[];
    },
    enabled: !!user,
  });
}

export function useTaskDetail(taskId: string | undefined) {
  const { user } = useAuth();

  const taskQuery = useQuery({
    queryKey: ["task", taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*, clients(name), projects(name)")
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

      return { ...data, creator_profile } as Task & { creator_profile: { full_name: string; email: string } | null };
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
      additional_assignees?: string[];
      dropbox_links?: string[];
      criticality_level?: string;
      delay_category?: string;
      delay_notes?: string;
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
          dropbox_links: dropbox_links?.map((url) => ({ url, added_at: new Date().toISOString() })) ?? [],
        } as TablesInsert<"tasks">)
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
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project"] });
      queryClient.invalidateQueries({ queryKey: ["task"] });
      toast.success("Tarea creada exitosamente");

      if (data) {
        logActivity({ entityType: "task", entityId: data.id, action: "created", details: { title: data.title, area: data.area, priority: data.priority } });
        sendSlackNotification("task_created", {
          title: data.title,
          priority: data.priority,
          area: data.area,
        });
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
          comment_preview: vars.content.substring(0, 100),
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
                body: vars.content.substring(0, 200),
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

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
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
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task"] });
      queryClient.invalidateQueries({ queryKey: ["project-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project"] });
      // Refresh linked task titles in step checklists when title changes
      if (vars.title) {
        queryClient.invalidateQueries({ queryKey: ["linked-task-titles"] });
        queryClient.invalidateQueries({ queryKey: ["accounting-periods"] });
        queryClient.invalidateQueries({ queryKey: ["annual-declarations"] });
      }
      logActivity({ entityType: "task", entityId: vars.id, action: "updated", details: { changes: Object.keys(vars).filter(k => k !== "id") } });

      if (vars.status) {
        sendSlackNotification("task_updated", {
          title: vars.title || "Tarea",
          status: vars.status,
        });
      }
    },
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["project"] });
      queryClient.invalidateQueries({ queryKey: ["task"] });
      logActivity({ entityType: "task", entityId: id, action: "deleted" });
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
