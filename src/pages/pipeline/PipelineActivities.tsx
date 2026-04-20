import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useAllTasks,
  useCompleteTask,
  useRescheduleTask,
  usePipelineLeads,
  usePipelineStages,
  type LeadTask,
} from "@/hooks/usePipeline";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Phone,
  Mail,
  MessageCircle,
  Calendar,
  CheckSquare,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  Sparkles,
  Send,
} from "lucide-react";
import { SendEmailModal } from "@/components/pipeline/modals/SendEmailModal";
import { supabase } from "@/integrations/supabase/client";
import { KAWIIL_AI_GRADIENT, KAWIIL_AI_SOFT_BG } from "@/lib/kawiilAi";
import { stageBadgeStyle } from "@/lib/pipelineFormat";

const taskTypeIcons: Record<string, typeof Phone> = {
  call: Phone,
  email: Mail,
  whatsapp: MessageCircle,
  meeting: Calendar,
  task: CheckSquare,
  follow_up: RotateCcw,
};

interface EmailModalState {
  leadId: string;
  leadName: string;
  leadEmail: string | null;
}

function TaskCard({
  task,
  onOpenEmail,
}: {
  task: LeadTask;
  onOpenEmail: (payload: EmailModalState) => void;
}) {
  const completeTask = useCompleteTask();
  const rescheduleTask = useRescheduleTask();
  const [showReschedule, setShowReschedule] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [drafting, setDrafting] = useState(false);

  const Icon = taskTypeIcons[task.task_type] || CheckSquare;
  const isOverdue = new Date(task.due_date) < new Date();
  const leadInfo = task.leads;
  const stageName = leadInfo?.pipeline_stages?.name;
  const stageColor = leadInfo?.pipeline_stages?.color;
  const leadPhone = leadInfo?.phone ?? null;

  const handleComplete = async () => {
    try {
      await completeTask.mutateAsync({ taskId: task.id, leadId: task.lead_id });
      toast.success("Tarea completada");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const handleReschedule = async () => {
    if (!newDate) return;
    try {
      await rescheduleTask.mutateAsync({ taskId: task.id, leadId: task.lead_id, newDate });
      toast.success("Tarea reprogramada");
      setShowReschedule(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error");
    }
  };

  const draftWithAi = async () => {
    if (!leadInfo) {
      toast.error("Sin información del lead");
      return;
    }
    setDrafting(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-email-draft", {
        body: {
          action: "draft",
          instruction: `Redacta un correo de seguimiento para ${leadInfo.full_name} sobre la siguiente tarea pendiente: ${task.title}. ${task.description ?? ""}`.trim(),
          tone: "cordial",
          context: { subject: task.title, to: leadInfo.email ?? "" },
        },
      });
      if (error) throw error;
      const text = (data as { text?: string } | null)?.text ?? "";
      if (text) {
        try {
          await navigator.clipboard.writeText(text);
          toast.success("Borrador generado y copiado al portapapeles", {
            description: "Abrimos el compositor para que solo pegues.",
          });
        } catch {
          toast.success("Borrador generado", { description: text.slice(0, 140) });
        }
      }
      onOpenEmail({ leadId: task.lead_id, leadName: leadInfo.full_name, leadEmail: leadInfo.email });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al redactar");
    } finally {
      setDrafting(false);
    }
  };

  const primaryCta = () => {
    if (task.task_type === "call" && leadPhone) {
      return (
        <Button asChild size="sm" className="h-7 text-xs">
          <a href={`tel:${leadPhone}`}>
            <Phone className="h-3 w-3 mr-1" />
            Ir a llamada
          </a>
        </Button>
      );
    }
    if (task.task_type === "email" && leadInfo?.email) {
      return (
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() =>
            onOpenEmail({
              leadId: task.lead_id,
              leadName: leadInfo.full_name,
              leadEmail: leadInfo.email,
            })
          }
        >
          <Send className="h-3 w-3 mr-1" />
          Enviar
        </Button>
      );
    }
    return (
      <Button
        size="sm"
        className="h-7 text-xs text-white border-0"
        style={{ background: KAWIIL_AI_GRADIENT }}
        onClick={() => void draftWithAi()}
        disabled={drafting}
      >
        <Sparkles className="h-3 w-3 mr-1" />
        {drafting ? "Redactando…" : "Redactar con IA"}
      </Button>
    );
  };

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={`rounded-full p-2 shrink-0 ${
              isOverdue ? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400" : "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400"
            }`}
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {leadInfo ? (
                <Link
                  to={`/pipeline/leads/${task.lead_id}`}
                  className="text-sm font-semibold text-foreground hover:underline"
                >
                  {leadInfo.full_name}
                </Link>
              ) : null}
              {stageName ? (
                <span
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                  style={stageBadgeStyle({ color: stageColor ?? "#64748B" })}
                >
                  {stageName}
                </span>
              ) : null}
              <Badge
                variant={
                  task.priority === "urgent"
                    ? "destructive"
                    : task.priority === "high"
                      ? "default"
                      : "secondary"
                }
                className="text-[10px]"
              >
                {task.priority}
              </Badge>
            </div>
            <p className="text-sm mt-1 leading-tight">{task.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(task.due_date).toLocaleString("es-MX", {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
            {task.notes ? <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{task.notes}</p> : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 pl-11">
          {primaryCta()}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => void handleComplete()}
            disabled={completeTask.isPending}
          >
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Completar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setShowReschedule((v) => !v)}
          >
            <Clock className="h-3 w-3 mr-1" />
            Reprogramar
          </Button>
        </div>
        {showReschedule ? (
          <div className="flex items-center gap-2 mt-3 pl-11">
            <Input
              type="datetime-local"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => void handleReschedule()}
              disabled={rescheduleTask.isPending || !newDate}
            >
              Guardar
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ColumnHeader({
  title,
  count,
  icon: Icon,
  tone,
  subtitle,
}: {
  title: string;
  count: number;
  icon: typeof AlertTriangle;
  tone: "destructive" | "primary";
  subtitle: string;
}) {
  const cls =
    tone === "destructive"
      ? "text-destructive"
      : "text-primary";
  const bg =
    tone === "destructive"
      ? "bg-destructive/10"
      : "bg-primary/10";
  return (
    <div className="flex items-start justify-between gap-2 mb-3">
      <div className="flex items-start gap-2.5">
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${bg} ${cls}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div>
          <h2 className={`text-sm font-bold ${cls}`}>
            {title}
            <span className="ml-2 inline-flex min-w-[22px] items-center justify-center rounded-full bg-foreground/10 px-1.5 text-[11px] font-bold tabular-nums text-foreground">
              {count}
            </span>
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}

export default function PipelineActivities() {
  const { data: overdue = [], isLoading: lo } = useAllTasks("overdue");
  const { data: today = [], isLoading: lt } = useAllTasks("today");
  const { data: upcoming = [], isLoading: lu } = useAllTasks("upcoming");
  const { data: leads = [] } = usePipelineLeads(true);
  const { data: stages = [] } = usePipelineStages();

  const [emailModal, setEmailModal] = useState<EmailModalState | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);

  const staleLeads = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return leads
      .filter((l) => {
        const stage = stages.find((s) => s.id === l.stage_id);
        if (!stage || stage.is_terminal) return false;
        const leadAny = l as Record<string, unknown>;
        const last = leadAny.last_activity_at as string | null;
        if (!last) return true;
        return new Date(last).getTime() < sevenDaysAgo;
      })
      .slice(0, 20);
  }, [leads, stages]);

  const handleOpenEmail = (payload: EmailModalState) => setEmailModal(payload);
  const handleCloseEmail = () => setEmailModal(null);

  const runBulkFollowUp = async () => {
    if (staleLeads.length === 0) return;
    setBulkRunning(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) throw new Error("Sin sesión");
      const dueDate = new Date();
      dueDate.setHours(dueDate.getHours() + 1);
      const inserts = staleLeads.map((l) => ({
        lead_id: l.id,
        assigned_to: u.user.id,
        created_by: u.user.id,
        title: `Follow-up sugerido por Kawiil AI · ${l.full_name}`,
        description: "Lead inactivo 7+ días. Kawiil sugiere un toque de seguimiento.",
        task_type: "follow_up",
        due_date: dueDate.toISOString(),
        priority: "high",
      }));
      const { error } = await supabase.from("lead_tasks" as never).insert(inserts as never);
      if (error) throw error;
      toast.success(`Programé ${inserts.length} follow-ups`, {
        description: "Se crearon tareas de seguimiento para los leads inactivos.",
      });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "No se pudo ejecutar el follow-up masivo");
    } finally {
      setBulkRunning(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 2 columnas: Vencidas | Hoy */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section>
          <ColumnHeader
            title="Vencidas"
            count={overdue.length}
            icon={AlertTriangle}
            tone="destructive"
            subtitle="Necesitan tu atención inmediata"
          />
          {lo ? (
            <div className="space-y-2">
              <Skeleton className="h-[120px] w-full" />
              <Skeleton className="h-[120px] w-full" />
            </div>
          ) : overdue.length === 0 ? (
            <Card>
              <CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">
                Sin tareas vencidas. ¡Buen trabajo!
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {overdue.map((t) => (
                <TaskCard key={t.id} task={t} onOpenEmail={handleOpenEmail} />
              ))}
            </div>
          )}
        </section>

        <section>
          <ColumnHeader
            title="Hoy"
            count={today.length}
            icon={Clock}
            tone="primary"
            subtitle="Programa de actividades del día"
          />
          {lt ? (
            <div className="space-y-2">
              <Skeleton className="h-[120px] w-full" />
              <Skeleton className="h-[120px] w-full" />
            </div>
          ) : today.length === 0 ? (
            <Card>
              <CardContent className="px-4 py-8 text-center text-sm text-muted-foreground">
                Sin tareas para hoy. Revisa los próximos 7 días.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {today.map((t) => (
                <TaskCard key={t.id} task={t} onOpenEmail={handleOpenEmail} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Próximos 7 días */}
      <section>
        <div className="flex items-center gap-2 mb-3 text-muted-foreground">
          <Calendar className="h-4 w-4" />
          <h2 className="text-sm font-semibold">Próximos 7 días</h2>
          <Badge variant="outline" className="text-[10px]">
            {upcoming.length}
          </Badge>
        </div>
        {lu ? (
          <Skeleton className="h-[120px] w-full" />
        ) : upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground px-2">Sin tareas próximas.</p>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {upcoming.map((t) => (
              <TaskCard key={t.id} task={t} onOpenEmail={handleOpenEmail} />
            ))}
          </div>
        )}
      </section>

      {/* Stale leads block con bulk follow-up IA */}
      {staleLeads.length > 0 ? (
        <section
          className="rounded-2xl border border-border/60 p-4 sm:p-5 shadow-sm"
          style={{ background: KAWIIL_AI_SOFT_BG }}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-600">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-sm font-bold inline-flex items-center gap-2">
                  Leads sin actividad 7+ días
                  <span className="inline-flex min-w-[22px] items-center justify-center rounded-full bg-foreground/10 px-1.5 text-[11px] font-bold tabular-nums">
                    {staleLeads.length}
                  </span>
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Kawiil puede programar un toque de seguimiento para todos en un clic.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              className="h-8 text-xs text-white border-0 shrink-0"
              style={{ background: KAWIIL_AI_GRADIENT }}
              onClick={() => void runBulkFollowUp()}
              disabled={bulkRunning}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              {bulkRunning ? "Programando…" : "Enviar Follow-up masivo IA"}
            </Button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {staleLeads.map((l) => {
              const stage = stages.find((s) => s.id === l.stage_id);
              return (
                <Card key={l.id} className="shadow-sm">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{l.full_name}</p>
                      {l.company_name ? (
                        <p className="text-xs text-muted-foreground truncate">{l.company_name}</p>
                      ) : null}
                    </div>
                    {stage ? (
                      <span
                        className="inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                        style={stageBadgeStyle(stage)}
                      >
                        {stage.name}
                      </span>
                    ) : null}
                    <Button variant="ghost" size="sm" className="shrink-0 h-7" asChild>
                      <Link to={`/pipeline/leads/${l.id}`}>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      {emailModal ? (
        <SendEmailModal
          open={!!emailModal}
          onClose={handleCloseEmail}
          leadId={emailModal.leadId}
          leadName={emailModal.leadName}
          leadEmail={emailModal.leadEmail}
        />
      ) : null}
    </div>
  );
}
