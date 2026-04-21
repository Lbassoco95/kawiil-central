import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type ReminderRepeatKind = "none" | "hourly_digest" | "daily_digest";

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
}

export type ReminderCreateInput = {
  title: string;
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
      const { data, error } = await supabase
        .from("reminders" as any)
        .select("*")
        .eq("user_id", user!.id)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as unknown as Reminder[];
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

  return {
    reminders: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    fetchError: query.error,
    addReminder,
    toggleReminder,
    deleteReminder,
  };
}
