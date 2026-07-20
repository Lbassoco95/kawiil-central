import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface CalendarCategory {
  id: string;
  organization_id: string;
  name: string;
  color: string;
  created_by: string | null;
  created_at: string;
}

/** Categorías de calendario compartidas por la organización (aplicables a cualquier cuenta). */
export function useCalendarCategories() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["calendar-categories"],
    queryFn: async (): Promise<CalendarCategory[]> => {
      const { data, error } = await (supabase as any)
        .from("calendar_categories")
        .select("id, organization_id, name, color, created_by, created_at")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CalendarCategory[];
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });
}

async function currentOrgId(userId: string): Promise<string> {
  const { data, error } = await supabase.from("profiles").select("organization_id").eq("user_id", userId).single();
  if (error || !data?.organization_id) throw new Error("No se encontró la organización del usuario");
  return data.organization_id as string;
}

export function useCreateCalendarCategory() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ name, color }: { name: string; color: string }) => {
      const organization_id = await currentOrgId(user!.id);
      const { error } = await (supabase as any)
        .from("calendar_categories")
        .insert({ name: name.trim(), color, organization_id, created_by: user!.id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-categories"] });
      toast.success("Categoría creada");
    },
    onError: (e: Error) => toast.error("No se pudo crear la categoría: " + e.message),
  });
}

export function useUpdateCalendarCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name, color }: { id: string; name?: string; color?: string }) => {
      const patch: Record<string, string> = {};
      if (name !== undefined) patch.name = name.trim();
      if (color !== undefined) patch.color = color;
      const { error } = await (supabase as any).from("calendar_categories").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["calendar-categories"] }),
    onError: (e: Error) => toast.error("No se pudo actualizar: " + e.message),
  });
}

export function useDeleteCalendarCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("calendar_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-categories"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-event-tags"] });
      toast.success("Categoría eliminada");
    },
    onError: (e: Error) => toast.error("No se pudo eliminar: " + e.message),
  });
}

/** Etiquetas del usuario: mapa event_id → category_id[]. */
export function useEventTags() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["calendar-event-tags"],
    queryFn: async (): Promise<Record<string, string[]>> => {
      const { data, error } = await (supabase as any)
        .from("calendar_event_tags")
        .select("event_id, category_id");
      if (error) throw error;
      const map: Record<string, string[]> = {};
      for (const row of (data ?? []) as Array<{ event_id: string; category_id: string }>) {
        (map[row.event_id] ||= []).push(row.category_id);
      }
      return map;
    },
    enabled: !!user,
    staleTime: 30 * 1000,
  });
}

export function useToggleEventTag() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ eventId, categoryId, active }: { eventId: string; categoryId: string; active: boolean }) => {
      if (active) {
        const { error } = await (supabase as any)
          .from("calendar_event_tags")
          .insert({ user_id: user!.id, event_id: eventId, category_id: categoryId });
        // Ignora violación de unicidad (ya existía).
        if (error && !String(error.message || "").includes("duplicate")) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("calendar_event_tags")
          .delete()
          .eq("user_id", user!.id)
          .eq("event_id", eventId)
          .eq("category_id", categoryId);
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["calendar-event-tags"] }),
    onError: (e: Error) => toast.error("No se pudo etiquetar: " + e.message),
  });
}
