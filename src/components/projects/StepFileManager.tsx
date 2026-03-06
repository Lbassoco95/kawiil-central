import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDateMX } from "@/lib/dateUtils";

interface Props {
  documentIds: string[];
  onDocumentAdded: (updatedIds: string[]) => void;
  projectId: string;
  disabled?: boolean;
}

export function StepFileManager({ documentIds, onDocumentAdded, projectId, disabled }: Props) {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: documents = [] } = useQuery({
    queryKey: ["step-docs", ...documentIds],
    queryFn: async () => {
      if (documentIds.length === 0) return [];
      const { data, error } = await supabase
        .from("documents")
        .select("id, name, mime_type, created_at")
        .in("id", documentIds);
      if (error) throw error;
      return data;
    },
    enabled: documentIds.length > 0,
  });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user.id });
      const path = `${orgId}/${projectId}/${Date.now()}_${file.name}`;
      const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
      if (upErr) throw upErr;
      const { data: doc, error: docErr } = await supabase
        .from("documents")
        .insert({
          name: file.name,
          file_path: path,
          mime_type: file.type,
          file_size: file.size,
          organization_id: orgId!,
          project_id: projectId,
          uploaded_by: user.id,
          source: "supabase" as const,
        })
        .select()
        .single();
      if (docErr) throw docErr;
      onDocumentAdded([...documentIds, doc.id]);
      toast.success(`"${file.name}" subido`);
    } catch (err: any) {
      toast.error("Error: " + err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">Archivos</label>
        <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} />
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          disabled={uploading || disabled}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          Subir
        </Button>
      </div>
      {documents.length > 0 ? (
        <div className="space-y-1">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-xs bg-background border border-border/50"
            >
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate flex-1">{doc.name}</span>
              <span className="text-muted-foreground shrink-0">{formatDateMX(doc.created_at)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">Sin archivos adjuntos</p>
      )}
    </div>
  );
}
