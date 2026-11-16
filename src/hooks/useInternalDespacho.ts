import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { logEntityActivity } from "@/lib/activityLog";
import { sanitizeStorageFileName } from "@/lib/storageFilename";
import { hoyCDMX, type Comunicado } from "@/lib/comunicados";
import { archivarComunicado, descartarBorradorComunicado, publicarComunicado } from "@/lib/comunicadosApi";

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
    mutationFn: async (input: { title: string; description?: string; file: File; quiet?: boolean }) => {
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

      return { data, quiet: input.quiet };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["internal-procedures"] });
      queryClient.invalidateQueries({ queryKey: ["personal-rendimiento-hub-log"] });
      if (!result?.quiet) toast.success("Procedimiento subido");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}

export function useUploadNewVersion() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      procedureId: string;
      file: File;
      changeNotes?: string;
      currentVersion: number;
      quiet?: boolean;
    }) => {
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

      return { version: newVersion, quiet: input.quiet };
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["internal-procedures"] });
      queryClient.invalidateQueries({ queryKey: ["procedure-versions"] });
      queryClient.invalidateQueries({ queryKey: ["personal-rendimiento-hub-log"] });
      if (res && !res.quiet) {
        toast.success(`Versión ${res.version} subida`);
      }
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
    mutationFn: async (input: { title: string; body?: string; is_pinned?: boolean; vigente_desde?: string; vigente_hasta?: string; avisar_al_entrar?: boolean }) => {
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
          // Los campos de vigencia solo se envían cuando se usan: sin ellos, el formulario de siempre funciona igual aunque la base no tenga las columnas nuevas.
          ...(input.vigente_desde && input.vigente_hasta ? { vigente_desde: input.vigente_desde, vigente_hasta: input.vigente_hasta } : {}),
          ...(input.avisar_al_entrar ? { avisar_al_entrar: true } : {}),
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

/** Avisos que se muestran al abrir el sistema hoy (publicados, con «avisar al entrar» y vigentes). Si la base aún no tiene las columnas nuevas, no muestra nada y no molesta. */
export function useComunicadosAviso() {
  const { user } = useAuth();
  const hoy = hoyCDMX();
  return useQuery({
    queryKey: ["internal-comunicados", "aviso", hoy],
    queryFn: async (): Promise<Comunicado[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("internal_comunicados")
        .select("id, title, body, is_pinned, created_at, estado, vigente_desde, vigente_hasta, avisar_al_entrar")
        .eq("estado", "publicado").eq("avisar_al_entrar", true).lte("vigente_desde", hoy).gte("vigente_hasta", hoy);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Publicar (aprobar), retirar o descartar un comunicado. Solo Dirección: la base lo vuelve a comprobar. */
export function useGestionarComunicado() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (a: { accion: "publicar" | "archivar" | "descartar"; id: string }) => {
      const r = a.accion === "publicar" ? await publicarComunicado(a.id) : a.accion === "archivar" ? await archivarComunicado(a.id) : await descartarBorradorComunicado(a.id);
      if (!r.ok) throw new Error(r.error ?? "No se pudo completar la acción.");
      return a.accion;
    },
    onSuccess: (accion) => {
      queryClient.invalidateQueries({ queryKey: ["internal-comunicados"] });
      toast.success(accion === "publicar" ? "Comunicado publicado: el equipo lo verá en el sistema" : accion === "archivar" ? "Comunicado retirado" : "Borrador descartado");
    },
    onError: (e: Error) => toast.error(e.message),
  });
}
