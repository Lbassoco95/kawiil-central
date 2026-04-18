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
import { ProcedureDetailDialog } from "@/components/hub/ProcedureDetailDialog";
import { useUserRole } from "@/hooks/useUserRole";
import { formatMX } from "@/lib/dateUtils";
import {
  FileText,
  Megaphone,
  Plus,
  Upload,
  Trash2,
  Pin,
  Loader2,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { singleFileLimits, withLimits } from "@/lib/fileIntake/limits";

export default function Hub() {
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
  const [selectedProcedure, setSelectedProcedure] = useState<any>(null);

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

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title="Hub"
          description="Manuales, procedimientos y comunicados"
        />

        {/* Tab pills */}
        <div className="flex gap-1.5">
          {[
            { key: "procedimientos" as const, label: "Procedimientos", icon: FileText },
            { key: "comunicados" as const, label: "Comunicados", icon: Megaphone },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`tab-pill inline-flex items-center gap-1.5 ${
                tab === t.key ? "tab-pill-active" : "tab-pill-inactive"
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
                  Subir
                </Button>
              )}
            </div>
            {proceduresLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-16 rounded-xl bg-secondary/30 animate-pulse" />
                ))}
              </div>
            ) : procedures.length === 0 ? (
              <div className="text-center py-16 animate-scale-in">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <FileText className="h-8 w-8 text-primary/60" />
                </div>
                <h3 className="text-sm font-medium text-foreground">Sin procedimientos aún</h3>
                <p className="mt-1 text-xs text-muted-foreground">Los administradores pueden subir manuales aquí.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {procedures.map((proc: any, i: number) => (
                  <div
                    key={proc.id}
                    className="flex items-center justify-between gap-3 py-3 px-4 page-list-card cursor-pointer group animate-fade-in"
                    style={{ animationDelay: `${Math.min(i, 8) * 40}ms`, animationFillMode: "both" }}
                    onClick={() => setSelectedProcedure(proc)}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <h3 className="text-[13px] font-medium text-foreground truncate">{proc.title}</h3>
                        {proc.description && (
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{proc.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-muted-foreground">v{proc.current_version || 1}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {formatMX(proc.updated_at || proc.created_at, "dd MMM yyyy")}
                      </span>
                      {isAdminOrManager && (
                        <button
                          className="p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-destructive transition-colors"
                          onClick={(e) => { e.stopPropagation(); deleteProcedure.mutate({ id: proc.id, file_path: proc.file_path }); }}
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
              <p className="text-sm text-muted-foreground">Avisos y comunicados internos</p>
              {isAdminOrManager && (
                <Button size="sm" onClick={() => setComunicadoDialogOpen(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Nuevo
                </Button>
              )}
            </div>
            {comunicadosLoading ? (
              <div className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-20 rounded-xl bg-secondary/30 animate-pulse" />
                ))}
              </div>
            ) : comunicados.length === 0 ? (
              <div className="text-center py-16 animate-scale-in">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                  <Megaphone className="h-8 w-8 text-primary/60" />
                </div>
                <h3 className="text-sm font-medium text-foreground">Sin comunicados</h3>
                <p className="mt-1 text-xs text-muted-foreground">Los administradores pueden publicar comunicados aquí.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {comunicados.map((com: any, i: number) => (
                  <div key={com.id} className="py-3 px-4 page-list-card group animate-fade-in" style={{ animationDelay: `${Math.min(i, 8) * 40}ms`, animationFillMode: "both" }}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {com.is_pinned && <Pin className="h-3 w-3 text-primary shrink-0" />}
                          <h3 className="text-[13px] font-medium text-foreground">{com.title}</h3>
                        </div>
                        {com.body && (
                          <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{com.body}</p>
                        )}
                        <p className="text-[11px] text-muted-foreground mt-1.5">
                          {formatMX(com.created_at, "dd MMM yyyy, HH:mm")}
                        </p>
                      </div>
                      {isAdminOrManager && (
                        <button
                          className="p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-destructive transition-colors shrink-0"
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

      <ProcedureDetailDialog
        procedure={selectedProcedure}
        open={!!selectedProcedure}
        onOpenChange={(open) => { if (!open) setSelectedProcedure(null); }}
      />

      {/* Dialog: Subir procedimiento */}
      <Dialog open={procedureDialogOpen} onOpenChange={setProcedureDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Subir procedimiento</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Título *</Label>
              <Input value={procedureTitle} onChange={(e) => setProcedureTitle(e.target.value)} placeholder="Ej: Manual de integración" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Descripción</Label>
              <Textarea value={procedureDescription} onChange={(e) => setProcedureDescription(e.target.value)} placeholder="Breve descripción" rows={2} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Archivo *</Label>
              <FileDropzone
                files={procedureFile ? [procedureFile] : []}
                onChange={(files) => setProcedureFile(files[0] ?? null)}
                limits={withLimits(singleFileLimits, {
                  accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,image/*",
                })}
                variant="area"
                hint="Arrastra el archivo o haz click"
                subhint="PDF, Office, texto o imagen"
                showSize
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setProcedureDialogOpen(false)}>Cancelar</Button>
            <Button size="sm" onClick={handleUploadProcedure} disabled={createProcedure.isPending || !procedureTitle.trim() || !procedureFile}>
              {createProcedure.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
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
            <div className="space-y-1.5">
              <Label className="text-xs">Título *</Label>
              <Input value={comunicadoTitle} onChange={(e) => setComunicadoTitle(e.target.value)} placeholder="Asunto" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Contenido</Label>
              <Textarea value={comunicadoBody} onChange={(e) => setComunicadoBody(e.target.value)} placeholder="Texto del comunicado..." rows={4} className="text-sm" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-sm">
              <input type="checkbox" checked={comunicadoPinned} onChange={(e) => setComunicadoPinned(e.target.checked)} />
              Fijar al inicio
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setComunicadoDialogOpen(false)}>Cancelar</Button>
            <Button size="sm" onClick={handlePublishComunicado} disabled={createComunicado.isPending || !comunicadoTitle.trim()}>
              {createComunicado.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Publicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
