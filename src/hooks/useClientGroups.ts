import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface ClientGroup {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
}

export interface ClientGroupMember {
  id: string;
  group_id: string;
  client_id: string;
  created_at: string;
}

export function useClientGroups() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["client-groups"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_groups" as any)
        .select("*")
        .order("name");
      if (error) throw error;
      return (data || []) as ClientGroup[];
    },
    enabled: !!user,
  });
}

export function useClientGroupMembers(groupId: string | undefined) {
  return useQuery({
    queryKey: ["client-group-members", groupId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_group_members" as any)
        .select("*")
        .eq("group_id", groupId!);
      if (error) throw error;
      return (data || []) as ClientGroupMember[];
    },
    enabled: !!groupId,
  });
}

export function useClientGroupsForClient(clientId: string | undefined) {
  return useQuery({
    queryKey: ["client-groups-for-client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("client_group_members" as any)
        .select("group_id")
        .eq("client_id", clientId!);
      if (error) return [];
      const groupIds = (data || []).map((d: any) => d.group_id);
      if (groupIds.length === 0) return [];
      const { data: groups, error: gErr } = await supabase
        .from("client_groups" as any)
        .select("*")
        .in("id", groupIds);
      if (gErr) return [];
      return (groups || []) as ClientGroup[];
    },
    enabled: !!clientId,
  });
}

export function useCreateClientGroup() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ name, description }: { name: string; description?: string }) => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      const { data, error } = await supabase
        .from("client_groups" as any)
        .insert({ name, description: description || null, organization_id: orgId!, created_by: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data as ClientGroup;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-groups"] });
      toast.success("Grupo creado");
    },
    onError: (e: Error) => toast.error("Error: " + e.message),
  });
}

export function useAddClientToGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ groupId, clientId }: { groupId: string; clientId: string }) => {
      const { error } = await supabase
        .from("client_group_members" as any)
        .insert({ group_id: groupId, client_id: clientId });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["client-group-members", vars.groupId] });
      queryClient.invalidateQueries({ queryKey: ["client-groups-for-client", vars.clientId] });
      queryClient.invalidateQueries({ queryKey: ["client-groups"] });
    },
    onError: (e: Error) => toast.error("Error: " + e.message),
  });
}

export function useRemoveClientFromGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ groupId, clientId }: { groupId: string; clientId: string }) => {
      const { error } = await supabase
        .from("client_group_members" as any)
        .delete()
        .eq("group_id", groupId)
        .eq("client_id", clientId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["client-group-members", vars.groupId] });
      queryClient.invalidateQueries({ queryKey: ["client-groups-for-client", vars.clientId] });
      queryClient.invalidateQueries({ queryKey: ["client-groups"] });
    },
    onError: (e: Error) => toast.error("Error: " + e.message),
  });
}

export function useDeleteClientGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (groupId: string) => {
      const { error } = await supabase
        .from("client_groups" as any)
        .delete()
        .eq("id", groupId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["client-groups"] });
      toast.success("Grupo eliminado");
    },
    onError: (e: Error) => toast.error("Error: " + e.message),
  });
}
