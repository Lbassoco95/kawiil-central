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
  useAnnualDeclarations,
  useCreateAnnualDeclaration,
  type AnnualDeclaration,
} from "@/hooks/useAnnualDeclarations";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnnualStepDetailRow } from "./AnnualStepDetailRow";
import { CriticalityDelayCard } from "./CriticalityDelayCard";


const STATUS_CONFIG: Record<string, { label: string; icon: typeof Clock; className: string }> = {
  pendiente: { label: "Pendiente", icon: Clock, className: "bg-muted text-muted-foreground" },
  en_progreso: { label: "En progreso", icon: AlertCircle, className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  completado: { label: "Completado", icon: CheckCircle2, className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
};

function DeclarationCard({
  declaration,
  projectId,
  clientDropboxPath,
}: {
  declaration: AnnualDeclaration;
  projectId: string;
  clientDropboxPath?: string;
}) {
  const [open, setOpen] = useState(declaration.status !== "completado");
  const completed = declaration.steps.filter((s) => s.completed).length;
  const total = declaration.steps.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const config = STATUS_CONFIG[declaration.status] || STATUS_CONFIG.pendiente;
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
                  Declaración Anual {declaration.year}
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
              {declaration.steps.map((step, idx) => (
                <AnnualStepDetailRow
                  key={step.key}
                  step={step}
                  index={idx}
                  declarationId={declaration.id}
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

export function AnnualDeclarationDashboard({ projectId, clientDropboxPath }: { projectId: string; clientDropboxPath?: string }) {
  const { data: declarations, isLoading } = useAnnualDeclarations(projectId);
  const createDeclaration = useCreateAnnualDeclaration();
  const now = nowMX();
  const [newYear, setNewYear] = useState((now.getFullYear() - 1).toString());
  const [showCreate, setShowCreate] = useState(false);

  const handleCreate = () => {
    createDeclaration.mutate(
      { projectId, year: parseInt(newYear) },
      { onSuccess: () => setShowCreate(false) }
    );
  };

  const totalDecl = declarations?.length ?? 0;
  const completedDecl = declarations?.filter((d) => d.status === "completado").length ?? 0;
  const inProgressDecl = declarations?.filter((d) => d.status === "en_progreso").length ?? 0;

  return (
    <div className="space-y-4">
      <CriticalityDelayCard projectId={projectId} />
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">{totalDecl}</p>
            <p className="text-xs text-muted-foreground">Declaraciones</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-accent-foreground">{inProgressDecl}</p>
            <p className="text-xs text-muted-foreground">En progreso</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-primary">{completedDecl}</p>
            <p className="text-xs text-muted-foreground">Completadas</p>
          </CardContent>
        </Card>
      </div>

      {showCreate ? (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-end gap-3">
              <div className="space-y-1">
                <label className="text-sm font-medium">Ejercicio fiscal</label>
                <Select value={newYear} onValueChange={setNewYear}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[now.getFullYear() - 2, now.getFullYear() - 1, now.getFullYear()].map((y) => (
                      <SelectItem key={y} value={y.toString()}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreate} disabled={createDeclaration.isPending}>
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
          Nueva declaración anual
        </Button>
      )}

      {isLoading ? (
        <p className="text-center text-muted-foreground py-8">Cargando...</p>
      ) : !declarations || declarations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <CalendarDays className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">
              Sin declaraciones anuales. Crea la primera para comenzar.
            </p>
          </CardContent>
        </Card>
      ) : (
        declarations.map((decl) => (
          <DeclarationCard key={decl.id} declaration={decl} projectId={projectId} clientDropboxPath={clientDropboxPath} />
        ))
      )}
    </div>
  );
}
