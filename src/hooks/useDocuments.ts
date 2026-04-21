import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Json, Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { sanitizeStorageFileName } from "@/lib/storageFilename";

export type Document = Tables<"documents"> & {
  clients?: { name: string } | null;
  projects?: { name: string } | null;
  uploader_profile?: { full_name: string } | null;
};

export function useDocuments(filters?: { search?: string; source?: string }) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["documents", filters],
    queryFn: async () => {
      let query = supabase
        .from("documents")
        .select("*, clients(name), projects(name)")
        .order("created_at", { ascending: false });

      if (filters?.search) {
        query = query.ilike("name", `%${filters.search}%`);
      }
      if (filters?.source && filters.source !== "all") {
        query = query.eq("source", filters.source as any);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Fetch uploader profiles
      const uploaderIds = [...new Set(data.filter(d => d.uploaded_by).map(d => d.uploaded_by!))];
      let profiles: any[] = [];
      if (uploaderIds.length > 0) {
        const { data: p } = await supabase
          .from("profiles")
          .select("user_id, full_name")
          .in("user_id", uploaderIds);
        profiles = p ?? [];
      }

      return data.map(doc => ({
        ...doc,
        uploader_profile: profiles.find(p => p.user_id === doc.uploaded_by) ?? null,
      })) as Document[];
    },
    enabled: !!user,
  });
}

export function useCreateDocument() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      source: "supabase" | "dropbox";
      file?: File;
      external_path?: string;
      client_id?: string;
      project_id?: string;
      document_type?: string;
      tags?: string[];
      metadata?: Json;
    }) => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (!profile) throw new Error("No profile found");

      let filePath: string | null = null;
      let fileSize: number | null = null;
      let mimeType: string | null = null;

      if (input.source === "supabase" && input.file) {
        const safeName = sanitizeStorageFileName(input.file.name);
        filePath = `documents/${Date.now()}_${safeName}`;
        fileSize = input.file.size;
        mimeType = input.file.type || null;
        if (!mimeType && input.file.name.toLowerCase().endsWith(".zip")) {
          mimeType = "application/zip";
        }

        const { error: uploadError } = await supabase.storage
          .from("documents")
          .upload(filePath, input.file);
        if (uploadError) throw uploadError;
      }

      const { data, error } = await supabase
        .from("documents")
        .insert({
          name: input.name,
          source: input.source,
          file_path: filePath,
          file_size: fileSize,
          mime_type: mimeType,
          external_path: input.external_path ?? null,
          client_id: input.client_id || null,
          project_id: input.project_id || null,
          document_type: input.document_type || null,
          tags: input.tags ?? [],
          organization_id: profile.organization_id,
          uploaded_by: user!.id,
          metadata: input.metadata ?? {},
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Documento registrado exitosamente");
    },
    onError: (err: Error) => {
      toast.error("Error al registrar documento: " + err.message);
    },
  });
}

export function useUpdateDocumentMeta() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      document_type?: string | null;
      tags?: string[];
    }) => {
      const patch: Record<string, unknown> = {};
      if (input.document_type !== undefined) patch.document_type = input.document_type;
      if (input.tags !== undefined) patch.tags = input.tags;
      const { data, error } = await supabase
        .from("documents")
        .update(patch as never)
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (err: Error) => {
      toast.error("No se pudo actualizar el documento: " + err.message);
    },
  });
}

export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (doc: { id: string; source: string; file_path: string | null }) => {
      // Delete file from storage if it's a supabase file
      if (doc.source === "supabase" && doc.file_path) {
        await supabase.storage.from("documents").remove([doc.file_path]);
      }
      const { error } = await supabase.from("documents").delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Documento eliminado");
    },
    onError: (err: Error) => {
      toast.error("Error al eliminar documento: " + err.message);
    },
  });
}
