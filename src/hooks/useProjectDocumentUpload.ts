import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function useProjectDocumentUpload(aiProjectId: string | null) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");

  const uploadToProject = useCallback(async (file: File) => {
    if (!user || !aiProjectId) {
      toast.error("Selecciona un proyecto primero");
      return;
    }

    setUploading(true);
    setProgress("Subiendo archivo...");

    try {
      const orgRes = await supabase.rpc("get_user_org_id", { _user_id: user.id });
      const orgId = orgRes.data;

      const filePath = `${orgId}/${aiProjectId}/${Date.now()}_${file.name}`;
      const { error: storageErr } = await supabase.storage
        .from("documents")
        .upload(filePath, file, { upsert: true });

      if (storageErr) throw new Error(`Upload failed: ${storageErr.message}`);

      setProgress("Registrando documento...");

      const { data: doc, error: docErr } = await (supabase as any)
        .from("documents")
        .insert({
          organization_id: orgId,
          name: file.name,
          file_path: filePath,
          file_size: file.size,
          mime_type: file.type,
          source: "supabase",
          uploaded_by: user.id,
        })
        .select("id")
        .single();

      if (docErr) throw new Error(`Document record failed: ${docErr.message}`);

      await (supabase as any)
        .from("ai_project_documents")
        .insert({
          ai_project_id: aiProjectId,
          document_id: doc.id,
          name: file.name,
          source: "supabase",
        });

      setProgress("Procesando contenido...");

      supabase.functions.invoke("process-document", {
        body: { document_id: doc.id },
      }).catch(() => {});

      qc.invalidateQueries({ queryKey: ["ai-project-documents", aiProjectId] });
      toast.success(`"${file.name}" subido y procesándose`);
    } catch (e: any) {
      console.error("Upload error:", e);
      toast.error(e.message || "Error al subir archivo");
    } finally {
      setUploading(false);
      setProgress("");
    }
  }, [user, aiProjectId, qc]);

  return { uploadToProject, uploading, progress };
}
