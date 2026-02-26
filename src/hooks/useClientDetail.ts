import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";

export type Client = Tables<"clients">;
export type Project = Tables<"projects">;
export type Task = Tables<"tasks">;

export function useClientDetail(clientId: string | undefined) {
  const { user } = useAuth();

  const clientQuery = useQuery({
    queryKey: ["client", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("id", clientId!)
        .single();
      if (error) throw error;
      return data as Client;
    },
    enabled: !!user && !!clientId,
  });

  const projectsQuery = useQuery({
    queryKey: ["client-projects", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
    enabled: !!user && !!clientId,
  });

  const tasksQuery = useQuery({
    queryKey: ["client-tasks", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Task[];
    },
    enabled: !!user && !!clientId,
  });

  const documentsQuery = useQuery({
    queryKey: ["client-documents", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("client_id", clientId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!clientId,
  });

  return {
    client: clientQuery.data,
    isLoadingClient: clientQuery.isLoading,
    projects: projectsQuery.data ?? [],
    tasks: tasksQuery.data ?? [],
    documents: documentsQuery.data ?? [],
  };
}
