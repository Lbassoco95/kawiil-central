import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Calendar, ChevronRight, Flame, Sun, CalendarDays, CalendarRange, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { TASK_STATUS_CONFIG } from "@/lib/statusStyles";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  formatMX,
  isPastDueCalendarMX,
  toDateStringMX,
  nowMX,
  addDaysToYmd,
} from "@/lib/dateUtils";

const STATUS = TASK_STATUS_CONFIG;

type MinimalTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  area?: string | null;
  due_date?: string | null;
  project_id?: string | null;
  phase_key?: string | null;
  criticality_level?: string | null;
  delay_category?: string | null;
  clients?: { name?: string | null } | null;
  projects?: { name?: string | null } | null;
};

type BucketKey = "urge" | "hoy" | "semana" | "despues" | "sin_fecha";

interface BucketDef {
  key: BucketKey;
  label: string;
  sub: string;
  Icon: typeof Flame;
  ring: string;
  text: string;
  bg: string;
  defaultOpen: boolean;
}

const BUCKETS: BucketDef[] = [
  {
    key: "urge",
    label: "Urge ya",
    sub: "vencidas o críticas",
    Icon: Flame,
    ring: "border-destructive/30",
    text: "text-destructive",
    bg: "bg-destructive/5",
    defaultOpen: true,
  },
  {
    key: "hoy",
    label: "Hoy y mañana",
    sub: "próximas 48 h",
    Icon: Sun,
    ring: "border-amber-500/30",
    text: "text-amber-600",
    bg: "bg-amber-500/5",
    defaultOpen: true,
  },
  {
    key: "semana",
    label: "Esta semana",
    sub: "vencen en 3-7 días",
    Icon: CalendarDays,
    ring: "border-primary/30",
    text: "text-primary",
    bg: "bg-primary/5",
    defaultOpen: true,
  },
  {
    key: "despues",
    label: "Puede esperar",
    sub: "más allá de 7 días",
    Icon: CalendarRange,
    ring: "border-border/60",
    text: "text-muted-foreground",
    bg: "bg-background/60",
    defaultOpen: false,
  },
  {
    key: "sin_fecha",
    label: "Sin fecha",
    sub: "definir cuándo",
    Icon: HelpCircle,
    ring: "border-border/60",
    text: "text-muted-foreground",
    bg: "bg-background/60",
    defaultOpen: false,
  },
];

function getDateColor(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const weekFromNow = new Date();
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  if (d < now) return "text-destructive font-medium";
  if (d <= weekFromNow) return "text-warning font-medium";
  return "text-muted-foreground";
}

function getPriorityBar(priority: string): string {
  switch (priority) {
    case "urgente":
      return "priority-bar-urgent";
    case "alta":
      return "priority-bar-high";
    case "media":
      return "priority-bar-medium";
    default:
      return "priority-bar-low";
  }
}

function classify(task: MinimalTask, todayYmd: string): BucketKey {
  const isCritical = task.criticality_level === "critico" || task.priority === "urgente";
  const due = task.due_date ?? null;
  if (isCritical && (!due || isPastDueCalendarMX(due))) return "urge";
  if (due && isPastDueCalendarMX(due)) return "urge";
  if (!due) return "sin_fecha";
  // Comparar por strings YYYY-MM-DD evita drift de timezone:
  if (due <= addDaysToYmd(todayYmd, 1)) return "hoy"; // hoy o mañana
  if (due <= addDaysToYmd(todayYmd, 7)) return "semana";
  return "despues";
}

interface Props {
  tasks: MinimalTask[];
  areaColorMap: Map<string, string | undefined>;
  getCelulaLabel: (areaId: string) => string;
  onOpen: (task: MinimalTask) => void;
}

/**
 * Vista por urgencia de las tareas abiertas asignadas al usuario.
 * Agrupa en 5 buckets (Urge / Hoy y mañana / Esta semana / Puede esperar / Sin fecha)
 * usando exclusivamente fechas YYYY-MM-DD CDMX para evitar drift de zona horaria.
 */
export function MyTasksSmartGroups({ tasks, areaColorMap, getCelulaLabel, onOpen }: Props) {
  const todayYmd = useMemo(() => toDateStringMX(nowMX()), []);

  const buckets = useMemo(() => {
    const init: Record<BucketKey, MinimalTask[]> = {
      urge: [],
      hoy: [],
      semana: [],
      despues: [],
      sin_fecha: [],
    };
    for (const t of tasks) {
      init[classify(t, todayYmd)].push(t);
    }
    // Orden interno: vencidas primero, luego por due_date asc, luego prioridad.
    const pri: Record<string, number> = { urgente: 0, alta: 1, media: 2, baja: 3 };
    for (const k of Object.keys(init) as BucketKey[]) {
      init[k].sort((a, b) => {
        const oa = a.due_date && isPastDueCalendarMX(a.due_date) ? 0 : 1;
        const ob = b.due_date && isPastDueCalendarMX(b.due_date) ? 0 : 1;
        if (oa !== ob) return oa - ob;
        const da = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER;
        const db = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
        if (da !== db) return da - db;
        return (pri[a.priority] ?? 4) - (pri[b.priority] ?? 4);
      });
    }
    return init;
  }, [tasks, todayYmd]);

  const visibleBuckets = BUCKETS.filter((b) => buckets[b.key].length > 0);

  if (visibleBuckets.length === 0) return null;

  return (
    <div className="space-y-2">
      {visibleBuckets.map((b) => (
        <SmartBucket
          key={b.key}
          def={b}
          tasks={buckets[b.key]}
          areaColorMap={areaColorMap}
          getCelulaLabel={getCelulaLabel}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

interface SmartBucketProps {
  def: BucketDef;
  tasks: MinimalTask[];
  areaColorMap: Map<string, string | undefined>;
  getCelulaLabel: (areaId: string) => string;
  onOpen: (task: MinimalTask) => void;
}

function SmartBucket({ def, tasks, areaColorMap, getCelulaLabel, onOpen }: SmartBucketProps) {
  const [open, setOpen] = useState(def.defaultOpen);
  const Icon = def.Icon;
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? tasks : tasks.slice(0, 8);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={cn(
          "group flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors hover:bg-accent/30",
          def.ring,
          def.bg,
        )}
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
            open && "rotate-90",
            def.text,
          )}
        />
        <span
          className={cn(
            "grid h-7 w-7 shrink-0 place-items-center rounded-lg",
            def.text,
            "bg-background/70 ring-1",
            def.ring,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={cn("text-sm font-semibold leading-tight", def.text)}>{def.label}</p>
            <span className="rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-foreground/80">
              {tasks.length}
            </span>
          </div>
          <p className="text-[10.5px] text-muted-foreground leading-tight mt-0.5">{def.sub}</p>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1.5 space-y-1.5 pl-2">
          {visible.map((task, i) => (
            <div
              key={task.id}
              className={cn(
                "flex items-center gap-3 rounded-xl border border-border/50 bg-background/80 px-3 py-2.5 transition-colors cursor-pointer card-hover-subtle",
                getPriorityBar(task.priority),
                task.delay_category && "bg-warning/[0.04]",
              )}
              style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}
              onClick={() => onOpen(task)}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <h3 className="text-sm font-medium text-foreground truncate">{task.title}</h3>
                  {task.criticality_level === "critico" && (
                    <span className="text-[10px] shrink-0" title="Crítico">
                      🔴
                    </span>
                  )}
                  {task.criticality_level === "atencion" && (
                    <span className="text-[10px] shrink-0" title="Atención">
                      🟡
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge
                    className={cn(
                      "text-[10px] border-0 px-1.5 py-0",
                      STATUS[task.status as keyof typeof STATUS]?.color,
                    )}
                    variant="secondary"
                  >
                    {STATUS[task.status as keyof typeof STATUS]?.label}
                  </Badge>
                  {task.area && (
                    <span className="inline-flex items-center gap-1.5 rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      <span
                        className="inline-block h-1.5 w-1.5 rounded-full"
                        style={{
                          background: areaColorMap.get(task.area) || "hsl(var(--primary))",
                        }}
                      />
                      {getCelulaLabel(task.area)}
                    </span>
                  )}
                  {task.clients?.name && (
                    <span className="text-[10px] text-muted-foreground truncate max-w-[140px]">
                      {task.clients.name}
                    </span>
                  )}
                  {task.projects?.name && (
                    <span className="text-[10px] text-muted-foreground/80 truncate max-w-[120px]">
                      {task.projects.name}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {task.due_date && (
                  <span
                    className={cn(
                      "text-xs flex items-center gap-1",
                      getDateColor(task.due_date),
                    )}
                  >
                    <Calendar className="h-3 w-3" />
                    {formatMX(task.due_date, "dd MMM")}
                  </span>
                )}
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40" />
              </div>
            </div>
          ))}
          {tasks.length > 8 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-xs text-primary hover:text-primary/80 text-center py-1 w-full transition-colors"
            >
              {showAll ? "Mostrar menos" : `+${tasks.length - 8} tareas más en esta categoría`}
            </button>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
