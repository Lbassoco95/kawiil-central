import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Receipt,
  KeyRound,
  Send,
  Save,
  CheckCircle2,
  Clock,
  AlertCircle,
  ClipboardList,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDateMX } from "@/lib/dateUtils";

interface GestoriaStep {
  key: string;
  label: string;
  description: string;
  icon: string;
  status: "pendiente" | "en_progreso" | "completado";
  completed_at: string | null;
  notes: string;
}

const DEFAULT_STEPS: GestoriaStep[] = [
  {
    key: "documentacion",
    label: "Recopilación de documentación",
    description: "Integrar documentos de identidad, comprobante de domicilio y demás requisitos del contribuyente.",
    icon: "FileText",
    status: "pendiente",
    completed_at: null,
    notes: "",
  },
  {
    key: "obtencion_rfc",
    label: "Obtención del RFC",
    description: "Tramitar el Registro Federal de Contribuyentes ante el SAT.",
    icon: "Receipt",
    status: "pendiente",
    completed_at: null,
    notes: "",
  },
  {
    key: "firma_electronica",
    label: "Obtención de e.firma (FIEL)",
    description: "Obtener la firma electrónica avanzada del SAT.",
    icon: "KeyRound",
    status: "pendiente",
    completed_at: null,
    notes: "",
  },
  {
    key: "entrega_final",
    label: "Entrega de documentos y acuses",
    description: "Entregar al cliente los documentos, acuses y constancias obtenidos.",
    icon: "Send",
    status: "pendiente",
    completed_at: null,
    notes: "",
  },
];

const ICON_MAP: Record<string, React.ElementType> = {
  FileText,
  Receipt,
  KeyRound,
  Send,
};

const STATUS_CONFIG = {
  pendiente: { label: "Pendiente", class: "bg-muted text-muted-foreground", icon: Clock },
  en_progreso: { label: "En progreso", class: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", icon: AlertCircle },
  completado: { label: "Completado", class: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", icon: CheckCircle2 },
};

interface Props {
  projectId: string;
  gestoriaDetails: { steps: GestoriaStep[] } | null;
}

export function GestoriaDashboard({ projectId, gestoriaDetails }: Props) {
  const queryClient = useQueryClient();
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const steps: GestoriaStep[] = gestoriaDetails?.steps ?? DEFAULT_STEPS;

  const completedCount = steps.filter((s) => s.status === "completado").length;
  const progressPct = steps.length > 0 ? Math.round((completedCount / steps.length) * 100) : 0;

  const saveMutation = useMutation({
    mutationFn: async (updatedSteps: GestoriaStep[]) => {
      const { error } = await supabase
        .from("projects")
        .update({
          constitution_details: { steps: updatedSteps },
        } as any)
        .eq("id", projectId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      toast.success("Progreso guardado");
    },
    onError: (e: Error) => toast.error("Error: " + e.message),
  });

  const updateStepStatus = (key: string, newStatus: GestoriaStep["status"]) => {
    const updated = steps.map((s) =>
      s.key === key
        ? { ...s, status: newStatus, completed_at: newStatus === "completado" ? new Date().toISOString() : null }
        : s
    );
    saveMutation.mutate(updated);
  };

  const updateStepNotes = (key: string, notes: string) => {
    const updated = steps.map((s) => (s.key === key ? { ...s, notes } : s));
    saveMutation.mutate(updated);
  };

  const initializeSteps = () => {
    saveMutation.mutate(DEFAULT_STEPS);
  };

  if (!gestoriaDetails) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <ClipboardList className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <div>
            <h3 className="font-semibold text-foreground">Módulo de Gestoría</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Inicia el seguimiento del trámite de RFC y firma electrónica.
            </p>
          </div>
          <Button onClick={initializeSteps}>
            <ClipboardList className="mr-2 h-4 w-4" />
            Iniciar proceso de gestoría
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Progreso de gestoría</h3>
            <span className="text-sm font-medium text-muted-foreground">
              {completedCount}/{steps.length} pasos
            </span>
          </div>
          <Progress value={progressPct} className="h-2" />
        </CardContent>
      </Card>

      <div className="space-y-2">
        {steps.map((step, idx) => {
          const IconComp = ICON_MAP[step.icon] || FileText;
          const statusCfg = STATUS_CONFIG[step.status];
          const StatusIcon = statusCfg.icon;
          const isOpen = expandedStep === step.key;

          return (
            <Collapsible
              key={step.key}
              open={isOpen}
              onOpenChange={() => setExpandedStep(isOpen ? null : step.key)}
            >
              <Card className={step.status === "completado" ? "opacity-75" : ""}>
                <CollapsibleTrigger asChild>
                  <CardContent className="p-4 cursor-pointer hover:bg-muted/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted shrink-0">
                        <span className="text-xs font-bold text-muted-foreground">{idx + 1}</span>
                      </div>
                      <IconComp className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-foreground truncate">{step.label}</h4>
                        <p className="text-xs text-muted-foreground truncate hidden sm:block">{step.description}</p>
                      </div>
                      <Badge variant="outline" className={`text-xs shrink-0 ${statusCfg.class}`}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {statusCfg.label}
                      </Badge>
                      {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                    </div>
                  </CardContent>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 pb-4 space-y-3 border-t pt-3">
                    <p className="text-sm text-muted-foreground">{step.description}</p>
                    {step.completed_at && (
                      <p className="text-xs text-muted-foreground">Completado: {formatDateMX(step.completed_at)}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {(["pendiente", "en_progreso", "completado"] as const).map((st) => (
                        <Button
                          key={st}
                          size="sm"
                          variant={step.status === st ? "default" : "outline"}
                          className="text-xs"
                          onClick={() => updateStepStatus(step.key, st)}
                          disabled={saveMutation.isPending}
                        >
                          {STATUS_CONFIG[st].label}
                        </Button>
                      ))}
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Notas</label>
                      <div className="flex gap-2">
                        <Textarea
                          className="text-sm min-h-[60px]"
                          placeholder="Agregar notas..."
                          defaultValue={step.notes}
                          id={`gestoria-notes-${step.key}`}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 self-end"
                          disabled={saveMutation.isPending}
                          onClick={() => {
                            const el = document.getElementById(`gestoria-notes-${step.key}`) as HTMLTextAreaElement;
                            if (el) updateStepNotes(step.key, el.value);
                          }}
                        >
                          <Save className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
