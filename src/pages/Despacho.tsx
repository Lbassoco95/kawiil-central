import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  useInternalProcedures,
  useCreateInternalProcedure,
  useDeleteInternalProcedure,
  useInternalComunicados,
  useCreateInternalComunicado,
  useDeleteInternalComunicado,
} from "@/hooks/useInternalDespacho";
import { useUserRole } from "@/hooks/useUserRole";
import { formatMX } from "@/lib/dateUtils";
import { supabase } from "@/integrations/supabase/client";
import {
  Building2,
  FileText,
  Megaphone,
  Plus,
  Upload,
  Trash2,
  Download,
  Pin,
  Loader2,
} from "lucide-react";

export default function Despacho() {
  const { isAdminOrManager } = useUserRole();
  const [tab, setTab] = useState("procedimientos");
  const [procedureDialogOpen, setProcedureDialogOpen] = useState(false);
  const [comunicadoDialogOpen, setComunicadoDialogOpen] = useState(false);
  const [procedureTitle, setProcedureTitle] = useState("");
  const [procedureDescription, setProcedureDescription] = useState("");
  const [procedureFile, setProcedureFile] = useState<File | null>(null);
  const [comunicadoTitle, setComunicadoTitle] = useState("");
  const [comunicadoBody, setComunicadoBody] = useState("");
  const [comunicadoPinned, setComunicadoPinned] = useState(false);

  const { data: procedures = [], isLoading: proceduresLoading } = useInternalProcedures();
  const { data: comunicados = [], isLoading: comunicadosLoading } = useInternalComunicados();

  const createProcedure = useCreateInternalProcedure();
  const deleteProcedure = useDeleteInternalProcedure();
  const createComunicado = useCreateInternalComunicado();
  const deleteComunicado = useDeleteInternalComunicado();

  const handleUploadProcedure = () => {
    if (!procedureTitle.trim() || !procedureFile) return;
    createProcedure.mutate(
      {
        title: procedureTitle.trim(),
        description: procedureDescription.trim() || undefined,
        file: procedureFile,
      },
      {
        onSuccess: () => {
          setProcedureDialogOpen(false);
          setProcedureTitle("");
          setProcedureDescription("");
          setProcedureFile(null);
        },
      }
    );
  };

  const handlePublishComunicado = () => {
    if (!comunicadoTitle.trim()) return;
    createComunicado.mutate(
      {
        title: comunicadoTitle.trim(),
        body: comunicadoBody.trim() || undefined,
        is_pinned: comunicadoPinned,
      },
      {
        onSuccess: () => {
          setComunicadoDialogOpen(false);
          setComunicadoTitle("");
          setComunicadoBody("");
          setComunicadoPinned(false);
        },
      }
    );
  };

  const getProcedureDownloadUrl = async (filePath: string) => {
    const { data } = await supabase.storage.from("documents").createSignedUrl(filePath, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Building2 className="h-7 w-7 text-primary" />
            Despacho
          </h1>
          <p className="text-sm text-muted-foreground">
            Uso interno: procedimientos, manuales y comunicados del despacho
          </p>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full max-w-sm grid-cols-2">
            <TabsTrigger value="procedimientos" className="flex items-center gap-1.5">
              <FileText className="h-4 w-4" />
              Procedimientos
            </TabsTrigger>
            <TabsTrigger value="comunicados" className="flex items-center gap-1.5">
              <Megaphone className="h-4 w-4" />
              Comunicados
            </TabsTrigger>
          </TabsList>

          <TabsContent value="procedimientos" className="mt-6">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <p className="text-sm text-muted-foreground">
                Manuales y procedimientos para consulta del equipo
              </p>
              {isAdminOrManager && (
                <Button onClick={() => setProcedureDialogOpen(true)}>
                  <Upload className="mr-2 h-4 w-4" />
                  Subir procedimiento
                </Button>
              )}
            </div>
            {proceduresLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : procedures.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <FileText className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <h3 className="mt-4 text-lg font-medium text-foreground">Sin procedimientos aún</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Los administradores pueden subir manuales y procedimientos aquí.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-2">
                {procedures.map((proc: any) => (
                  <Card key={proc.id}>
                    <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <h3 className="font-medium text-foreground">{proc.title}</h3>
                        {proc.description && (
                          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                            {proc.description}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatMX(proc.created_at, "dd MMM yyyy")}
                          {proc.file_size && ` · ${(proc.file_size / 1024).toFixed(0)} KB`}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => getProcedureDownloadUrl(proc.file_path)}
                        >
                          <Download className="h-4 w-4 mr-1" />
                          Descargar
                        </Button>
                        {isAdminOrManager && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive hover:text-destructive"
                            onClick={() =>
                              deleteProcedure.mutate({ id: proc.id, file_path: proc.file_path })
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="comunicados" className="mt-6">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <p className="text-sm text-muted-foreground">
                Avisos y comunicados internos del despacho
              </p>
              {isAdminOrManager && (
                <Button onClick={() => setComunicadoDialogOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Nuevo comunicado
                </Button>
              )}
            </div>
            {comunicadosLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : comunicados.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Megaphone className="mx-auto h-12 w-12 text-muted-foreground/50" />
                  <h3 className="mt-4 text-lg font-medium text-foreground">Sin comunicados</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Los administradores pueden publicar comunicados aquí.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {comunicados.map((com: any) => (
                  <Card key={com.id} className={com.is_pinned ? "border-primary/50" : ""}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {com.is_pinned && (
                              <Pin className="h-4 w-4 text-primary shrink-0" />
                            )}
                            <h3 className="font-medium text-foreground">{com.title}</h3>
                          </div>
                          {com.body && (
                            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">
                              {com.body}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground mt-2">
                            {formatMX(com.created_at, "dd MMM yyyy, HH:mm")}
                          </p>
                        </div>
                        {isAdminOrManager && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-destructive shrink-0"
                            onClick={() => deleteComunicado.mutate(com.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialog: Subir procedimiento */}
      <Dialog open={procedureDialogOpen} onOpenChange={setProcedureDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Subir procedimiento o manual</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Título *</Label>
              <Input
                value={procedureTitle}
                onChange={(e) => setProcedureTitle(e.target.value)}
                placeholder="Ej: Manual de integración de clientes"
              />
            </div>
            <div>
              <Label>Descripción (opcional)</Label>
              <Textarea
                value={procedureDescription}
                onChange={(e) => setProcedureDescription(e.target.value)}
                placeholder="Breve descripción del contenido"
                rows={2}
              />
            </div>
            <div>
              <Label>Archivo *</Label>
              <Input
                type="file"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,image/*"
                onChange={(e) => setProcedureFile(e.target.files?.[0] ?? null)}
              />
              {procedureFile && (
                <p className="text-xs text-muted-foreground mt-1">{procedureFile.name}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProcedureDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleUploadProcedure}
              disabled={createProcedure.isPending || !procedureTitle.trim() || !procedureFile}
            >
              {createProcedure.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Subir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Nuevo comunicado */}
      <Dialog open={comunicadoDialogOpen} onOpenChange={setComunicadoDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo comunicado</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Título *</Label>
              <Input
                value={comunicadoTitle}
                onChange={(e) => setComunicadoTitle(e.target.value)}
                placeholder="Asunto del comunicado"
              />
            </div>
            <div>
              <Label>Contenido (opcional)</Label>
              <Textarea
                value={comunicadoBody}
                onChange={(e) => setComunicadoBody(e.target.value)}
                placeholder="Texto del comunicado..."
                rows={4}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={comunicadoPinned}
                onChange={(e) => setComunicadoPinned(e.target.checked)}
              />
              <span className="text-sm">Fijar al inicio</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComunicadoDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handlePublishComunicado}
              disabled={createComunicado.isPending || !comunicadoTitle.trim()}
            >
              {createComunicado.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Publicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
