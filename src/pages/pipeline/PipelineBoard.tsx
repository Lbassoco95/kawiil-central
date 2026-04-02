import { useMemo, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { usePipelineStages, usePipelineLeads, useMoveLeadStage, type Lead, type PipelineStage } from "@/hooks/usePipeline";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, GripVertical } from "lucide-react";
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
import { useNavigate } from "react-router-dom";

const priorityVariant: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  urgent: "destructive",
  high: "default",
  medium: "secondary",
  low: "outline",
};

function LeadCard({ lead, stageColor }: { lead: Lead; stageColor: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { lead },
  });
  const navigate = useNavigate();
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, opacity: isDragging ? 0.5 : 1 }
    : undefined;

  return (
    <Card
      ref={setNodeRef}
      style={{ ...style, borderLeftWidth: 4, borderLeftColor: stageColor }}
      className="cursor-grab active:cursor-grabbing shadow-sm"
      onClick={() => navigate(`/pipeline/leads/${lead.id}`)}
    >
      <CardHeader className="p-3 pb-0 flex flex-row items-start gap-2 space-y-0">
        <button
          type="button"
          className="touch-none text-muted-foreground hover:text-foreground p-0.5 -ml-0.5"
          {...listeners}
          {...attributes}
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-sm truncate">{lead.full_name}</p>
          {lead.company_name && (
            <p className="text-xs text-muted-foreground truncate">{lead.company_name}</p>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-2 flex flex-wrap gap-1 items-center">
        <Badge variant={priorityVariant[lead.priority] || "secondary"} className="text-[10px]">
          {lead.priority}
        </Badge>
        {lead.country_name && (
          <span className="text-[10px] text-muted-foreground truncate max-w-[120px]">{lead.country_name}</span>
        )}
        {lead.score > 0 && (
          <span className="text-[10px] text-muted-foreground">score {lead.score}</span>
        )}
      </CardContent>
    </Card>
  );
}

function StageColumn({ stage, leads }: { stage: PipelineStage; leads: Lead[] }) {
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
              <LeadCard key={l.id} lead={l} stageColor={stage.color} />
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
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="María Pérez" />
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

export default function PipelineBoard() {
  const { data: stages = [], isLoading: ls } = usePipelineStages();
  const { data: leads = [], isLoading: ll } = usePipelineLeads(true);
  const moveStage = useMoveLeadStage();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

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
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4 items-stretch">
          {stages.map((stage) => (
            <StageColumn key={stage.id} stage={stage} leads={byStage.get(stage.id) || []} />
          ))}
        </div>
      </DndContext>
    </div>
  );
}
