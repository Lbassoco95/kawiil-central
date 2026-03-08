import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const INTERNAL_PROCEDURES_PATH = "internal/procedures";

export function useInternalProcedures() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["internal-procedures"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("internal_procedures")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
}

export function useCreateInternalProcedure() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: { title: string; description?: string; file: File }) => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (!profile?.organization_id) throw new Error("Sin organización");

      const filePath = `${INTERNAL_PROCEDURES_PATH}/${Date.now()}_${input.file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(filePath, input.file);
      if (uploadError) throw uploadError;

      const { data, error } = await (supabase as any)
        .from("internal_procedures")
        .insert({
          organization_id: profile.organization_id,
          title: input.title,
          description: input.description || null,
          file_path: filePath,
          file_size: input.file.size,
          mime_type: input.file.type,
          uploaded_by: user!.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["internal-procedures"] });
      toast.success("Procedimiento subido");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteInternalProcedure() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (row: { id: string; file_path: string }) => {
      await supabase.storage.from("documents").remove([row.file_path]);
      const { error } = await (supabase as any).from("internal_procedures").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["internal-procedures"] });
      toast.success("Procedimiento eliminado");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useInternalComunicados() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["internal-comunicados"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("internal_comunicados")
        .select("*")
        .order("is_pinned", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });
}

export function useCreateInternalComunicado() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: { title: string; body?: string; is_pinned?: boolean }) => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (!profile?.organization_id) throw new Error("Sin organización");

      const { data, error } = await (supabase as any)
        .from("internal_comunicados")
        .insert({
          organization_id: profile.organization_id,
          title: input.title,
          body: input.body || null,
          is_pinned: input.is_pinned ?? false,
          created_by: user!.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["internal-comunicados"] });
      toast.success("Comunicado publicado");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteInternalComunicado() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("internal_comunicados").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["internal-comunicados"] });
      toast.success("Comunicado eliminado");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
