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
        })
        .select()
        .single();

      if (error) throw error;

      // Auto-create accounting project for softlanding/backoffice clients
      const services = client.services || [];
      const hasAccounting = services.includes("softlanding") || services.includes("contabilidad");
      if (hasAccounting && data) {
        const area = services.includes("softlanding") ? "softlanding" : "contabilidad";
        const projectName = `Contabilidad - ${data.name}`;
        const { error: projectError } = await supabase
          .from("projects")
          .insert({
            name: projectName,
            client_id: data.id,
            area,
            organization_id: orgId!,
            created_by: user!.id,
            responsible_user_id: client.responsible_user_id || user!.id,
            tax_obligations: [],
          } as any);
        if (projectError) {
          console.error("Error creating auto project:", projectError);
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
