import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { DocStatus, EmployeeDocument, EmployeeProfile } from "@/lib/expediente";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const BUCKET = "expedientes";

async function getMyOrgId(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("profiles")
    .select("organization_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data?.organization_id) throw new Error("No se pudo determinar tu organización.");
  return data.organization_id as string;
}

/* ---------------- Datos estructurados ---------------- */
export function useEmployeeProfile(userId: string | null) {
  return useQuery({
    queryKey: ["rh-employee-profile", userId],
    queryFn: async (): Promise<EmployeeProfile | null> => {
      const { data, error } = await db
        .from("rh_employee_profile")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return (data as EmployeeProfile) ?? null;
    },
    enabled: !!userId,
  });
}

export function useUpsertEmployeeProfile() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<EmployeeProfile>) => {
      const orgId = await getMyOrgId(user!.id);
      const { error } = await db
        .from("rh_employee_profile")
        .upsert(
          { ...patch, user_id: user!.id, organization_id: orgId, updated_at: new Date().toISOString() },
          { onConflict: "user_id" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-employee-profile", user?.id] });
      toast.success("Datos guardados");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudieron guardar los datos"),
  });
}

/* ---------------- Documentos ---------------- */
export function useEmployeeDocuments(userId: string | null) {
  return useQuery({
    queryKey: ["rh-employee-docs", userId],
    queryFn: async (): Promise<EmployeeDocument[]> => {
      const { data, error } = await db
        .from("rh_employee_documents")
        .select("*")
        .eq("user_id", userId);
      if (error) throw error;
      return (data as EmployeeDocument[]) ?? [];
    },
    enabled: !!userId,
  });
}

export function useUploadEmployeeDocument() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ docType, file }: { docType: string; file: File }) => {
      const orgId = await getMyOrgId(user!.id);
      const ext = file.name.split(".").pop()?.toLowerCase() || "pdf";
      const path = `${orgId}/${user!.id}/${docType}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type || undefined });
      if (upErr) throw upErr;
      // Al resubir, el documento vuelve a "en revisión".
      const { error } = await db.from("rh_employee_documents").upsert(
        {
          organization_id: orgId,
          user_id: user!.id,
          doc_type: docType,
          file_path: path,
          file_name: file.name,
          status: "uploaded",
          note: null,
          verified_by: null,
          verified_at: null,
          uploaded_at: new Date().toISOString(),
        },
        { onConflict: "user_id,doc_type" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-employee-docs", user?.id] });
      qc.invalidateQueries({ queryKey: ["rh-expedientes-overview"] });
      toast.success("Documento cargado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo cargar el documento"),
  });
}

export function useDeleteEmployeeDocument() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (doc: EmployeeDocument) => {
      await supabase.storage.from(BUCKET).remove([doc.file_path]);
      const { error } = await db.from("rh_employee_documents").delete().eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rh-employee-docs", user?.id] });
      qc.invalidateQueries({ queryKey: ["rh-expedientes-overview"] });
      toast.success("Documento eliminado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo eliminar"),
  });
}

/* ---------------- G4: verificación y vista de equipo ---------------- */
export function useVerifyDocument() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ doc, status, note }: { doc: EmployeeDocument; status: DocStatus; note?: string | null }) => {
      const { error } = await db
        .from("rh_employee_documents")
        .update({
          status,
          note: note ?? null,
          verified_by: user!.id,
          verified_at: new Date().toISOString(),
        })
        .eq("id", doc.id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["rh-employee-docs", vars.doc.user_id] });
      qc.invalidateQueries({ queryKey: ["rh-expedientes-overview"] });
      toast.success("Documento actualizado");
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo actualizar"),
  });
}

/** Resumen para G4: todos los documentos de expediente de la organización. */
export function useExpedientesOverview(enabled: boolean) {
  return useQuery({
    queryKey: ["rh-expedientes-overview"],
    queryFn: async (): Promise<EmployeeDocument[]> => {
      const { data, error } = await db.from("rh_employee_documents").select("*");
      if (error) throw error;
      return (data as EmployeeDocument[]) ?? [];
    },
    enabled,
  });
}

/** URL firmada temporal para ver/descargar un documento. */
export async function getExpedienteSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
  if (error) return null;
  return data?.signedUrl ?? null;
}
