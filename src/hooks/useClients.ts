import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";
import { toast } from "sonner";

export type Client = Tables<"clients">;
export type ClientInsert = TablesInsert<"clients">;

export function useClients() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Client[];
    },
    enabled: !!user,
  });
}

export function useCreateClient() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (client: Omit<ClientInsert, "organization_id" | "created_by">) => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", {
        _user_id: user!.id,
      });

      const { data, error } = await supabase
        .from("clients")
        .insert({
          ...client,
          organization_id: orgId!,
          created_by: user!.id,
          dropbox_folder_path: client.dropbox_folder_path || null,
        })
        .select()
        .single();

      if (error) throw error;

      // Auto-create projects based on contracted services
      const services = client.services || [];
      if (data) {
        const projectsToCreate: Array<{ name: string; area: string }> = [];

        // Contabilidad project for backoffice/softlanding
        if (services.includes("contabilidad") || services.includes("softlanding")) {
          projectsToCreate.push({
            name: `Contabilidad - ${data.name}`,
            area: services.includes("softlanding") ? "softlanding" : "contabilidad",
          });
        }

        // Legal project for backoffice/softlanding
        if (services.includes("legal")) {
          projectsToCreate.push({
            name: `Legal - ${data.name}`,
            area: "legal",
          });
        }

        // Compliance project for PLD/FT
        if (services.includes("pld_ft")) {
          projectsToCreate.push({
            name: `Cumplimiento PLD/FT - ${data.name}`,
            area: "pld_ft",
          });
        }

        for (const proj of projectsToCreate) {
          const { error: projectError } = await supabase
            .from("projects")
            .insert({
              name: proj.name,
              client_id: data.id,
              area: proj.area,
              organization_id: orgId!,
              created_by: user!.id,
              responsible_user_id: client.responsible_user_id || user!.id,
              tax_obligations: [],
            } as any);
          if (projectError) {
            console.error(`Error creating auto project (${proj.area}):`, projectError);
          }
        }
      }

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Cliente creado exitosamente");
    },
    onError: (error) => {
      toast.error("Error al crear cliente: " + error.message);
    },
  });
}

export function useDeleteClient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("clients").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Cliente eliminado");
    },
    onError: (error) => toast.error("Error al eliminar cliente: " + error.message),
  });
}

export function useOrgProfiles() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["org-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("is_active", true)
        .order("full_name");

      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });
}
