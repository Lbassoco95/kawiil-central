import { useCallback, useMemo, useState } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Plus,
  Flame,
  Sparkles,
  ArrowRight,
  Filter,
  Mail,
  X,
  CheckSquare,
  ArrowRightLeft,
} from "lucide-react";
import { BulkEmailModal } from "@/components/pipeline/modals/BulkEmailModal";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

function LeadCard({
  lead,
  stage,
  taskSummary,
  selected,
  onToggleSelected,
}: {
  lead: Lead;
  stage: PipelineStage | undefined;
  taskSummary?: LeadTaskSummary;
  selected: boolean;
  onToggleSelected: (leadId: string) => void;
}) {
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
  const hasInsight = !!(lead.notes && lead.notes.trim().length > 0);
  const insight = hasInsight ? lead.notes!.split("\n")[0].slice(0, 140) : null;

  return (
    <Card
      className={cn(
        // `w-full min-w-0` evita que un nombre largo estire la tarjeta más allá
        // del ancho de la columna (eso empujaba el pie de la tarjeta fuera de vista).
        "w-full min-w-0 max-w-full overflow-hidden border-border/50 bg-card shadow-sm",
        selected && "ring-2 ring-primary ring-offset-1",
      )}
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
      {/* Pie de tarjeta: siempre visible (selección + abrir ficha). */}
      <div className="flex w-full min-w-0 items-center gap-1 border-t border-border/40 bg-muted/20 px-2 py-1.5 backdrop-blur-sm">
        <label
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/60"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          title={`Seleccionar ${lead.full_name}`}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelected(lead.id)}
            aria-label={`Seleccionar ${lead.full_name}`}
            className="h-3.5 w-3.5"
          />
          <span className="hidden sm:inline">Sel.</span>
        </label>
        <Link
          to={`/pipeline/leads/${lead.id}`}
          className="inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-1 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/10"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
          Ver tarjeta
        </Link>
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
  selectedIds,
  onToggleSelected,
  onToggleStageSelection,
}: {
  stage: PipelineStage;
  leads: Lead[];
  tasksByLead: Map<string, LeadTaskSummary>;
  sumMxn: number;
  onAddLead: (stageId: string) => void;
  selectedIds: Set<string>;
  onToggleSelected: (leadId: string) => void;
  onToggleStageSelection: (leadIds: string[], select: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  const allSelected = leads.length > 0 && leads.every((l) => selectedIds.has(l.id));

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
              onClick={() => onToggleStageSelection(leads.map((l) => l.id), !allSelected)}
              disabled={leads.length === 0}
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/70 hover:text-foreground disabled:opacity-40",
                allSelected && "bg-primary/10 text-primary",
              )}
              title={allSelected ? `Quitar selección de ${stage.name}` : `Seleccionar todos en ${stage.name}`}
              aria-label={allSelected ? `Quitar selección de ${stage.name}` : `Seleccionar todos en ${stage.name}`}
            >
              <CheckSquare className="h-3.5 w-3.5" />
            </button>
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
        {/* Scroll nativo: el viewport de Radix ScrollArea usa `display:table`,
            lo que dejaba que las tarjetas crecieran más que la columna y el
            botón "Ver tarjeta" quedara recortado fuera del área visible. */}
        <div className="h-full w-full overflow-x-hidden overflow-y-auto pr-1">
          <div className="flex w-full min-w-0 flex-col gap-2 pb-4">
            {leads.map((l) => (
              <LeadCard
                key={l.id}
                lead={l}
                stage={stage}
                taskSummary={tasksByLead.get(l.id)}
                selected={selectedIds.has(l.id)}
                onToggleSelected={onToggleSelected}
              />
            ))}
            {leads.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/60 px-3 py-6 text-center">
                <p className="text-[11px] text-muted-foreground">Sin leads en esta etapa.</p>
              </div>
            ) : null}
          </div>
        </div>
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkEmailOpen, setBulkEmailOpen] = useState(false);
  const [bulkMoving, setBulkMoving] = useState(false);
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

  const toggleSelected = useCallback((leadId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }, []);

  const toggleStageSelection = useCallback((leadIds: string[], select: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of leadIds) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  /** Solo los leads visibles con el filtro/búsqueda actual. */
  const selectedLeads = useMemo(
    () => leads.filter((l) => selectedIds.has(l.id)),
    [leads, selectedIds],
  );

  const bulkMoveToStage = async (stageId: string) => {
    if (selectedLeads.length === 0) return;
    const pending = selectedLeads.filter((l) => l.stage_id !== stageId);
    if (pending.length === 0) {
      toast.info("Los leads seleccionados ya están en esa etapa");
      return;
    }
    setBulkMoving(true);
    let moved = 0;
    const errors: string[] = [];
    for (const lead of pending) {
      try {
        await moveStage.mutateAsync({ leadId: lead.id, newStageId: stageId });
        moved++;
      } catch (e: unknown) {
        errors.push(`${lead.full_name}: ${e instanceof Error ? e.message : "error"}`);
      }
    }
    setBulkMoving(false);
    if (moved > 0) {
      toast.success(
        errors.length === 0
          ? `${moved} lead(s) movido(s) de etapa`
          : `${moved} movido(s); ${errors.length} con error`,
      );
      clearSelection();
    } else {
      toast.error(errors[0] || "No se pudo mover ningún lead");
    }
  };

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
      {selectedLeads.length > 0 ? (
        <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 shadow-sm backdrop-blur-sm">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary">
            <CheckSquare className="h-4 w-4" />
            {selectedLeads.length} seleccionado(s)
          </span>
          <span className="text-[11px] text-muted-foreground">
            {selectedLeads.filter((l) => (l.email || "").trim()).length} con correo
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setBulkEmailOpen(true)}>
              <Mail className="mr-1 h-4 w-4" />
              Enviar correo
            </Button>
            <Select value="" onValueChange={(v) => void bulkMoveToStage(v)} disabled={bulkMoving}>
              <SelectTrigger className="h-8 w-[190px] text-xs">
                <span className="inline-flex items-center gap-1.5">
                  <ArrowRightLeft className="h-3.5 w-3.5" />
                  <SelectValue placeholder={bulkMoving ? "Moviendo…" : "Mover a etapa…"} />
                </span>
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {stages.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              <X className="mr-1 h-4 w-4" />
              Limpiar
            </Button>
          </div>
        </div>
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
              selectedIds={selectedIds}
              onToggleSelected={toggleSelected}
              onToggleStageSelection={toggleStageSelection}
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
      {bulkEmailOpen ? (
        <BulkEmailModal
          open={bulkEmailOpen}
          onClose={() => setBulkEmailOpen(false)}
          leads={selectedLeads.map((l) => ({
            id: l.id,
            full_name: l.full_name,
            email: l.email,
            company_name: l.company_name,
          }))}
          onSent={clearSelection}
        />
      ) : null}
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
