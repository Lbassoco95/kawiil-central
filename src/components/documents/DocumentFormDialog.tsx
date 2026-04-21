import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { useCreateDocument } from "@/hooks/useDocuments";
import { useClients } from "@/hooks/useClients";
import { useProjects } from "@/hooks/useProjects";
import { ACCEPTED_DOCUMENT_EXTENSIONS } from "@/lib/documentTypes";
import { uploadFileToDropbox } from "@/lib/dropboxUpload";
import { kawiilTeamPath } from "@/lib/dropboxConfig";
import { toast } from "sonner";
import { Loader2, Cloud, HardDrive } from "lucide-react";
import type { Json } from "@/integrations/supabase/types";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { documentsLimits, withLimits } from "@/lib/fileIntake/limits";
import { getZipIntakeMarker } from "@/lib/fileIntake/zipMarkers";
import { postProcessUploadedDocument } from "@/lib/fileIntake/zipUploadPipeline";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DocumentFormDialog({ open, onOpenChange }: Props) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const createDocument = useCreateDocument();
  const { data: clients } = useClients();
  const { data: projects } = useProjects();

  const dropzoneFiles = file ? [file] : [];
  const handleDropzoneChange = (next: File[]) => {
    const selected = next[0] ?? null;
    setFile(selected);
    if (selected && !name) setName(selected.name);
  };
  const MB = 1024 * 1024;
  const dropzoneLimits = withLimits(documentsLimits, {
    accept: ACCEPTED_DOCUMENT_EXTENSIONS,
    maxFiles: 1,
    maxBatchBytes: 52 * MB,
    maxZipEntriesForClientExpand: 0,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !name.trim()) return;
    setSubmitting(true);

    let dropboxUrl = "";
    let dropboxFailed = false;

    // 1) Try uploading to Dropbox first
    try {
      const selectedClient = clients?.find((c) => c.id === clientId);
      const basePath = selectedClient?.dropbox_folder_path || kawiilTeamPath("DOCUMENTOS");
      const uploadPath = `${basePath}/${file.name}`;

      const result = await uploadFileToDropbox(file, uploadPath);
      dropboxUrl = result.url;
      toast.success("Archivo subido a Dropbox", { duration: 2000 });
    } catch (err: any) {
      dropboxFailed = true;
      console.warn("Dropbox upload failed, saving locally:", err.message);
      toast.warning("No se pudo subir a Dropbox. Se guardará localmente.", { duration: 4000 });
    }

    // 2) Always save in the app (local storage + DB record)
    const zm = file ? getZipIntakeMarker(file) : undefined;
    const zipMeta: Json | undefined =
      zm?.kind === "server_deferred" ? { zip_container: true } : undefined;

    createDocument.mutate(
      {
        name: name.trim(),
        source: dropboxUrl ? "dropbox" : "supabase",
        file: file,
        external_path: dropboxUrl || undefined,
        client_id: clientId || undefined,
        project_id: projectId || undefined,
        document_type: documentType || undefined,
        metadata: zipMeta,
      },
      {
        onSuccess: async (data) => {
          if (file && data.source === "supabase") {
            await postProcessUploadedDocument(data.id, file);
          }
          onOpenChange(false);
          resetForm();
          if (!dropboxFailed) {
            toast.success("Documento guardado en Dropbox y en la aplicación");
          }
        },
        onSettled: () => setSubmitting(false),
      }
    );
  };

  const resetForm = () => {
    setName("");
    setFile(null);
    setClientId("");
    setProjectId("");
    setDocumentType("");
  };

  const filteredProjects = clientId
    ? projects?.filter((p: any) => p.client_id === clientId)
    : projects;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Subir documento</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          {/* Upload info */}
          <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Cloud className="h-3.5 w-3.5 text-primary" />
              <span>Se sube a Dropbox</span>
            </div>
            <span>+</span>
            <div className="flex items-center gap-1.5">
              <HardDrive className="h-3.5 w-3.5 text-primary" />
              <span>Respaldo local</span>
            </div>
          </div>

          {/* File picker */}
          <div>
            <Label>Archivo *</Label>
            <p className="text-xs text-muted-foreground mb-1">
              PDF, Word (.doc, .docx), texto (.txt, .csv, .md), Excel, PowerPoint o imágenes
            </p>
            <FileDropzone
              files={dropzoneFiles}
              onChange={handleDropzoneChange}
              limits={dropzoneLimits}
              variant="area"
              showSize
              hint="Arrastra el archivo aqui o haz click"
              subhint="Un archivo a la vez"
            />
          </div>

          <div>
            <Label>Nombre del documento *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Contrato de servicios, Declaración ISR..." required />
          </div>

          <div>
            <Label>Tipo de documento</Label>
            <Input value={documentType} onChange={(e) => setDocumentType(e.target.value)}
              placeholder="Ej: Contrato, Factura, Acta constitutiva..." />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Cliente</Label>
              <SearchableSelect
                options={(clients || []).map((c) => ({ value: c.id, label: c.name }))}
                value={clientId}
                onValueChange={setClientId}
                placeholder="Opcional"
                searchPlaceholder="Buscar cliente..."
                emptyLabel="Sin cliente"
              />
            </div>
            <div>
              <Label>Proyecto</Label>
              <SearchableSelect
                options={(filteredProjects || []).map((p: any) => ({ value: p.id, label: p.name }))}
                value={projectId}
                onValueChange={setProjectId}
                placeholder="Opcional"
                searchPlaceholder="Buscar proyecto..."
                emptyLabel="Sin proyecto"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={submitting || !file || !name.trim()}>
              {submitting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Subiendo...</>
              ) : (
                "Subir documento"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
