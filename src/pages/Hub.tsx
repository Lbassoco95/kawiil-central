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
import { RecursosHumanosPanel } from "@/components/rh/RecursosHumanosPanel";
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
  Library,
  Shield,
  Search,
  UserCog,
} from "lucide-react";
import { PageHeader, type PageHeaderStat } from "@/components/shared/PageHeader";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { batchDocumentFormLimits, withLimits, STANDARD_BATCH_MAX_FILES } from "@/lib/fileIntake/limits";
import { Badge } from "@/components/ui/badge";
import { KAWIIL_AI_GRADIENT, KAWIIL_AI_HEADER_BG } from "@/lib/kawiilAi";
import { toast } from "sonner";

export default function Hub() {
  const { isAdminOrManager } = useUserRole();
  const [tab, setTab] = useState<"procedimientos" | "comunicados" | "biblioteca" | "rh" | "admin">(
    "procedimientos",
  );
  const [librarySearch, setLibrarySearch] = useState("");
  const [procedureDialogOpen, setProcedureDialogOpen] = useState(false);
  const [comunicadoDialogOpen, setComunicadoDialogOpen] = useState(false);
  const [procedureTitle, setProcedureTitle] = useState("");
  const [procedureDescription, setProcedureDescription] = useState("");
  const [procedureFiles, setProcedureFiles] = useState<File[]>([]);
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

  const pinnedComunicados = comunicados.filter((c: any) => c.is_pinned).length;
  const heroStats: PageHeaderStat[] = [
    {
      label: "Procedimientos",
      value: procedures.length,
      sub: proceduresLoading ? "Cargando..." : "En biblioteca",
    },
    {
      label: "Comunicados",
      value: comunicados.length,
      sub: comunicadosLoading ? "Cargando..." : `${pinnedComunicados} fijados`,
      tone: pinnedComunicados > 0 ? "primary" : "default",
    },
    {
      label: "Acceso",
      value: isAdminOrManager ? "Admin" : "Equipo",
      sub: isAdminOrManager ? "Puedes publicar" : "Solo lectura",
    },
  ];

  const handleUploadProcedure = async () => {
    if (!procedureTitle.trim() || procedureFiles.length === 0) return;
    const list = procedureFiles.slice(0, STANDARD_BATCH_MAX_FILES);
    const n = list.length;
    try {
      for (let i = 0; i < n; i++) {
        const file = list[i];
        const title = n === 1 ? procedureTitle.trim() : `${procedureTitle.trim()} — ${file.name}`;
        await createProcedure.mutateAsync({
          title,
          description: procedureDescription.trim() || undefined,
          file,
          quiet: i < n - 1,
        });
      }
      if (n > 1) {
        toast.success(`${n} procedimientos subidos`);
      }
      setProcedureDialogOpen(false);
      setProcedureTitle("");
      setProcedureDescription("");
      setProcedureFiles([]);
    } catch {
      // El hook ya muestra el error
    }
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
          variant="hero"
          breadcrumb={["Kawiil OS", "Conocimiento", "Hub"]}
          icon={<Library />}
          iconAccent={KAWIIL_AI_GRADIENT}
          title="Hub"
          description="Manuales, procedimientos y comunicados internos"
          stats={heroStats}
          actions={
            <>
              <Badge
                variant="outline"
                className="hidden sm:inline-flex border-sky-300/70 bg-sky-50/70 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300"
              >
                v2.4
              </Badge>
              {isAdminOrManager ? (
                <>
                  <Button size="sm" variant="outline" onClick={() => setComunicadoDialogOpen(true)}>
                    <Megaphone className="mr-1.5 h-3.5 w-3.5" />
                    Comunicado
                  </Button>
                  <Button size="sm" onClick={() => setProcedureDialogOpen(true)}>
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    Subir procedimiento
                  </Button>
                </>
              ) : null}
            </>
          }
        />

        {/* Tab pills */}
        <div className="flex flex-wrap gap-1.5">
          {[
            { key: "procedimientos" as const, label: "Procedimientos", icon: FileText },
            { key: "comunicados" as const, label: "Comunicados", icon: Megaphone },
            { key: "biblioteca" as const, label: "Mi biblioteca", icon: Library },
            { key: "rh" as const, label: "Recursos Humanos", icon: UserCog },
            ...(isAdminOrManager
              ? [{ key: "admin" as const, label: "Admin", icon: Shield }]
              : []),
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

        {tab === "biblioteca" && (
          <section className="space-y-4">
            <div className="surface-toolbar flex items-center gap-2 p-3">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
                placeholder="Buscar en mi biblioteca…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
            </div>
            {(() => {
              const q = librarySearch.trim().toLowerCase();
              const filtered = procedures.filter((p: any) =>
                !q ||
                p.title?.toLowerCase().includes(q) ||
                p.description?.toLowerCase().includes(q),
              );
              if (proceduresLoading) {
                return (
                  <div className="space-y-2">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-16 animate-pulse rounded-xl bg-secondary/30" />
                    ))}
                  </div>
                );
              }
              if (filtered.length === 0) {
                return (
                  <div className="py-12 text-center">
                    <Library className="mx-auto h-8 w-8 text-muted-foreground/40" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      {q ? "Sin resultados para tu búsqueda." : "Sin procedimientos guardados."}
                    </p>
                  </div>
                );
              }
              return (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {filtered.map((proc: any) => (
                    <button
                      key={proc.id}
                      type="button"
                      onClick={() => setSelectedProcedure(proc)}
                      className="page-list-card flex items-start gap-3 p-4 text-left"
                    >
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-medium">{proc.title}</h3>
                        {proc.description && (
                          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                            {proc.description}
                          </p>
                        )}
                        <p className="mt-2 text-[11px] text-muted-foreground">
                          v{proc.current_version || 1} · {formatMX(proc.updated_at || proc.created_at, "dd MMM yyyy")}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              );
            })()}
          </section>
        )}

        {tab === "rh" && <RecursosHumanosPanel />}

        {tab === "admin" && isAdminOrManager && (
          <section className="space-y-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="stat-card border-l-[3px] border-l-primary">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Procedimientos publicados
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums">{procedures.length}</p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    setTab("procedimientos");
                    setProcedureDialogOpen(true);
                  }}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Subir nuevo
                </Button>
              </div>
              <div className="stat-card border-l-[3px] border-l-accent">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Comunicados publicados
                </p>
                <p className="mt-1 text-3xl font-bold tabular-nums">{comunicados.length}</p>
                <Button
                  size="sm"
                  className="mt-3"
                  variant="secondary"
                  onClick={() => {
                    setTab("comunicados");
                    setComunicadoDialogOpen(true);
                  }}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Nuevo comunicado
                </Button>
              </div>
            </div>
            <div className="surface-toolbar p-4">
              <h3 className="text-sm font-semibold">Próximamente</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Métricas de adopción del Hub, asignación por grado y plantillas.
              </p>
            </div>
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
        <DialogContent className="sm:max-w-md overflow-hidden p-0">
          <div
            className="flex items-center gap-3 px-5 py-4 text-white"
            style={{ background: KAWIIL_AI_HEADER_BG }}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <Upload className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <DialogHeader className="space-y-0">
                <DialogTitle className="text-white text-[15px] font-semibold">
                  Subir procedimiento
                </DialogTitle>
              </DialogHeader>
              <p className="text-[11.5px] text-white/80">
                Comparte manuales con el equipo
              </p>
            </div>
          </div>
          <div className="space-y-4 px-5 pb-5 pt-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Título *</Label>
              <Input value={procedureTitle} onChange={(e) => setProcedureTitle(e.target.value)} placeholder="Ej: Manual de integración" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Descripción</Label>
              <Textarea value={procedureDescription} onChange={(e) => setProcedureDescription(e.target.value)} placeholder="Breve descripción" rows={2} className="text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Archivos *</Label>
              <FileDropzone
                files={procedureFiles}
                onChange={setProcedureFiles}
                limits={withLimits(batchDocumentFormLimits, {
                  accept: ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,image/*",
                })}
                variant="area"
                hint="Arrastra archivos o haz click"
                subhint={`Hasta ${STANDARD_BATCH_MAX_FILES} archivos; PDF, Office, texto o imagen`}
                showSize
              />
            </div>
          </div>
          <DialogFooter className="px-5 pb-5">
            <Button variant="outline" size="sm" onClick={() => setProcedureDialogOpen(false)}>Cancelar</Button>
            <Button
              size="sm"
              className="text-white hover:opacity-95"
              style={{ background: KAWIIL_AI_GRADIENT }}
              onClick={() => void handleUploadProcedure()}
              disabled={createProcedure.isPending || !procedureTitle.trim() || procedureFiles.length === 0}
            >
              {createProcedure.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Subir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Nuevo comunicado */}
      <Dialog open={comunicadoDialogOpen} onOpenChange={setComunicadoDialogOpen}>
        <DialogContent className="sm:max-w-md overflow-hidden p-0">
          <div
            className="flex items-center gap-3 px-5 py-4 text-white"
            style={{ background: KAWIIL_AI_HEADER_BG }}
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 backdrop-blur">
              <Megaphone className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <DialogHeader className="space-y-0">
                <DialogTitle className="text-white text-[15px] font-semibold">
                  Nuevo comunicado
                </DialogTitle>
              </DialogHeader>
              <p className="text-[11.5px] text-white/80">
                Publica un aviso interno para tu equipo
              </p>
            </div>
          </div>
          <div className="space-y-4 px-5 pb-5 pt-4">
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
          <DialogFooter className="px-5 pb-5">
            <Button variant="outline" size="sm" onClick={() => setComunicadoDialogOpen(false)}>Cancelar</Button>
            <Button
              size="sm"
              className="text-white hover:opacity-95"
              style={{ background: KAWIIL_AI_GRADIENT }}
              onClick={handlePublishComunicado}
              disabled={createComunicado.isPending || !comunicadoTitle.trim()}
            >
              {createComunicado.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Publicar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
