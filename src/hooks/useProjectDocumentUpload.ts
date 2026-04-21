import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { sanitizeStorageFileName } from "@/lib/storageFilename";
import { postProcessUploadedDocument } from "@/lib/fileIntake/zipUploadPipeline";
import { getZipIntakeMarker } from "@/lib/fileIntake/zipMarkers";
import { mimeTypeForFile } from "@/lib/mimeFromFilename";
import {
  filenameKey,
  nextDistinctFilename,
  fileWithName,
} from "@/lib/duplicateUpload";
import type { AiProjectDocument } from "@/hooks/useAiProjects";
import type { DuplicateResolutionChoice } from "@/components/shared/DuplicateFileResolutionDialog";
import { replaceSupabaseStoredDocumentFile } from "@/lib/supabaseDocumentReplace";

export function useProjectDocumentUpload(
  aiProjectId: string | null,
  projectDocs: AiProjectDocument[],
  duplicatePrompt: (fileName: string) => Promise<DuplicateResolutionChoice>
) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");

  const uploadToProject = useCallback(
    async (file: File) => {
      if (!user || !aiProjectId) {
        toast.error("Selecciona un proyecto primero");
        return;
      }

      let working = file;
      const nameSet = new Set(projectDocs.map((d) => filenameKey(d.name)));
      const existing = projectDocs.find(
        (d) => d.document_id && filenameKey(d.name) === filenameKey(working.name)
      );

      if (existing?.document_id) {
        const choice = await duplicatePrompt(working.name);
        if (choice === "skip") return;
        if (choice === "copy") {
          const nextName = nextDistinctFilename(working.name, nameSet);
          working = fileWithName(working, nextName);
        } else {
          setUploading(true);
          setProgress("Reemplazando documento...");
          try {
            const orgRes = await supabase.rpc("get_user_org_id", { _user_id: user.id });
            const orgId = orgRes.data as string;

            const docRowId = existing.document_id as string;
            await replaceSupabaseStoredDocumentFile({
              documentId: docRowId,
              file: working,
              pathDirectoryPrefix: `${orgId}/${aiProjectId}`,
            });

            await supabase
              .from("ai_project_documents")
              .update({ name: working.name })
              .eq("ai_project_id", aiProjectId)
              .eq("document_id", docRowId);

            setProgress("Procesando contenido...");
            await postProcessUploadedDocument(docRowId, working);
            if (getZipIntakeMarker(working)?.kind !== "server_deferred") {
              supabase.functions
                .invoke("process-document", { body: { document_id: docRowId } })
                .catch(() => {});
            }

            qc.invalidateQueries({ queryKey: ["ai-project-documents", aiProjectId] });
            toast.success(`"${working.name}" actualizado y procesándose`);
          } catch (e: any) {
            console.error("Replace upload error:", e);
            toast.error(e.message || "Error al reemplazar archivo");
          } finally {
            setUploading(false);
            setProgress("");
          }
          return;
        }
      }

      setUploading(true);
      setProgress("Subiendo archivo...");

      try {
        const orgRes = await supabase.rpc("get_user_org_id", { _user_id: user.id });
        const orgId = orgRes.data;

        const safeName = sanitizeStorageFileName(working.name);
        const filePath = `${orgId}/${aiProjectId}/${Date.now()}_${safeName}`;
        const { error: storageErr } = await supabase.storage
          .from("documents")
          .upload(filePath, working, { upsert: true });

        if (storageErr) throw new Error(`Upload failed: ${storageErr.message}`);

        setProgress("Registrando documento...");
        const mime = mimeTypeForFile(working);

        const { data: doc, error: docErr } = await (supabase as any)
          .from("documents")
          .insert({
            organization_id: orgId,
            name: working.name,
            file_path: filePath,
            file_size: working.size,
            mime_type: mime,
            source: "supabase",
            uploaded_by: user.id,
          })
          .select("id")
          .single();

        if (docErr) throw new Error(`Document record failed: ${docErr.message}`);

        await (supabase as any).from("ai_project_documents").insert({
          ai_project_id: aiProjectId,
          document_id: doc.id,
          name: working.name,
          source: "supabase",
        });

        setProgress("Procesando contenido...");

        await postProcessUploadedDocument(doc.id as string, working);
        if (getZipIntakeMarker(working)?.kind !== "server_deferred") {
          supabase.functions
            .invoke("process-document", {
              body: { document_id: doc.id },
            })
            .catch(() => {});
        }

        qc.invalidateQueries({ queryKey: ["ai-project-documents", aiProjectId] });
        toast.success(`"${working.name}" subido y procesándose`);
      } catch (e: any) {
        console.error("Upload error:", e);
        toast.error(e.message || "Error al subir archivo");
      } finally {
        setUploading(false);
        setProgress("");
      }
    },
    [user, aiProjectId, qc, projectDocs, duplicatePrompt]
  );

  return { uploadToProject, uploading, progress };
}
