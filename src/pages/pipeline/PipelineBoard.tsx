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
import {
  usePipelineStages,
  usePipelineLeads,
  useMoveLeadStage,
  useCreateLead,
  aggregateStageValues,
  type Lead,
  type PipelineStage,
} from "@/hooks/usePipeline";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, Flame, Mail, Phone, Sparkles, ArrowRight, Filter } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { leadMatchesPipelineSearch } from "@/lib/pipelineSearch";
import {
  formatMxnShort,
  flagForCountry,
  initialsFromName,
  avatarBgFromName,
  scoreDotColor,
  stageCta,
  hexToRgba,
} from "@/lib/pipelineFormat";
import { cn } from "@/lib/utils";
import { KAWIIL_AI_SOFT_BG } from "@/lib/kawiilAi";

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

function LeadCard({ lead, stage, taskSummary }: { lead: Lead; stage: PipelineStage | undefined; taskSummary?: LeadTaskSummary }) {
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

  const stageColor = stage?.color ?? "#64748B";
  const value = (lead as Lead & { estimated_value?: number | null }).estimated_value;
  const isHot =
    (lead as Record<string, unknown>).urgency === "immediate" ||
    lead.priority === "urgent" ||
    lead.priority === "high";
  const flag = flagForCountry(lead.country_code);
  const cta = stageCta(stage?.slug);
  const hasInsight = !!(lead.notes && lead.notes.trim().length > 0);
  const insight = hasInsight ? lead.notes!.split("\n")[0].slice(0, 140) : null;

  return (
    <Card
      className="overflow-hidden border-border/50 bg-card shadow-sm"
      style={{ borderLeftWidth: 4, borderLeftColor: stageColor }}
    >
      <div
        ref={setNodeRef}
        style={dragStyle}
        {...listeners}
        {...attributes}
        className="cursor-grab active:cursor-grabbing select-none touch-manipulation"
      >
        <CardHeader className="p-3 pb-2 flex flex-row items-start gap-2 space-y-0">
          <span
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
            style={{ backgroundColor: avatarBgFromName(lead.full_name) }}
            aria-hidden
          >
            {initialsFromName(lead.full_name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="font-semibold text-sm truncate">{lead.full_name}</p>
              {isHot ? <Flame className="h-3 w-3 text-orange-500 shrink-0" aria-hidden /> : null}
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              {[lead.company_name, lead.country_code ? `${flag}` : null].filter(Boolean).join(" · ")}
            </p>
          </div>
          <span
            className="inline-flex items-center gap-1 rounded-full bg-muted/70 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums shrink-0"
            style={{ color: scoreDotColor(lead.score) }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: scoreDotColor(lead.score) }} aria-hidden />
            {lead.score ?? 0}
          </span>
        </CardHeader>
        <CardContent className="p-3 pt-1 space-y-2">
          {insight ? (
            <div
              className="flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] leading-snug text-foreground/85"
              style={{ background: KAWIIL_AI_SOFT_BG }}
            >
              <Sparkles className="h-3 w-3 shrink-0 mt-0.5 text-sky-500" aria-hidden />
              <span className="line-clamp-2">{insight}</span>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-1.5">
            {getTaskIndicator(taskSummary)}
            {lead.campaign_name ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                <span aria-hidden>📣</span>
                <span className="max-w-[100px] truncate">{lead.campaign_name}</span>
              </span>
            ) : null}
            {value ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                <span aria-hidden>💰</span>
                {formatMxnShort(Number(value))} MXN
              </span>
            ) : null}
          </div>
        </CardContent>
      </div>
      <div className="flex items-center gap-1 border-t border-border/40 bg-muted/20 px-2 py-1.5 backdrop-blur-sm">
        <Link
          to={`/pipeline/leads/${lead.id}`}
          className="inline-flex flex-1 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <ArrowRight className="h-3 w-3" aria-hidden />
          {cta}
        </Link>
        {lead.email ? (
          <a
            href={`mailto:${lead.email}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Enviar correo a ${lead.full_name}`}
            title="Enviar correo"
          >
            <Mail className="h-3.5 w-3.5" />
          </a>
        ) : null}
        {lead.phone ? (
          <a
            href={`tel:${lead.phone}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Llamar a ${lead.full_name}`}
            title="Llamar"
          >
            <Phone className="h-3.5 w-3.5" />
          </a>
        ) : null}
      </div>
    </Card>
  );
}

function StageColumn({
  stage,
  leads,
  tasksByLead,
  sumMxn,
  onAddLead,
}: {
  stage: PipelineStage;
  leads: Lead[];
  tasksByLead: Map<string, LeadTaskSummary>;
  sumMxn: number;
  onAddLead: (stageId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div className="flex flex-col min-w-[280px] max-w-[320px] flex-1 h-[min(72vh,680px)]">
      <div
        className="rounded-t-lg border-b-4 bg-card px-3 py-2.5 shrink-0"
        style={{ borderBottomColor: stage.color }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: stage.color }}>
              {stage.name}
            </p>
            <p className="text-[11px] text-muted-foreground font-medium tabular-nums">
              {sumMxn > 0 ? `${formatMxnShort(sumMxn)} MXN` : "$0 MXN"}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="inline-flex min-w-[22px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums leading-[18px]"
              style={{
                backgroundColor: hexToRgba(stage.color, 0.14),
                color: stage.color,
              }}
            >
              {leads.length}
            </span>
            <button
              type="button"
              onClick={() => onAddLead(stage.id)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              title={`Agregar lead a ${stage.name}`}
              aria-label={`Agregar lead a ${stage.name}`}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex-1 rounded-b-lg border border-t-0 border-border/50 bg-muted/20 p-2 min-h-[200px]",
          isOver && "ring-2 ring-primary ring-offset-2",
        )}
      >
        <ScrollArea className="h-full pr-2">
          <div className="flex flex-col gap-2 pb-4">
            {leads.map((l) => (
              <LeadCard key={l.id} lead={l} stage={stage} taskSummary={tasksByLead.get(l.id)} />
            ))}
            {leads.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center">
                <p className="text-[11px] text-muted-foreground">Sin leads en esta etapa.</p>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

function NewLeadDialog({
  stages,
  defaultStageId,
  open,
  onOpenChange,
}: {
  stages: PipelineStage[];
  defaultStageId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [estimatedValue, setEstimatedValue] = useState<string>("");
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

  const stageLabel = useMemo(
    () => stages.find((s) => s.id === defaultStageId)?.name ?? "etapa inicial",
    [stages, defaultStageId],
  );

  const submit = async () => {
    if (!name.trim() || !orgId || !defaultStageId) {
      toast.error("Nombre y etapa inicial requeridos");
      return;
    }
    try {
      const row = await createLead.mutateAsync({
        organization_id: orgId,
        full_name: name.trim(),
        email: email.trim() || null,
        stage_id: defaultStageId,
        source: "manual",
        estimated_value: estimatedValue ? Number(estimatedValue) : null,
      });
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        await supabase.from("lead_activities").insert({
          lead_id: row.id,
          user_id: u.user.id,
          type: "lead_created",
          metadata: { source: "manual" },
          organization_id: orgId,
        });
      }
      toast.success("Lead creado");
      onOpenChange(false);
      setName("");
      setEmail("");
      setEstimatedValue("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al crear");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nuevo lead · {stageLabel}</DialogTitle>
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
          <div>
            <Label>Monto estimado MXN (opcional)</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              value={estimatedValue}
              onChange={(e) => setEstimatedValue(e.target.value)}
              placeholder="45000"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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

type BoardFilter = "all" | "hot" | "risk" | "mine";

export default function PipelineBoard() {
  const { data: stages = [], isLoading: ls } = usePipelineStages();
  const { data: leadsRaw = [], isLoading: ll } = usePipelineLeads(true);
  const [searchParams] = useSearchParams();
  const pipelineQ = searchParams.get("q") ?? "";
  const [filter, setFilter] = useState<BoardFilter>("all");
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [newLeadStageId, setNewLeadStageId] = useState<string | null>(null);
  const moveStage = useMoveLeadStage();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const { data: currentUserId } = useQuery({
    queryKey: ["current-auth-user"],
    queryFn: async () => {
      const { data } = await supabase.auth.getUser();
      return data.user?.id ?? null;
    },
  });

  const leads = useMemo(() => {
    const byQuery = leadsRaw.filter((l) => leadMatchesPipelineSearch(l, pipelineQ));
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const stageMap = new Map(stages.map((s) => [s.id, s] as const));
    switch (filter) {
      case "hot":
        return byQuery.filter((l) => {
          const urgency = (l as Record<string, unknown>).urgency as string | undefined;
          return (
            urgency === "immediate" ||
            l.priority === "urgent" ||
            l.priority === "high" ||
            (l.score ?? 0) >= 80
          );
        });
      case "risk": {
        return byQuery.filter((l) => {
          const stage = stageMap.get(l.stage_id);
          if (stage?.is_terminal) return false;
          const last = (l as Record<string, unknown>).last_activity_at as string | null | undefined;
          if (!last) return true;
          return new Date(last).getTime() < sevenDaysAgo;
        });
      }
      case "mine":
        return byQuery.filter((l) => l.owner_id && l.owner_id === currentUserId);
      default:
        return byQuery;
    }
  }, [leadsRaw, pipelineQ, filter, stages, currentUserId]);

  const stageAgg = useMemo(() => aggregateStageValues(leads), [leads]);

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
    () => stages.find((s) => s.slug === "registrado")?.id ?? stages[0]?.id ?? null,
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

  const openNewLead = (stageId: string) => {
    setNewLeadStageId(stageId);
    setNewLeadOpen(true);
  };

  const counts = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const stageMap = new Map(stages.map((s) => [s.id, s] as const));
    return {
      all: leadsRaw.length,
      hot: leadsRaw.filter((l) => {
        const urgency = (l as Record<string, unknown>).urgency as string | undefined;
        return (
          urgency === "immediate" ||
          l.priority === "urgent" ||
          l.priority === "high" ||
          (l.score ?? 0) >= 80
        );
      }).length,
      risk: leadsRaw.filter((l) => {
        const stage = stageMap.get(l.stage_id);
        if (stage?.is_terminal) return false;
        const last = (l as Record<string, unknown>).last_activity_at as string | null | undefined;
        if (!last) return true;
        return new Date(last).getTime() < sevenDaysAgo;
      }).length,
      mine: leadsRaw.filter((l) => l.owner_id && l.owner_id === currentUserId).length,
    };
  }, [leadsRaw, stages, currentUserId]);

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")} count={counts.all} tone="primary">
            Todos
          </FilterChip>
          <FilterChip active={filter === "hot"} onClick={() => setFilter("hot")} count={counts.hot} tone="hot">
            <Flame className="h-3 w-3" />
            Calientes
          </FilterChip>
          <FilterChip active={filter === "risk"} onClick={() => setFilter("risk")} count={counts.risk} tone="warning">
            En riesgo
          </FilterChip>
          <FilterChip active={filter === "mine"} onClick={() => setFilter("mine")} count={counts.mine} tone="neutral">
            Míos
          </FilterChip>
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground">
            <Filter className="h-3 w-3 mr-1" />
            Más filtros
          </Button>
        </div>
        <Button size="sm" onClick={() => openNewLead(registradoStageId!)} disabled={!registradoStageId}>
          <Plus className="h-4 w-4 mr-1" />
          Nuevo lead
        </Button>
      </div>
      {pipelineQ.trim() ? (
        <p className="text-xs text-muted-foreground">
          Búsqueda activa: se muestran <strong>{leads.length}</strong> lead(s) que coinciden.
        </p>
      ) : null}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragEnd={onDragEnd}>
        <div className="flex gap-3 overflow-x-auto pb-4 items-stretch">
          {stages.map((stage) => (
            <StageColumn
              key={stage.id}
              stage={stage}
              leads={byStage.get(stage.id) || []}
              tasksByLead={tasksByLead}
              sumMxn={stageAgg.get(stage.id)?.sumMxn ?? 0}
              onAddLead={openNewLead}
            />
          ))}
        </div>
      </DndContext>
      <NewLeadDialog
        stages={stages}
        defaultStageId={newLeadStageId}
        open={newLeadOpen}
        onOpenChange={setNewLeadOpen}
      />
    </div>
  );
}

// ─── FilterChip ──────────────────────────────────────────────────────────────

function FilterChip({
  active,
  onClick,
  count,
  children,
  tone = "neutral",
}: {
  active: boolean;
  onClick: () => void;
  count?: number;
  children: React.ReactNode;
  tone?: "neutral" | "primary" | "hot" | "warning";
}) {
  const activeCls =
    tone === "primary"
      ? "bg-primary text-primary-foreground"
      : tone === "hot"
        ? "bg-orange-500 text-white"
        : tone === "warning"
          ? "bg-amber-500 text-white"
          : "bg-foreground text-background";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        active
          ? activeCls
          : "border-border/60 bg-card text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      )}
    >
      {children}
      {typeof count === "number" ? (
        <span
          className={cn(
            "inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums leading-[16px]",
            active ? "bg-white/25" : "bg-muted/70",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
