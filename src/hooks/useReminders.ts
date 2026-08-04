import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { createNotifications } from "@/lib/notificationHelpers";
import { toast } from "sonner";

export type ReminderRepeatKind = "none" | "hourly_digest" | "daily_digest";

export interface ReminderCollaborator {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface Reminder {
  id: string;
  user_id: string;
  organization_id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  /** Tras migración siempre viene del API; opcional por compatibilidad con caches antiguas. */
  repeat_kind?: ReminderRepeatKind;
  is_completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  /** true si el recordatorio es del usuario actual; false si se lo compartieron. */
  is_owner: boolean;
  /** Colaboradores "arrobados" que también ven este recordatorio. */
  collaborators: ReminderCollaborator[];
}

export type ReminderCreateInput = {
  title: string;
  description?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  repeat_kind?: ReminderRepeatKind;
};

export type ReminderUpdateInput = {
  id: string;
  title?: string;
  description?: string | null;
  due_date?: string | null;
  due_time?: string | null;
  repeat_kind?: ReminderRepeatKind;
};

export function useReminders() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const key = ["reminders", user?.id];

  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      // RLS devuelve recordatorios propios + los compartidos con el usuario.
      const { data, error } = await supabase
        .from("reminders" as any)
        .select("*")
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;

      const base = (data ?? []) as unknown as Omit<Reminder, "is_owner" | "collaborators">[];
      const reminderIds = base.map((r) => r.id);

      // Colaboradores de todos los recordatorios visibles.
      const collabsByReminder = new Map<string, ReminderCollaborator[]>();
      if (reminderIds.length > 0) {
        const { data: collabRows } = await supabase
          .from("reminder_collaborators" as any)
          .select("reminder_id, user_id")
          .in("reminder_id", reminderIds);
        const rows = (collabRows ?? []) as unknown as { reminder_id: string; user_id: string }[];
        const collabUserIds = [...new Set(rows.map((r) => r.user_id))];
        const profileMap: Record<string, { full_name: string | null; avatar_url: string | null }> = {};
        if (collabUserIds.length > 0) {
          const { data: profiles } = await supabase
            .from("profiles")
            .select("user_id, full_name, avatar_url")
            .in("user_id", collabUserIds);
          profiles?.forEach((p) => {
            profileMap[p.user_id] = { full_name: p.full_name, avatar_url: p.avatar_url };
          });
        }
        for (const r of rows) {
          const list = collabsByReminder.get(r.reminder_id) ?? [];
          list.push({
            user_id: r.user_id,
            full_name: profileMap[r.user_id]?.full_name ?? null,
            avatar_url: profileMap[r.user_id]?.avatar_url ?? null,
          });
          collabsByReminder.set(r.reminder_id, list);
        }
      }

      return base.map((r) => ({
        ...r,
        is_owner: r.user_id === user!.id,
        collaborators: collabsByReminder.get(r.id) ?? [],
      })) as Reminder[];
    },
    enabled: !!user,
  });

  const addReminder = useMutation({
    mutationFn: async (input: ReminderCreateInput) => {
      const { data: orgId, error: orgErr } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      if (orgErr) throw orgErr;
      if (orgId == null) {
        throw new Error("No hay organización asociada a tu cuenta; no se puede crear el recordatorio.");
      }
      const { error } = await supabase.from("reminders" as any).insert({
        user_id: user!.id,
        organization_id: orgId,
        title: input.title,
        description: input.description ?? null,
        due_date: input.due_date ?? null,
        due_time: input.due_time ?? null,
        repeat_kind: input.repeat_kind ?? "hourly_digest",
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      toast.success("Recordatorio creado");
    },
    onError: (e: Error) => {
      toast.error(e?.message || "Error al crear recordatorio");
    },
  });

  const updateReminder = useMutation({
    mutationFn: async ({ id, ...fields }: ReminderUpdateInput) => {
      const patch: Record<string, unknown> = {};
      if (fields.title !== undefined) patch.title = fields.title;
      if (fields.description !== undefined) patch.description = fields.description;
      if (fields.due_date !== undefined) patch.due_date = fields.due_date;
      if (fields.due_time !== undefined) patch.due_time = fields.due_time;
      if (fields.repeat_kind !== undefined) patch.repeat_kind = fields.repeat_kind;
      const { error } = await supabase.from("reminders" as any).update(patch as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      toast.success("Recordatorio actualizado");
    },
    onError: (e: Error) => {
      toast.error(e?.message || "Error al actualizar recordatorio");
    },
  });

  const toggleReminder = useMutation({
    mutationFn: async ({ id, is_completed }: { id: string; is_completed: boolean }) => {
      const { error } = await supabase
        .from("reminders" as any)
        .update({
          is_completed,
          completed_at: is_completed ? new Date().toISOString() : null,
        } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const deleteReminder = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("reminders" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: key }); toast.success("Recordatorio eliminado"); },
  });

  const addCollaborator = useMutation({
    mutationFn: async ({
      reminder,
      userId,
    }: {
      reminder: Reminder;
      userId: string;
    }) => {
      const { error } = await supabase.from("reminder_collaborators" as any).insert({
        reminder_id: reminder.id,
        user_id: userId,
        added_by: user!.id,
      } as any);
      if (error) throw error;
      // Avisar al colaborador que lo arrobaron en este recordatorio.
      await createNotifications([
        {
          user_id: userId,
          type: "reminder_collaborator_added",
          title: "Te agregaron a un recordatorio",
          body: reminder.title,
          entity_type: "reminder",
          entity_id: reminder.id,
          source_user_id: user!.id,
        },
      ]);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      toast.success("Colaborador agregado");
    },
    onError: (e: Error) => {
      const msg = /duplicate key|unique/i.test(e?.message ?? "")
        ? "Esa persona ya es colaboradora"
        : e?.message || "No se pudo agregar el colaborador";
      toast.error(msg);
    },
  });

  const removeCollaborator = useMutation({
    mutationFn: async ({ reminderId, userId }: { reminderId: string; userId: string }) => {
      const { error } = await supabase
        .from("reminder_collaborators" as any)
        .delete()
        .eq("reminder_id", reminderId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      toast.success("Colaborador quitado");
    },
    onError: (e: Error) => {
      toast.error(e?.message || "No se pudo quitar el colaborador");
    },
  });

  return {
    reminders: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    fetchError: query.error,
    refetch: query.refetch,
    isFetching: query.isFetching,
    addReminder,
    updateReminder,
    toggleReminder,
    deleteReminder,
    addCollaborator,
    removeCollaborator,
  };
}
