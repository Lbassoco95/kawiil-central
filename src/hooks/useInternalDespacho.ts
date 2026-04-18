import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { logEntityActivity } from "@/lib/activityLog";
import { sanitizeStorageFileName } from "@/lib/storageFilename";

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

export function useProcedureVersions(procedureId: string | null) {
  return useQuery({
    queryKey: ["procedure-versions", procedureId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("procedure_versions")
        .select("*")
        .eq("procedure_id", procedureId)
        .order("version_number", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!procedureId,
  });
}

export function useProcedureComments(procedureId: string | null) {
  return useQuery({
    queryKey: ["procedure-comments", procedureId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("procedure_comments")
        .select("*")
        .eq("procedure_id", procedureId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!procedureId,
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

      const safeName = sanitizeStorageFileName(input.file.name);
      const filePath = `${INTERNAL_PROCEDURES_PATH}/${Date.now()}_${safeName}`;
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
          current_version: 2,
        })
        .select()
        .single();
      if (error) throw error;

      // Create version 2 entry (initial upload)
      await (supabase as any).from("procedure_versions").insert({
        procedure_id: data.id,
        version_number: 2,
        file_path: filePath,
        file_size: input.file.size,
        mime_type: input.file.type,
        uploaded_by: user!.id,
        change_notes: "Versión inicial",
      });

      void logEntityActivity(user!.id, profile.organization_id, {
        entityType: "hub",
        entityId: data.id,
        action: "hub_procedure_created",
        details: { title: data.title },
      });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["internal-procedures"] });
      queryClient.invalidateQueries({ queryKey: ["personal-rendimiento-hub-log"] });
      toast.success("Procedimiento subido");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUploadNewVersion() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: { procedureId: string; file: File; changeNotes?: string; currentVersion: number }) => {
      const newVersion = input.currentVersion + 1;
      const safeName = sanitizeStorageFileName(input.file.name);
      const filePath = `${INTERNAL_PROCEDURES_PATH}/${Date.now()}_v${newVersion}_${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(filePath, input.file);
      if (uploadError) throw uploadError;

      // Insert version record
      await (supabase as any).from("procedure_versions").insert({
        procedure_id: input.procedureId,
        version_number: newVersion,
        file_path: filePath,
        file_size: input.file.size,
        mime_type: input.file.type,
        uploaded_by: user!.id,
        change_notes: input.changeNotes || null,
      });

      // Update procedure to point to new version
      await (supabase as any)
        .from("internal_procedures")
        .update({
          file_path: filePath,
          file_size: input.file.size,
          mime_type: input.file.type,
          current_version: newVersion,
        })
        .eq("id", input.procedureId);

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (profile?.organization_id) {
        void logEntityActivity(user!.id, profile.organization_id, {
          entityType: "hub",
          entityId: input.procedureId,
          action: "hub_procedure_version",
          details: { version: newVersion },
        });
      }

      return newVersion;
    },
    onSuccess: (version) => {
      queryClient.invalidateQueries({ queryKey: ["internal-procedures"] });
      queryClient.invalidateQueries({ queryKey: ["procedure-versions"] });
      queryClient.invalidateQueries({ queryKey: ["personal-rendimiento-hub-log"] });
      toast.success(`Versión ${version} subida`);
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useCreateProcedureComment() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: { procedureId: string; content: string }) => {
      const { data, error } = await (supabase as any)
        .from("procedure_comments")
        .insert({
          procedure_id: input.procedureId,
          user_id: user!.id,
          content: input.content,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["procedure-comments", vars.procedureId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteProcedureComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; procedureId: string }) => {
      const { error } = await (supabase as any).from("procedure_comments").delete().eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["procedure-comments", vars.procedureId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useDeleteInternalProcedure() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (row: { id: string; file_path: string }) => {
      // Get all version file paths to delete from storage
      const { data: versions } = await (supabase as any)
        .from("procedure_versions")
        .select("file_path")
        .eq("procedure_id", row.id);

      const filePaths = [row.file_path, ...(versions || []).map((v: any) => v.file_path)];
      const uniquePaths = [...new Set(filePaths)];
      await supabase.storage.from("documents").remove(uniquePaths);

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

      void logEntityActivity(user!.id, profile.organization_id, {
        entityType: "hub",
        entityId: data.id,
        action: "hub_comunicado_created",
        details: { title: data.title },
      });

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["internal-comunicados"] });
      queryClient.invalidateQueries({ queryKey: ["personal-rendimiento-hub-log"] });
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
