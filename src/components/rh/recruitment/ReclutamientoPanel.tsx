import { useMemo, useState } from "react";
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
import { ArrowLeft, Plus, Loader2, Briefcase, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CANDIDATE_STATUS_LABEL,
  CANDIDATE_STATUS_STYLE,
  PROCESS_STATUS_LABEL,
  PROCESS_STATUS_STYLE,
  type Candidate,
  type RecruitmentProcess,
  type RhProcessStatus,
} from "@/lib/recruitment";
import {
  useRecruitmentProcesses,
  useCreateProcess,
  useUpdateProcessStatus,
  useProcessStages,
  useCandidates,
  useCreateCandidate,
} from "@/hooks/useRecruitment";
import { CandidateDetailDialog } from "./CandidateDetailDialog";

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
                  {p.area || "Sin área"}
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
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("");
  const [description, setDescription] = useState("");

  function reset() {
    setTitle("");
    setArea("");
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
            <Label>Área (opcional)</Label>
            <Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Contabilidad" />
          </div>
          <div className="space-y-1.5">
            <Label>Descripción (opcional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={!title.trim() || create.isPending}
            onClick={() => create.mutate(
              { title: title.trim(), area: area.trim() || null, description: description.trim() || null },
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
  const { data: candidates = [], isLoading } = useCandidates(process.id);
  const updateStatus = useUpdateProcessStatus();
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<Candidate | null>(null);

  // Mantiene el candidato seleccionado sincronizado con los datos frescos.
  const detailLive = useMemo(
    () => (detail ? candidates.find((c) => c.id === detail.id) ?? null : null),
    [detail, candidates],
  );

  const byStage = useMemo(() => {
    const m = new Map<string, Candidate[]>();
    for (const s of stages) m.set(s.id, []);
    const noStage: Candidate[] = [];
    for (const c of candidates) {
      if (c.stage_id && m.has(c.stage_id)) m.get(c.stage_id)!.push(c);
      else noStage.push(c);
    }
    return { m, noStage };
  }, [stages, candidates]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="px-2">
          <ArrowLeft className="mr-1 h-4 w-4" /> Vacantes
        </Button>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold">{process.title}</h3>
          {process.area && <p className="text-xs text-muted-foreground">{process.area}</p>}
        </div>
        <Select value={process.status} onValueChange={(v) => updateStatus.mutate({ id: process.id, status: v as RhProcessStatus })}>
          <SelectTrigger className="h-8 w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PROCESS_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{PROCESS_STATUS_LABEL[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Candidato
        </Button>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {stages.map((s) => {
            const list = byStage.m.get(s.id) ?? [];
            return (
              <div key={s.id} className="w-64 shrink-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-sm font-medium">{s.name}</span>
                  <Badge variant="secondary" className="text-[10px]">{list.length}</Badge>
                </div>
                <div className="space-y-2">
                  {list.map((c) => (
                    <CandidateCard key={c.id} candidate={c} onClick={() => setDetail(c)} />
                  ))}
                  {list.length === 0 && (
                    <div className="rounded-lg border border-dashed py-6 text-center text-xs text-muted-foreground">
                      Vacío
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewCandidateDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        processId={process.id}
        firstStageId={stages[0]?.id ?? null}
      />
      <CandidateDetailDialog
        candidate={detailLive}
        stages={stages}
        onOpenChange={(v) => !v && setDetail(null)}
      />
    </section>
  );
}

function CandidateCard({ candidate, onClick }: { candidate: Candidate; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="w-full text-left">
      <Card className="transition-colors hover:bg-muted/50">
        <CardContent className="space-y-1 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-medium">{candidate.full_name}</span>
            {candidate.status !== "active" && (
              <Badge variant="outline" className={cn("shrink-0 text-[10px]", CANDIDATE_STATUS_STYLE[candidate.status])}>
                {CANDIDATE_STATUS_LABEL[candidate.status]}
              </Badge>
            )}
          </div>
          {candidate.email && <p className="truncate text-xs text-muted-foreground">{candidate.email}</p>}
        </CardContent>
      </Card>
    </button>
  );
}

function NewCandidateDialog({
  open,
  onOpenChange,
  processId,
  firstStageId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  processId: string;
  firstStageId: string | null;
}) {
  const create = useCreateCandidate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");

  function reset() {
    setFullName(""); setEmail(""); setPhone(""); setSource("");
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
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            disabled={!fullName.trim() || create.isPending}
            onClick={() => create.mutate(
              {
                process_id: processId,
                stage_id: firstStageId,
                full_name: fullName.trim(),
                email: email.trim() || null,
                phone: phone.trim() || null,
                source: source.trim() || null,
              },
              { onSuccess: () => { onOpenChange(false); reset(); } },
            )}
          >
            {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Agregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
