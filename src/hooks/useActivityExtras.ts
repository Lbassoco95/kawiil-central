/**
 * Hooks de asistentes y proveedores de una actividad (Fase 2 del módulo).
 * RLS acota las filas a la organización del usuario automáticamente.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type ActivityAttendee = Tables<"activity_attendees">;
export type ActivityProvider = Tables<"activity_providers">;

export type ActivityAttendeeCreateInput = Omit<
  TablesInsert<"activity_attendees">,
  "organization_id" | "created_by" | "id" | "created_at" | "updated_at"
>;
export type ActivityProviderCreateInput = Omit<
  TablesInsert<"activity_providers">,
  "organization_id" | "created_by" | "id" | "created_at" | "updated_at"
>;

async function getOrgId(userId: string): Promise<string> {
  const { data: orgId, error } = await supabase.rpc("get_user_org_id", { _user_id: userId });
  if (error) throw error;
  if (!orgId) throw new Error("No se encontró la organización del usuario.");
  return orgId as string;
}

// ─── Asistentes ─────────────────────────────────────────────────────────────
export function useActivityAttendees(activityId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["activity-attendees", activityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_attendees")
        .select("*")
        .eq("activity_id", activityId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as ActivityAttendee[];
    },
    enabled: !!user && !!activityId,
  });
}

export function useCreateActivityAttendee() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: ActivityAttendeeCreateInput) => {
      const organization_id = await getOrgId(user!.id);
      const { data, error } = await supabase
        .from("activity_attendees")
        .insert({ ...input, organization_id, created_by: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data as ActivityAttendee;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["activity-attendees", data.activity_id] });
    },
    onError: (e: Error) => toast.error("Error al agregar asistente: " + e.message),
  });
}

export function useUpdateActivityAttendee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: TablesUpdate<"activity_attendees"> & { id: string }) => {
      const { data, error } = await supabase
        .from("activity_attendees")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as ActivityAttendee;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["activity-attendees", data.activity_id] });
    },
    onError: (e: Error) => toast.error("Error al actualizar asistente: " + e.message),
  });
}

export function useDeleteActivityAttendee() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; activityId: string }) => {
      const { error } = await supabase.from("activity_attendees").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (_id, variables) => {
      queryClient.invalidateQueries({ queryKey: ["activity-attendees", variables.activityId] });
    },
    onError: (e: Error) => toast.error("Error al eliminar asistente: " + e.message),
  });
}

// ─── Proveedores ────────────────────────────────────────────────────────────
export function useActivityProviders(activityId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["activity-providers", activityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_providers")
        .select("*")
        .eq("activity_id", activityId!)
        .order("category", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as ActivityProvider[];
    },
    enabled: !!user && !!activityId,
  });
}

export function useCreateActivityProvider() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: ActivityProviderCreateInput) => {
      const organization_id = await getOrgId(user!.id);
      const { data, error } = await supabase
        .from("activity_providers")
        .insert({ ...input, organization_id, created_by: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data as ActivityProvider;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["activity-providers", data.activity_id] });
    },
    onError: (e: Error) => toast.error("Error al agregar proveedor: " + e.message),
  });
}

export function useUpdateActivityProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: TablesUpdate<"activity_providers"> & { id: string }) => {
      const { data, error } = await supabase
        .from("activity_providers")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as ActivityProvider;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["activity-providers", data.activity_id] });
    },
    onError: (e: Error) => toast.error("Error al actualizar proveedor: " + e.message),
  });
}

export function useDeleteActivityProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; activityId: string }) => {
      const { error } = await supabase.from("activity_providers").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: (_id, variables) => {
      queryClient.invalidateQueries({ queryKey: ["activity-providers", variables.activityId] });
    },
    onError: (e: Error) => toast.error("Error al eliminar proveedor: " + e.message),
  });
}
