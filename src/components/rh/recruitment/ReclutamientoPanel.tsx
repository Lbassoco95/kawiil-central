import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Plus, Loader2, Briefcase, UserPlus, Columns3, Tag, Upload, FileText, ClipboardList, Mail, FileUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  PROCESS_STATUS_LABEL,
  PROCESS_STATUS_STYLE,
  STATE_COLOR_STYLE,
  SEMAPHORE_DOT,
  scoreSemaphore,
  type Candidate,
  type RecruitmentProcess,
  type RecruitmentStage,
  type RecruitmentState,
  type RhProcessStatus,
} from "@/lib/recruitment";
import {
  useRecruitmentProcesses,
  useCreateProcess,
  useUpdateProcessStatus,
  useProcessStages,
  useProcessStates,
  useProcessCriteria,
  useCandidates,
  useCreateCandidate,
  useMoveCandidateStage,
  useOrgName,
  uploadCandidateCvByIds,
} from "@/hooks/useRecruitment";
import { useCelulas } from "@/hooks/useCatalogs";
import { useQueryClient } from "@tanstack/react-query";
import { CandidateDetailDialog } from "./CandidateDetailDialog";
import { StageManagerDialog } from "./StageManagerDialog";
import { StateManagerDialog } from "./StateManagerDialog";
import { CriteriaManagerDialog } from "./CriteriaManagerDialog";
import { EmailTemplateManagerDialog } from "./EmailTemplateManagerDialog";
import { CandidateImportDialog } from "./CandidateImportDialog";

const PROCESS_STATUSES: RhProcessStatus[] = ["open", "paused", "closed", "filled"];

export function ReclutamientoPanel() {
  const [selected, setSelected] = useState<RecruitmentProcess | null>(null);

  if (selected) {
    return <ProcessBoard process={selected} onBack={() => setSelected(null)} />;
  }
  return <ProcessList onOpen={setSelected} />;
}

/* ---------------- Lista de vacantes ---------------- */
function ProcessList({ onOpen }: { onOpen: (p: RecruitmentProcess) => void }) {
  const { data: processes = [], isLoading } = useRecruitmentProcesses();
  const { data: celulas = [] } = useCelulas();
  const celulaName = (id: string | null) => celulas.find((c) => c.id === id)?.name ?? "Sin célula";
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Vacantes y procesos de selección</p>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Nueva vacante
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : processes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <Briefcase className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Aún no hay vacantes. Crea la primera.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {processes.map((p) => (
            <button key={p.id} type="button" onClick={() => onOpen(p)} className="text-left">
              <Card className="h-full transition-colors hover:bg-muted/40">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-start justify-between gap-2 text-sm">
                    <span className="min-w-0 truncate">{p.title}</span>
                    <Badge variant="outline" className={cn("shrink-0", PROCESS_STATUS_STYLE[p.status])}>
                      {PROCESS_STATUS_LABEL[p.status]}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  {celulaName(p.celula_id)}
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}

      <NewProcessDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </section>
  );
}

function NewProcessDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useCreateProcess();
  const { data: celulas = [] } = useCelulas();
  const [title, setTitle] = useState("");
  const [celulaId, setCelulaId] = useState("");
  const [description, setDescription] = useState("");

  function reset() {
    setTitle("");
    setCelulaId("");
    setDescription("");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nueva vacante</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Contador junior" />
          </div>
          <div className="space-y-1.5">
            <Label>Célula</Label>
            <Select value={celulaId} onValueChange={setCelulaId}>
              <SelectTrigger><SelectValue placeholder="Selecciona la célula" /></SelectTrigger>
              <SelectContent>
                {celulas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Descripción (opcional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={!title.trim() || !celulaId || create.isPending}
            onClick={() => create.mutate(
              { title: title.trim(), celula_id: celulaId, description: description.trim() || null },
              { onSuccess: () => { onOpenChange(false); reset(); } },
            )}
          >
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Crear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Tablero del proceso ---------------- */
function ProcessBoard({ process, onBack }: { process: RecruitmentProcess; onBack: () => void }) {
  const { data: stages = [] } = useProcessStages(process.id);
  const { data: states = [] } = useProcessStates(process.id);
  const { data: criteria = [] } = useProcessCriteria(process.id);
  const { data: candidates = [], isLoading } = useCandidates(process.id);
  const { data: celulas = [] } = useCelulas();
  const { data: orgName = "" } = useOrgName();
  const celulaName = celulas.find((c) => c.id === process.celula_id)?.name ?? null;
  const updateStatus = useUpdateProcessStatus();
  const moveStage = useMoveCandidateStage();
  const [addOpen, setAddOpen] = useState(false);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [statesOpen, setStatesOpen] = useState(false);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [detail, setDetail] = useState<Candidate | null>(null);

  const defaultStateId = states.find((s) => s.is_default)?.id ?? states[0]?.id ?? null;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const detailLive = useMemo(
    () => (detail ? candidates.find((c) => c.id === detail.id) ?? null : null),
    [detail, candidates],
  );

  const stateById = useMemo(() => new Map(states.map((s) => [s.id, s])), [states]);

  const byStage = useMemo(() => {
    const m = new Map<string, Candidate[]>();
    for (const s of stages) m.set(s.id, []);
    for (const c of candidates) {
      if (c.stage_id && m.has(c.stage_id)) m.get(c.stage_id)!.push(c);
    }
    return m;
  }, [stages, candidates]);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;
    const cand = candidates.find((c) => c.id === active.id);
    const stage = stages.find((s) => s.id === over.id);
    if (!cand || !stage || cand.stage_id === stage.id) return;
    moveStage.mutate({ candidate: cand, stageId: stage.id, stageName: stage.name });
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} className="px-2">
          <ArrowLeft className="mr-1 h-4 w-4" /> Vacantes
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{process.title}</h3>
          {celulaName && <p className="text-xs text-muted-foreground">{celulaName}</p>}
        </div>
        <Select value={process.status} onValueChange={(v) => updateStatus.mutate({ id: process.id, status: v as RhProcessStatus })}>
          <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PROCESS_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{PROCESS_STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => setStagesOpen(true)}>
          <Columns3 className="mr-1.5 h-3.5 w-3.5" /> Fases
        </Button>
        <Button size="sm" variant="outline" onClick={() => setStatesOpen(true)}>
          <Tag className="mr-1.5 h-3.5 w-3.5" /> Estados
        </Button>
        <Button size="sm" variant="outline" onClick={() => setCriteriaOpen(true)}>
          <ClipboardList className="mr-1.5 h-3.5 w-3.5" /> Rúbrica
        </Button>
        <Button size="sm" variant="outline" onClick={() => setTemplatesOpen(true)}>
          <Mail className="mr-1.5 h-3.5 w-3.5" /> Plantillas
        </Button>
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
          <FileUp className="mr-1.5 h-3.5 w-3.5" /> Importar
        </Button>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Candidato
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {stages.map((s) => (
              <DroppableColumn key={s.id} stage={s} count={(byStage.get(s.id) ?? []).length}>
                {(byStage.get(s.id) ?? []).map((c) => (
                  <DraggableCard
                    key={c.id}
                    candidate={c}
                    state={c.state_id ? stateById.get(c.state_id) : undefined}
                    onClick={() => setDetail(c)}
                  />
                ))}
              </DroppableColumn>
            ))}
            {stages.length === 0 && (
              <p className="text-sm text-muted-foreground">Aún no hay fases. Crea las columnas en “Fases”.</p>
            )}
          </div>
        </DndContext>
      )}

      <NewCandidateDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        process={process}
        firstStageId={stages[0]?.id ?? null}
        defaultStateId={defaultStateId}
      />
      <CandidateImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        processId={process.id}
        firstStageId={stages[0]?.id ?? null}
        defaultStateId={defaultStateId}
      />
      <StageManagerDialog open={stagesOpen} onOpenChange={setStagesOpen} processId={process.id} stages={stages} />
      <StateManagerDialog open={statesOpen} onOpenChange={setStatesOpen} processId={process.id} states={states} />
      <CriteriaManagerDialog open={criteriaOpen} onOpenChange={setCriteriaOpen} processId={process.id} criteria={criteria} />
      <EmailTemplateManagerDialog open={templatesOpen} onOpenChange={setTemplatesOpen} />
      <CandidateDetailDialog
        candidate={detailLive}
        stages={stages}
        states={states}
        criteria={criteria}
        processTitle={process.title}
        orgName={orgName}
        onOpenChange={(v) => !v && setDetail(null)}
      />
    </section>
  );
}

function DroppableColumn({ stage, count, children }: { stage: RecruitmentStage; count: number; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div className="w-64 shrink-0">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="text-sm font-medium">{stage.name}</span>
        <Badge variant="secondary" className="text-[10px]">{count}</Badge>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-[80px] space-y-2 rounded-lg p-1 transition-colors",
          isOver && "bg-muted/60 ring-2 ring-primary/30",
        )}
      >
        {count === 0 ? (
          <div className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
            Vacío
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

function DraggableCard({
  candidate,
  state,
  onClick,
}: {
  candidate: Candidate;
  state: RecruitmentState | undefined;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: candidate.id });
  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)`, zIndex: 50 }
    : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={cn("cursor-grab touch-none active:cursor-grabbing", isDragging && "opacity-50")}
    >
      <Card className="transition-colors hover:bg-muted/50">
        <CardContent className="space-y-1 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
              {candidate.rating > 0 && (
                <span
                  className={cn("h-2 w-2 shrink-0 rounded-full", SEMAPHORE_DOT[scoreSemaphore(candidate.rating)])}
                  title={`Calificación ${candidate.rating}/5`}
                />
              )}
              <span className="min-w-0 truncate">{candidate.full_name}</span>
            </span>
            {state && (
              <Badge variant="outline" className={cn("shrink-0 text-[10px]", STATE_COLOR_STYLE[state.color] ?? STATE_COLOR_STYLE.slate)}>
                {state.name}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {candidate.email && <p className="min-w-0 truncate text-xs text-muted-foreground">{candidate.email}</p>}
            {candidate.resume_url && <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function NewCandidateDialog({
  open,
  onOpenChange,
  process,
  firstStageId,
  defaultStateId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  process: RecruitmentProcess;
  firstStageId: string | null;
  defaultStateId: string | null;
}) {
  const create = useCreateCandidate();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  function reset() {
    setFullName(""); setEmail(""); setPhone(""); setSource(""); setCvFile(null);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const id = await create.mutateAsync({
        process_id: process.id,
        stage_id: firstStageId,
        state_id: defaultStateId,
        full_name: fullName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        source: source.trim() || null,
      });
      if (cvFile) {
        await uploadCandidateCvByIds(process.organization_id, id, cvFile);
        qc.invalidateQueries({ queryKey: ["rh-candidates", process.id] });
      }
      onOpenChange(false);
      reset();
    } catch (e) {
      toast.error((e as Error).message || "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nuevo candidato</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Nombre completo</Label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Correo</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Teléfono</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Fuente (opcional)</Label>
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="LinkedIn, referido…" />
          </div>
          <div className="space-y-1.5">
            <Label>CV (opcional)</Label>
            <div className="flex items-center gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
                <Upload className="mr-1.5 h-3.5 w-3.5" /> Elegir archivo
              </Button>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {cvFile ? cvFile.name : "PDF o Word"}
              </span>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,application/pdf"
                className="hidden"
                onChange={(e) => setCvFile(e.target.files?.[0] ?? null)}
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button disabled={!fullName.trim() || saving} onClick={handleSave}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Agregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
