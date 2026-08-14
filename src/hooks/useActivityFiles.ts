/**
 * Archivos (cotizaciones/diseños/muestras) de una actividad + votación.
 * Los archivos se guardan en el bucket privado `documents` (URL firmada);
 * en la BD solo vive la metadata. RLS acota por organización.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { sanitizeStorageFileName } from "@/lib/storageFilename";
import type { Tables } from "@/integrations/supabase/types";

export type ActivityFile = Tables<"activity_files">;

export type ActivityFileWithMeta = ActivityFile & {
  signedUrl: string | null;
  voteCount: number;
  votedByMe: boolean;
  isImage: boolean;
};

const BUCKET = "documents";

export function isImageMime(mime?: string | null, name?: string) {
  if (mime?.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(name ?? "");
}

export function useActivityFiles(activityId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["activity-files", activityId],
    queryFn: async (): Promise<ActivityFileWithMeta[]> => {
      const { data: files, error } = await supabase
        .from("activity_files")
        .select("*")
        .eq("activity_id", activityId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const list = (files ?? []) as ActivityFile[];
      if (list.length === 0) return [];

      const ids = list.map((f) => f.id);
      const { data: votes } = await supabase
        .from("activity_file_votes")
        .select("activity_file_id, user_id")
        .in("activity_file_id", ids);

      const paths = list.map((f) => f.file_path);
      let signedMap: Record<string, string> = {};
      if (paths.length > 0) {
        const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
        signedMap = Object.fromEntries(
          (signed ?? [])
            .filter((s) => s.signedUrl && s.path)
            .map((s) => [s.path as string, s.signedUrl as string]),
        );
      }

      return list.map((f) => {
        const fileVotes = (votes ?? []).filter((v) => v.activity_file_id === f.id);
        return {
          ...f,
          signedUrl: signedMap[f.file_path] ?? null,
          voteCount: fileVotes.length,
          votedByMe: fileVotes.some((v) => v.user_id === user?.id),
          isImage: isImageMime(f.mime_type, f.name),
        };
      });
    },
    enabled: !!user && !!activityId,
  });
}

export function useUploadActivityFile() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ activityId, file, kind }: { activityId: string; file: File; kind: string }) => {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      if (!orgId) throw new Error("No se encontró la organización del usuario.");
      const safe = sanitizeStorageFileName(file.name);
      const path = `${orgId}/${activityId}/${Date.now()}_${safe}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
      if (upErr) throw upErr;

      const { data, error } = await supabase
        .from("activity_files")
        .insert({
          activity_id: activityId,
          organization_id: orgId as string,
          kind,
          name: file.name,
          file_path: path,
          mime_type: file.type || null,
          file_size: file.size,
          uploaded_by: user!.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as ActivityFile;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["activity-files", data.activity_id] });
    },
    onError: (e: Error) => toast.error("Error al subir el archivo: " + e.message),
  });
}

export function useDeleteActivityFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file }: { file: ActivityFile }) => {
      await supabase.storage.from(BUCKET).remove([file.file_path]);
      const { error } = await supabase.from("activity_files").delete().eq("id", file.id);
      if (error) throw error;
      return file.id;
    },
    onSuccess: (_id, variables) => {
      queryClient.invalidateQueries({ queryKey: ["activity-files", variables.file.activity_id] });
    },
    onError: (e: Error) => toast.error("Error al eliminar el archivo: " + e.message),
  });
}

export function useToggleFileVote() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ file, votedByMe }: { file: ActivityFile; votedByMe: boolean }) => {
      if (votedByMe) {
        const { error } = await supabase
          .from("activity_file_votes")
          .delete()
          .eq("activity_file_id", file.id)
          .eq("user_id", user!.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("activity_file_votes")
          .insert({
            activity_file_id: file.id,
            organization_id: file.organization_id,
            user_id: user!.id,
          });
        if (error) throw error;
      }
      return file.id;
    },
    onSuccess: (_id, variables) => {
      queryClient.invalidateQueries({ queryKey: ["activity-files", variables.file.activity_id] });
    },
    onError: (e: Error) => toast.error("Error al votar: " + e.message),
  });
}
