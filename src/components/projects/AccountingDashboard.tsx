import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, CalendarDays, CheckCircle2, Clock, AlertCircle } from "lucide-react";
import { nowMX } from "@/lib/dateUtils";
import {
  useAccountingPeriods,
  useCreateAccountingPeriod,
  getMonthName,
  type AccountingPeriod,
} from "@/hooks/useAccountingPeriods";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { StepDetailRow } from "./StepDetailRow";

const STATUS_CONFIG: Record<string, { label: string; icon: typeof Clock; className: string }> = {
  pendiente: { label: "Pendiente", icon: Clock, className: "bg-muted text-muted-foreground" },
  en_progreso: { label: "En progreso", icon: AlertCircle, className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  completado: { label: "Completado", icon: CheckCircle2, className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
};

function PeriodCard({
  period,
  projectId,
  clientDropboxPath,
}: {
  period: AccountingPeriod;
  projectId: string;
  clientDropboxPath?: string;
}) {
  const [open, setOpen] = useState(period.status !== "completado");
  const completed = period.steps.filter((s) => s.completed).length;
  const total = period.steps.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const config = STATUS_CONFIG[period.status] || STATUS_CONFIG.pendiente;
  const StatusIcon = config.icon;

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CalendarDays className="h-5 w-5 text-muted-foreground" />
                <CardTitle className="text-base">
                  {getMonthName(period.month)} {period.year}
                </CardTitle>
                <Badge variant="outline" className={config.className}>
                  <StatusIcon className="h-3 w-3 mr-1" />
                  {config.label}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  {completed}/{total}
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    open && "rotate-180"
                  )}
                />
              </div>
            </div>
            <Progress value={pct} className="h-2 mt-2" />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            <div className="space-y-2">
              {period.steps.map((step, idx) => (
                <StepDetailRow
                  key={step.key}
                  step={step}
                  index={idx}
                  periodId={period.id}
                  projectId={projectId}
                  clientDropboxPath={clientDropboxPath}
                />
              ))}
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
export function AccountingDashboard({ projectId, clientDropboxPath }: { projectId: string; clientDropboxPath?: string }) {
  const { data: periods, isLoading } = useAccountingPeriods(projectId);
  const createPeriod = useCreateAccountingPeriod();
  const now = nowMX();
  const [newYear, setNewYear] = useState(now.getFullYear().toString());
  const [newMonth, setNewMonth] = useState((now.getMonth() + 1).toString());
  const [showCreate, setShowCreate] = useState(false);

  const handleCreate = () => {
    createPeriod.mutate(
      { projectId, year: parseInt(newYear), month: parseInt(newMonth) },
      { onSuccess: () => setShowCreate(false) }
    );
  };

  // Summary stats
  const totalPeriods = periods?.length ?? 0;
  const completedPeriods = periods?.filter((p) => p.status === "completado").length ?? 0;
  const inProgressPeriods = periods?.filter((p) => p.status === "en_progreso").length ?? 0;

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{totalPeriods}</p>
            <p className="text-xs text-muted-foreground">Periodos</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-accent-foreground">{inProgressPeriods}</p>
            <p className="text-xs text-muted-foreground">En progreso</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{completedPeriods}</p>
            <p className="text-xs text-muted-foreground">Completados</p>
          </CardContent>
        </Card>
      </div>

      {/* Create new period */}
      {showCreate ? (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Mes</label>
                <Select value={newMonth} onValueChange={setNewMonth}>
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => (
                      <SelectItem key={i + 1} value={(i + 1).toString()}>
                        {getMonthName(i + 1)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Año</label>
                <Select value={newYear} onValueChange={setNewYear}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
                      <SelectItem key={y} value={y.toString()}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreate} disabled={createPeriod.isPending}>
                Crear
              </Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>
                Cancelar
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Button variant="outline" onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo periodo mensual
        </Button>
      )}

      {/* Periods list */}
      {isLoading ? (
        <p className="text-center text-muted-foreground py-8">Cargando...</p>
      ) : !periods || periods.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CalendarDays className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              Sin periodos contables. Crea el primer periodo para comenzar.
            </p>
          </CardContent>
        </Card>
      ) : (
        periods.map((period) => (
          <PeriodCard key={period.id} period={period} projectId={projectId} clientDropboxPath={clientDropboxPath} />
        ))
      )}
    </div>
  );
}
