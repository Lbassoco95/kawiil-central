import { useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  const [tab, setTab] = useState<"procedimientos" | "comunicados">("procedimientos");
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
      { title: procedureTitle.trim(), description: procedureDescription.trim() || undefined, file: procedureFile },
      { onSuccess: () => { setProcedureDialogOpen(false); setProcedureTitle(""); setProcedureDescription(""); setProcedureFile(null); } }
    );
  };

  const handlePublishComunicado = () => {
    if (!comunicadoTitle.trim()) return;
    createComunicado.mutate(
      { title: comunicadoTitle.trim(), body: comunicadoBody.trim() || undefined, is_pinned: comunicadoPinned },
      { onSuccess: () => { setComunicadoDialogOpen(false); setComunicadoTitle(""); setComunicadoBody(""); setComunicadoPinned(false); } }
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
          <h1 className="text-xl font-semibold text-foreground">Despacho</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Uso interno: procedimientos, manuales y comunicados</p>
        </div>

        {/* Tab pills */}
        <div className="flex gap-1.5">
          {[
            { key: "procedimientos" as const, label: "Procedimientos", icon: FileText },
            { key: "comunicados" as const, label: "Comunicados", icon: Megaphone },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                tab === t.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
              }`}
            >
              <t.icon className="h-3 w-3" />
              {t.label}
            </button>
          ))}
        </div>

        {tab === "procedimientos" && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Manuales y procedimientos para consulta del equipo</p>
              {isAdminOrManager && (
                <Button size="sm" onClick={() => setProcedureDialogOpen(true)}>
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Subir procedimiento
                </Button>
              )}
            </div>
            {proceduresLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : procedures.length === 0 ? (
              <div className="text-center py-16">
                <FileText className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <h3 className="mt-3 text-sm font-medium text-foreground">Sin procedimientos aún</h3>
                <p className="mt-1 text-xs text-muted-foreground">Los administradores pueden subir manuales y procedimientos aquí.</p>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {procedures.map((proc: any) => (
                  <div key={proc.id} className="flex items-center justify-between gap-3 py-3 px-1">
                    <div className="min-w-0">
                      <h3 className="text-[13px] font-medium text-foreground">{proc.title}</h3>
                      {proc.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{proc.description}</p>
                      )}
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {formatMX(proc.created_at, "dd MMM yyyy")}
                        {proc.file_size && ` · ${(proc.file_size / 1024).toFixed(0)} KB`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => getProcedureDownloadUrl(proc.file_path)}>
                        <Download className="h-3 w-3 mr-1" />
                        Descargar
                      </Button>
                      {isAdminOrManager && (
                        <button
                          className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
                          onClick={() => deleteProcedure.mutate({ id: proc.id, file_path: proc.file_path })}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "comunicados" && (
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Avisos y comunicados internos del despacho</p>
              {isAdminOrManager && (
                <Button size="sm" onClick={() => setComunicadoDialogOpen(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Nuevo comunicado
                </Button>
              )}
            </div>
            {comunicadosLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : comunicados.length === 0 ? (
              <div className="text-center py-16">
                <Megaphone className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <h3 className="mt-3 text-sm font-medium text-foreground">Sin comunicados</h3>
                <p className="mt-1 text-xs text-muted-foreground">Los administradores pueden publicar comunicados aquí.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {comunicados.map((com: any) => (
                  <div key={com.id} className={`rounded-xl p-4 ${com.is_pinned ? "bg-primary/5 ring-1 ring-primary/10" : "bg-secondary/30"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {com.is_pinned && <Pin className="h-3.5 w-3.5 text-primary shrink-0" />}
                          <h3 className="text-[13px] font-medium text-foreground">{com.title}</h3>
                        </div>
                        {com.body && (
                          <p className="text-xs text-muted-foreground mt-1.5 whitespace-pre-wrap">{com.body}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-2">
                          {formatMX(com.created_at, "dd MMM yyyy, HH:mm")}
                        </p>
                      </div>
                      {isAdminOrManager && (
                        <button
                          className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          onClick={() => deleteComunicado.mutate(com.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
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
              <Input value={procedureTitle} onChange={(e) => setProcedureTitle(e.target.value)} placeholder="Ej: Manual de integración de clientes" />
            </div>
            <div>
              <Label>Descripción (opcional)</Label>
              <Textarea value={procedureDescription} onChange={(e) => setProcedureDescription(e.target.value)} placeholder="Breve descripción del contenido" rows={2} />
            </div>
            <div>
              <Label>Archivo *</Label>
              <Input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,image/*" onChange={(e) => setProcedureFile(e.target.files?.[0] ?? null)} />
              {procedureFile && <p className="text-xs text-muted-foreground mt-1">{procedureFile.name}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProcedureDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleUploadProcedure} disabled={createProcedure.isPending || !procedureTitle.trim() || !procedureFile}>
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
              <Input value={comunicadoTitle} onChange={(e) => setComunicadoTitle(e.target.value)} placeholder="Asunto del comunicado" />
            </div>
            <div>
              <Label>Contenido (opcional)</Label>
              <Textarea value={comunicadoBody} onChange={(e) => setComunicadoBody(e.target.value)} placeholder="Texto del comunicado..." rows={4} />
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={comunicadoPinned} onChange={(e) => setComunicadoPinned(e.target.checked)} />
              <span className="text-sm">Fijar al inicio</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComunicadoDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handlePublishComunicado} disabled={createComunicado.isPending || !comunicadoTitle.trim()}>
              {createComunicado.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Publicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
