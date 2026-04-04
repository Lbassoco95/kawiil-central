import { useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { usePipelineStages, usePipelineLeads, useMoveLeadStage, type Lead, type PipelineStage, type LeadTask } from "@/hooks/usePipeline";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, GripVertical, Flame } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateLead } from "@/hooks/usePipeline";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

const priorityVariant: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  urgent: "destructive",
  high: "default",
  medium: "secondary",
  low: "outline",
};

interface LeadTaskSummary {
  hasOverdue: boolean;
  hasToday: boolean;
  hasFuture: boolean;
  hasTasks: boolean;
}

function getTaskIndicator(summary: LeadTaskSummary | undefined) {
  if (!summary || !summary.hasTasks) return null;
  if (summary.hasOverdue) return <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" title="Tarea vencida" />;
  if (summary.hasToday) return <span className="h-2 w-2 rounded-full bg-yellow-500 shrink-0" title="Tarea hoy" />;
  if (summary.hasFuture) return <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" title="Tarea futura" />;
  return null;
}

function LeadCard({ lead, stageColor, taskSummary }: { lead: Lead; stageColor: string; taskSummary?: LeadTaskSummary }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { lead },
  });
  const dragStyle = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.55 : 1,
      }
    : undefined;

  return (
    <Card
      className="shadow-sm overflow-hidden"
      style={{ borderLeftWidth: 4, borderLeftColor: stageColor }}
    >
      <div
        ref={setNodeRef}
        style={dragStyle}
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing select-none touch-manipulation"
      >
        <CardHeader className="p-3 pb-0 flex flex-row items-start gap-2 space-y-0">
          <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5 pointer-events-none" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm truncate">{lead.full_name}</p>
            {lead.company_name && (
              <p className="text-xs text-muted-foreground truncate">{lead.company_name}</p>
            )}
          </div>
        </CardHeader>
        <CardContent className="p-3 pt-2 flex flex-wrap gap-1 items-center">
          {getTaskIndicator(taskSummary)}
          <Badge variant={priorityVariant[lead.priority] || "secondary"} className="text-[10px]">
            {lead.priority}
          </Badge>
          {(lead as Record<string, unknown>).urgency === "immediate" && (
            <Flame className="h-3 w-3 text-orange-500" title="Urgente" />
          )}
          {lead.country_name && (
            <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{lead.country_name}</span>
          )}
          {lead.score > 0 && (
            <span className="text-[10px] text-muted-foreground">score {lead.score}</span>
          )}
        </CardContent>
      </div>
      <div className="border-t border-border/40 px-3 py-1.5 bg-muted/15">
        <Link
          to={`/pipeline/leads/${lead.id}`}
          className="text-xs font-medium text-primary hover:underline"
          onPointerDown={(e) => e.stopPropagation()}
        >
          Ver detalle
        </Link>
      </div>
    </Card>
  );
}

function StageColumn({ stage, leads, tasksByLead }: { stage: PipelineStage; leads: Lead[]; tasksByLead: Map<string, LeadTaskSummary> }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div className="flex flex-col min-w-[260px] max-w-[320px] flex-1 h-[min(70vh,640px)]">
      <div
        className="rounded-t-lg px-3 py-2 text-sm font-medium text-white shrink-0"
        style={{ backgroundColor: stage.color }}
      >
        {stage.name}
        <span className="ml-2 opacity-90">({leads.length})</span>
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 rounded-b-lg border border-t-0 bg-muted/30 p-2 min-h-[200px] ${
          isOver ? "ring-2 ring-primary ring-offset-2" : ""
        }`}
      >
        <ScrollArea className="h-full pr-2">
          <div className="flex flex-col gap-2 pb-4">
            {leads.map((l) => (
              <LeadCard key={l.id} lead={l} stageColor={stage.color} taskSummary={tasksByLead.get(l.id)} />
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function NewLeadDialog({ registradoStageId }: { registradoStageId: string | null }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const createLead = useCreateLead();
  const { data: orgId } = useQuery({
    queryKey: ["user-org-pipeline"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.rpc("get_user_org_id", { _user_id: u.user.id });
      return data as string | null;
    },
  });

  const submit = async () => {
    if (!name.trim() || !orgId || !registradoStageId) {
      toast.error("Nombre y etapa inicial requeridos");
      return;
    }
    try {
      const row = await createLead.mutateAsync({
        organization_id: orgId,
        full_name: name.trim(),
        email: email.trim() || null,
        stage_id: registradoStageId,
        source: "manual",
      });
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        await supabase.from("lead_activities").insert({
          lead_id: row.id,
          user_id: u.user.id,
          type: "lead_created",
          metadata: { source: "manual" },
        });
      }
      toast.success("Lead creado");
      setOpen(false);
      setName("");
      setEmail("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al crear");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={!registradoStageId}>
          <Plus className="h-4 w-4 mr-1" />
          Nuevo lead
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo lead manual</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nombre completo</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mar\u00eda P\u00e9rez" />
          </div>
          <div>
            <Label>Email (opcional)</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="correo@ejemplo.com"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={createLead.isPending}>
            Guardar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isToday(date: Date): boolean {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

export default function PipelineBoard() {
  const { data: stages = [], isLoading: ls } = usePipelineStages();
  const { data: leads = [], isLoading: ll } = usePipelineLeads(true);
  const moveStage = useMoveLeadStage();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // Fetch all pending tasks for badge indicators
  const { data: allTasks = [] } = useQuery({
    queryKey: ["pipeline-kanban-tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_tasks" as never)
        .select("id, lead_id, due_date, is_completed, task_type")
        .eq("is_completed", false);
      if (error) return [];
      return (data || []) as Array<{ id: string; lead_id: string; due_date: string; is_completed: boolean; task_type: string }>;
    },
  });

  const tasksByLead = useMemo(() => {
    const m = new Map<string, LeadTaskSummary>();
    const now = new Date();
    for (const t of allTasks) {
      const dueDate = new Date(t.due_date);
      const existing = m.get(t.lead_id) || { hasOverdue: false, hasToday: false, hasFuture: false, hasTasks: false };
      existing.hasTasks = true;
      if (dueDate < now && !isToday(dueDate)) existing.hasOverdue = true;
      else if (isToday(dueDate)) existing.hasToday = true;
      else existing.hasFuture = true;
      m.set(t.lead_id, existing);
    }
    return m;
  }, [allTasks]);

  const registradoStageId = useMemo(
    () => stages.find((s) => s.slug === "registrado")?.id ?? null,
    [stages],
  );

  const byStage = useMemo(() => {
    const m = new Map<string, Lead[]>();
    for (const s of stages) m.set(s.id, []);
    for (const l of leads) {
      const arr = m.get(l.stage_id);
      if (arr) arr.push(l);
    }
    return m;
  }, [stages, leads]);

  const onDragEnd = async (e: DragEndEvent) => {
    const leadId = String(e.active.id);
    const overId = e.over?.id;
    if (!overId) return;
    let newStageId: string | null = null;
    if (stages.some((s) => s.id === String(overId))) {
      newStageId = String(overId);
    } else {
      const targetLead = leads.find((l) => l.id === String(overId));
      if (targetLead) newStageId = targetLead.stage_id;
    }
    if (!newStageId || newStageId === e.active.data.current?.lead?.stage_id) return;
    try {
      await moveStage.mutateAsync({ leadId, newStageId });
      toast.success("Etapa actualizada");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "No se pudo mover");
    }
  };

  if (ls || ll) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[400px] w-[280px] shrink-0" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <NewLeadDialog registradoStageId={registradoStageId} />
      </div>
      <p className="text-xs text-muted-foreground px-0.5">
        Arrastra la tarjeta por el nombre o el \u00e1rea del lead; usa <strong>Ver detalle</strong> para abrir la ficha.
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4 items-stretch">
          {stages.map((stage) => (
            <StageColumn key={stage.id} stage={stage} leads={byStage.get(stage.id) || []} tasksByLead={tasksByLead} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
