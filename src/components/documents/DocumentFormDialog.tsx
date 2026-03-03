import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateDocument } from "@/hooks/useDocuments";
import { useClients } from "@/hooks/useClients";
import { useProjects } from "@/hooks/useProjects";
import { Upload, Link, FileText } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DocumentFormDialog({ open, onOpenChange }: Props) {
  const [tab, setTab] = useState<"file" | "dropbox">("file");
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dropboxUrl, setDropboxUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [documentType, setDocumentType] = useState("");

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (tab === "file" && !file) return;
    if (tab === "dropbox" && !dropboxUrl.trim()) return;
    if (!name.trim()) return;

    createDocument.mutate(
      {
        name: name.trim(),
        source: tab === "file" ? "supabase" : "dropbox",
        file: tab === "file" ? file! : undefined,
        external_path: tab === "dropbox" ? dropboxUrl.trim() : undefined,
        client_id: clientId || undefined,
        project_id: projectId || undefined,
        document_type: documentType || undefined,
      },
      {
        onSuccess: () => {
          onOpenChange(false);
          resetForm();
        },
      }
    );
  };

  const resetForm = () => {
    setName("");
    setFile(null);
    setDropboxUrl("");
    setClientId("");
    setProjectId("");
    setDocumentType("");
    setTab("file");
  };

  const filteredProjects = clientId
    ? projects?.filter((p: any) => p.client_id === clientId)
    : projects;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar documento</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "file" | "dropbox")}>
          <TabsList className="w-full">
            <TabsTrigger value="file" className="flex-1">
              <Upload className="h-4 w-4 mr-1.5" />
              Subir archivo
            </TabsTrigger>
            <TabsTrigger value="dropbox" className="flex-1">
              <Link className="h-4 w-4 mr-1.5" />
              Enlace de Dropbox
            </TabsTrigger>
          </TabsList>

          <form onSubmit={handleSubmit} className="space-y-4 mt-4">
            <TabsContent value="file" className="mt-0 space-y-4">
              <div>
                <Label>Archivo *</Label>
                <label className="cursor-pointer block">
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleFileChange}
                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
                  />
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
                        <span>Haz clic para seleccionar un archivo o foto</span>
                      </>
                    )}
                  </div>
                </label>
              </div>
            </TabsContent>

            <TabsContent value="dropbox" className="mt-0 space-y-4">
              <div>
                <Label>Enlace de Dropbox *</Label>
                <Input
                  value={dropboxUrl}
                  onChange={(e) => setDropboxUrl(e.target.value)}
                  placeholder="https://www.dropbox.com/..."
                  type="url"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Pega el enlace compartido de Dropbox para dar seguimiento al documento.
                </p>
              </div>
            </TabsContent>

            <div>
              <Label>Nombre del documento *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej: Contrato de servicios, Declaración ISR..."
                required
              />
            </div>

            <div>
              <Label>Tipo de documento</Label>
              <Input
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
                placeholder="Ej: Contrato, Factura, Acta constitutiva..."
              />
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
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createDocument.isPending || (!file && tab === "file") || (!dropboxUrl.trim() && tab === "dropbox") || !name.trim()}
              >
                {createDocument.isPending ? "Guardando..." : "Registrar documento"}
              </Button>
            </div>
          </form>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
