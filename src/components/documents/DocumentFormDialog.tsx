import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateDocument } from "@/hooks/useDocuments";
import { useClients } from "@/hooks/useClients";
import { useProjects } from "@/hooks/useProjects";
import { supabase } from "@/integrations/supabase/client";
import { uploadFileToDropbox } from "@/lib/dropboxUpload";
import { toast } from "sonner";
import { Upload, FileText, Loader2, Cloud, HardDrive } from "lucide-react";

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      if (!name) setName(selected.name);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !name.trim()) return;
    setSubmitting(true);

    let dropboxUrl = "";
    let dropboxFailed = false;

    // 1) Try uploading to Dropbox first
    try {
      const selectedClient = clients?.find((c) => c.id === clientId);
      const basePath = selectedClient?.dropbox_folder_path || "/Kawiil Mx/DOCUMENTOS";
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
    createDocument.mutate(
      {
        name: name.trim(),
        source: dropboxUrl ? "dropbox" : "supabase",
        file: file,
        external_path: dropboxUrl || undefined,
        client_id: clientId || undefined,
        project_id: projectId || undefined,
        document_type: documentType || undefined,
      },
      {
        onSuccess: () => {
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
            <label className="cursor-pointer block">
              <input type="file" className="hidden" onChange={handleFileChange}
                accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.xml" />
              <div className="flex items-center gap-3 p-4 border-2 border-dashed rounded-md text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors">
                {file ? (
                  <>
                    <FileText className="h-5 w-5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium text-foreground">{file.name}</p>
                      <p className="text-xs">{(file.size / 1024).toFixed(0)} KB</p>
                    </div>
                  </>
                ) : (
                  <>
                    <Upload className="h-5 w-5" />
                    <span>Haz clic para seleccionar un archivo</span>
                  </>
                )}
              </div>
            </label>
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
              <Select value={clientId} onValueChange={(v) => setClientId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin cliente</SelectItem>
                  {clients?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Proyecto</Label>
              <Select value={projectId} onValueChange={(v) => setProjectId(v === "__none__" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Sin proyecto</SelectItem>
                  {filteredProjects?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
