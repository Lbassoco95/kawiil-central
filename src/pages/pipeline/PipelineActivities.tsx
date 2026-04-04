import { useState } from "react";
import { Link } from "react-router-dom";
import { useAllTasks, useCompleteTask, useRescheduleTask, usePipelineLeads, usePipelineStages, type LeadTask } from "@/hooks/usePipeline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";

const taskTypeIcons: Record<string, typeof Phone> = {
  call: Phone,
  email: Mail,
  whatsapp: MessageCircle,
  meeting: Calendar,
  task: CheckSquare,
  follow_up: RotateCcw,
};

function TaskCard({ task }: { task: LeadTask }) {
  const completeTask = useCompleteTask();
  const rescheduleTask = useRescheduleTask();
  const [showReschedule, setShowReschedule] = useState(false);
  const [newDate, setNewDate] = useState("");

  const Icon = taskTypeIcons[task.task_type] || CheckSquare;
  const isOverdue = new Date(task.due_date) < new Date();
  const leadInfo = task.leads;
  const stageName = leadInfo?.pipeline_stages?.name;
  const stageColor = leadInfo?.pipeline_stages?.color;

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

  return (
    <Card className="shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className={`rounded-full p-2 shrink-0 ${isOverdue ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {leadInfo && (
                <Link
                  to={`/pipeline/leads/${task.lead_id}`}
                  className="text-sm font-medium text-primary hover:underline"
                >
                  {leadInfo.full_name}
                </Link>
              )}
              {stageName && (
                <Badge
                  variant="outline"
                  className="text-[10px]"
                  style={stageColor ? { borderColor: stageColor, color: stageColor } : undefined}
                >
                  {stageName}
                </Badge>
              )}
              <Badge variant={task.priority === "urgent" ? "destructive" : task.priority === "high" ? "default" : "secondary"} className="text-[10px]">
                {task.priority}
              </Badge>
            </div>
            <p className="text-sm mt-1">{task.title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(task.due_date).toLocaleString("es-MX", {
                weekday: "short",
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
            {task.notes && (
              <p className="text-xs text-muted-foreground mt-1 truncate">{task.notes}</p>
            )}
          </div>
          <div className="flex flex-col gap-1 shrink-0">
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
              onClick={() => setShowReschedule(!showReschedule)}
            >
              <Clock className="h-3 w-3 mr-1" />
              Reprogramar
            </Button>
          </div>
        </div>
        {showReschedule && (
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
        )}
      </CardContent>
    </Card>
  );
}

function TaskSection({
  title,
  icon: SectionIcon,
  tasks,
  color,
  emptyText,
  isLoading,
}: {
  title: string;
  icon: typeof AlertTriangle;
  tasks: LeadTask[];
  color: string;
  emptyText: string;
  isLoading: boolean;
}) {
  if (isLoading) return <Skeleton className="h-[120px] w-full" />;

  return (
    <div>
      <div className={`flex items-center gap-2 mb-3 ${color}`}>
        <SectionIcon className="h-4 w-4" />
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge variant="outline" className="text-[10px]">
          {tasks.length}
        </Badge>
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground py-3 px-2">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function PipelineActivities() {
  const { data: overdue = [], isLoading: lo } = useAllTasks("overdue");
  const { data: today = [], isLoading: lt } = useAllTasks("today");
  const { data: upcoming = [], isLoading: lu } = useAllTasks("upcoming");
  const { data: leads = [] } = usePipelineLeads(true);
  const { data: stages = [] } = usePipelineStages();

  // Stale leads: active, non-terminal, no recent activity
  const staleLeads = leads.filter((l) => {
    const stage = stages.find((s) => s.id === l.stage_id);
    if (!stage || stage.is_terminal) return false;
    const leadAny = l as Record<string, unknown>;
    const lastActivity = leadAny.last_activity_at as string | null;
    if (!lastActivity) return true;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return new Date(lastActivity) < sevenDaysAgo;
  }).slice(0, 20);

  return (
    <div className="space-y-6">
      <TaskSection
        title="Tareas vencidas"
        icon={AlertTriangle}
        tasks={overdue}
        color="text-red-600"
        emptyText="Sin tareas vencidas"
        isLoading={lo}
      />

      <TaskSection
        title="Tareas de hoy"
        icon={Clock}
        tasks={today}
        color="text-blue-600"
        emptyText="Sin tareas para hoy"
        isLoading={lt}
      />

      <TaskSection
        title="Pr\u00f3ximos 7 d\u00edas"
        icon={Calendar}
        tasks={upcoming}
        color="text-muted-foreground"
        emptyText="Sin tareas pr\u00f3ximas"
        isLoading={lu}
      />

      {/* Stale leads */}
      {staleLeads.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3 text-amber-600">
            <AlertTriangle className="h-4 w-4" />
            <h3 className="text-sm font-semibold">Leads sin actividad reciente</h3>
            <Badge variant="outline" className="text-[10px]">
              {staleLeads.length}
            </Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {staleLeads.map((l) => {
              const stage = stages.find((s) => s.id === l.stage_id);
              return (
                <Card key={l.id} className="shadow-sm">
                  <CardContent className="p-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{l.full_name}</p>
                      {l.company_name && (
                        <p className="text-xs text-muted-foreground truncate">{l.company_name}</p>
                      )}
                    </div>
                    {stage && (
                      <Badge variant="outline" className="text-[10px] shrink-0" style={{ borderColor: stage.color, color: stage.color }}>
                        {stage.name}
                      </Badge>
                    )}
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
        </div>
      )}
    </div>
  );
}
