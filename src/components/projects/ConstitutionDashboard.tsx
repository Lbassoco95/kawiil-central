import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
  Building2,
  Stamp,
  PenLine,
  Home,
  Receipt,
  KeyRound,
  Landmark,
  BookOpen,
  Globe,
  Save,
  CheckCircle2,
  Clock,
  AlertCircle,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatDateMX } from "@/lib/dateUtils";

interface ConstitutionStep {
  key: string;
  label: string;
  description: string;
  icon: string;
  status: "pendiente" | "en_progreso" | "completado";
  completed_at: string | null;
  notes: string;
  conditional?: boolean;
}

const DEFAULT_STEPS: ConstitutionStep[] = [
  {
    key: "documentacion_socios",
    label: "Recopilación de documentación de socios",
    description: "Integrar documentos de identidad, poderes y datos de los socios/accionistas.",
    icon: "FileText",
    status: "pendiente",
    completed_at: null,
    notes: "",
  },
  {
    key: "envio_notaria",
    label: "Envío de información a notaría",
    description: "Enviar la documentación completa de socios a la notaría para iniciar el proceso.",
    icon: "Building2",
    status: "pendiente",
    completed_at: null,
    notes: "",
  },
  {
    key: "proyecto_constitucion",
    label: "Proyecto de constitución",
    description: "La notaría prepara el proyecto de acta constitutiva para revisión.",
    icon: "Stamp",
    status: "pendiente",
    completed_at: null,
    notes: "",
  },
  {
    key: "firma_socios",
    label: "Firma de socios",
    description: "Los socios firman el acta constitutiva ante notario.",
    icon: "PenLine",
    status: "pendiente",
    completed_at: null,
    notes: "",
  },
  {
    key: "comprobante_domicilio",
    label: "Comprobante de domicilio corporativo",
    description: "Generar comprobante a nombre de la empresa (contrato de internet, línea móvil, etc.).",
    icon: "Home",
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
    key: "cuenta_bancaria",
    label: "Alta de cuenta bancaria",
    description: "Apertura de cuenta bancaria corporativa.",
    icon: "Landmark",
    status: "pendiente",
    completed_at: null,
    notes: "",
  },
  {
    key: "registro_rpc",
    label: "Registro ante el RPC (boleta)",
    description: "Inscripción en el Registro Público de Comercio para obtener la boleta de registro.",
    icon: "BookOpen",
    status: "pendiente",
    completed_at: null,
    notes: "",
  },
  {
    key: "inscripcion_rnie",
    label: "Inscripción al RNIE",
    description: "Registro Nacional de Inversiones Extranjeras (aplica cuando hay socios extranjeros).",
    icon: "Globe",
    status: "pendiente",
    completed_at: null,
    notes: "",
    conditional: true,
  },
];

const ICON_MAP: Record<string, React.ElementType> = {
  FileText,
  Building2,
  Stamp,
  PenLine,
  Home,
  Receipt,
  KeyRound,
  Landmark,
  BookOpen,
  Globe,
};

const STATUS_CONFIG = {
  pendiente: { label: "Pendiente", class: "bg-muted text-muted-foreground", icon: Clock },
  en_progreso: { label: "En progreso", class: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400", icon: AlertCircle },
  completado: { label: "Completado", class: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400", icon: CheckCircle2 },
};

interface Props {
  projectId: string;
  constitutionDetails: { steps: ConstitutionStep[]; has_foreign_partners: boolean } | null;
}

export function ConstitutionDashboard({ projectId, constitutionDetails }: Props) {
  const queryClient = useQueryClient();
  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  const steps: ConstitutionStep[] = constitutionDetails?.steps ?? DEFAULT_STEPS;
  const hasForeignPartners = constitutionDetails?.has_foreign_partners ?? true;

  const visibleSteps = steps.filter(
    (s) => !s.conditional || hasForeignPartners
  );

  const completedCount = visibleSteps.filter((s) => s.status === "completado").length;
  const progressPct = visibleSteps.length > 0 ? Math.round((completedCount / visibleSteps.length) * 100) : 0;

  const saveMutation = useMutation({
    mutationFn: async (updatedSteps: ConstitutionStep[]) => {
      const { error } = await supabase
        .from("projects")
        .update({
          constitution_details: {
            steps: updatedSteps,
            has_foreign_partners: hasForeignPartners,
          },
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

  const toggleForeignPartners = () => {
    const updated = {
      steps,
      has_foreign_partners: !hasForeignPartners,
    };
    supabase
      .from("projects")
      .update({ constitution_details: updated } as any)
      .eq("id", projectId)
      .then(({ error }) => {
        if (error) toast.error(error.message);
        else {
          queryClient.invalidateQueries({ queryKey: ["project", projectId] });
          toast.success(!hasForeignPartners ? "RNIE habilitado" : "RNIE deshabilitado");
        }
      });
  };

  const updateStepStatus = (key: string, newStatus: ConstitutionStep["status"]) => {
    const updated = steps.map((s) =>
      s.key === key
        ? {
            ...s,
            status: newStatus,
            completed_at: newStatus === "completado" ? new Date().toISOString() : null,
          }
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

  if (!constitutionDetails) {
    return (
      <Card>
        <CardContent className="py-12 text-center space-y-4">
          <Building2 className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <div>
            <h3 className="font-semibold text-foreground">Módulo de Constitución</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Inicia el seguimiento del proceso de constitución de empresa para este proyecto.
            </p>
          </div>
          <Button onClick={initializeSteps}>
            <Building2 className="mr-2 h-4 w-4" />
            Iniciar proceso de constitución
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Progress overview */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-foreground">Progreso de constitución</h3>
            <span className="text-sm font-medium text-muted-foreground">
              {completedCount}/{visibleSteps.length} pasos
            </span>
          </div>
          <Progress value={progressPct} className="h-2" />
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <label className="flex items-center gap-2 cursor-pointer">
              <Checkbox
                checked={hasForeignPartners}
                onCheckedChange={toggleForeignPartners}
              />
              <span>Socios extranjeros (incluir RNIE)</span>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Steps */}
      <div className="space-y-2">
        {visibleSteps.map((step, idx) => {
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
                        <h4 className="text-sm font-medium text-foreground truncate">
                          {step.label}
                        </h4>
                        <p className="text-xs text-muted-foreground truncate hidden sm:block">
                          {step.description}
                        </p>
                      </div>
                      <Badge variant="outline" className={`text-xs shrink-0 ${statusCfg.class}`}>
                        <StatusIcon className="h-3 w-3 mr-1" />
                        {statusCfg.label}
                      </Badge>
                      {isOpen ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                    </div>
                  </CardContent>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-4 pb-4 space-y-3 border-t pt-3">
                    <p className="text-sm text-muted-foreground">{step.description}</p>

                    {step.completed_at && (
                      <p className="text-xs text-muted-foreground">
                        Completado: {formatDateMX(step.completed_at)}
                      </p>
                    )}

                    {/* Status buttons */}
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

                    {/* Notes */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Notas</label>
                      <div className="flex gap-2">
                        <Textarea
                          className="text-sm min-h-[60px]"
                          placeholder="Agregar notas sobre este paso..."
                          defaultValue={step.notes}
                          id={`notes-${step.key}`}
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="shrink-0 self-end"
                          disabled={saveMutation.isPending}
                          onClick={() => {
                            const el = document.getElementById(`notes-${step.key}`) as HTMLTextAreaElement;
                            if (el) updateStepNotes(step.key, el.value);
                          }}
                        >
                          <Save className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>

                    {step.conditional && (
                      <p className="text-xs text-muted-foreground italic flex items-center gap-1">
                        <Globe className="h-3 w-3" />
                        Este paso aplica solo cuando hay socios extranjeros
                      </p>
                    )}
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
