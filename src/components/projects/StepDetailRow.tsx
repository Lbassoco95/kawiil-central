import { useState, useRef, useEffect, useCallback } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  CalendarIcon,
  ChevronDown,
  Upload,
  FileText,
  Loader2,
  Play,
  Pause,
  Timer,
  Save,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { formatDateMX } from "@/lib/dateUtils";
import { es } from "date-fns/locale";
import {
  useToggleAccountingStep,
  useUpdateStepDetails,
  STEP_STATUS_OPTIONS,
  type AccountingStep,
  type StepStatus,
} from "@/hooks/useAccountingPeriods";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

const STEP_STATUS_STYLES: Record<StepStatus, string> = {
  pendiente: "bg-muted text-muted-foreground",
  en_progreso: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  en_espera_cliente: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  completado: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatTimeCompact(totalSeconds: number): string {
  if (totalSeconds === 0) return "";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface StepDetailRowProps {
  step: AccountingStep;
  index: number;
  periodId: string;
  projectId: string;
}

export function StepDetailRow({ step, index, periodId, projectId }: StepDetailRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [displaySeconds, setDisplaySeconds] = useState(step.time_spent_seconds || 0);
  const [localStatus, setLocalStatus] = useState(step.step_status || "pendiente");
  const [localDate, setLocalDate] = useState<Date | undefined>(step.date ? new Date(step.date) : undefined);
  const [localNotes, setLocalNotes] = useState(step.notes || "");
  const [hasChanges, setHasChanges] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const baseSecondsRef = useRef<number>(step.time_spent_seconds || 0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toggleStep = useToggleAccountingStep();
  const updateDetails = useUpdateStepDetails();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const docIds = step.document_ids || [];
  const savedTime = step.time_spent_seconds || 0;

  // Sync base when step data changes from server
  useEffect(() => {
    if (!timerRunning) {
      baseSecondsRef.current = step.time_spent_seconds || 0;
      setDisplaySeconds(step.time_spent_seconds || 0);
    }
  }, [step.time_spent_seconds, timerRunning]);

  // Sync local state when step data changes from server
  useEffect(() => {
    setLocalStatus(step.step_status || "pendiente");
    setLocalDate(step.date ? new Date(step.date) : undefined);
    setLocalNotes(step.notes || "");
    setHasChanges(false);
  }, [step.step_status, step.date, step.notes]);

  const markChanged = () => setHasChanges(true);

  const startTimer = useCallback(() => {
    if (timerRunning) return;
    baseSecondsRef.current = displaySeconds;
    startTimeRef.current = Date.now();
    setTimerRunning(true);
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setDisplaySeconds(baseSecondsRef.current + elapsed);
    }, 1000);
  }, [timerRunning, displaySeconds]);

  const stopTimer = useCallback(() => {
    if (!timerRunning) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setTimerRunning(false);
    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const total = baseSecondsRef.current + elapsed;
    baseSecondsRef.current = total;
    setDisplaySeconds(total);
    updateDetails.mutate({
      periodId, projectId, stepKey: step.key,
      updates: { time_spent_seconds: total },
    });
  }, [timerRunning, periodId, projectId, step.key, updateDetails]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const { data: stepDocuments = [] } = useQuery({
    queryKey: ["step-documents", periodId, step.key],
    queryFn: async () => {
      if (docIds.length === 0) return [];
      const { data, error } = await supabase
        .from("documents")
        .select("id, name, mime_type, file_path, created_at")
        .in("id", docIds);
      if (error) throw error;
      return data;
    },
    enabled: docIds.length > 0 && expanded,
  });

  const handleSave = () => {
    if (localStatus === "completado" && !step.completed) {
      toggleStep.mutate({ periodId, projectId, stepKey: step.key, completed: true });
    }
    updateDetails.mutate(
      {
        periodId, projectId, stepKey: step.key,
        updates: {
          step_status: localStatus as StepStatus,
          date: localDate ? localDate.toISOString() : null,
          notes: localNotes || null,
        },
      },
      { onSuccess: () => setHasChanges(false) }
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    try {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user.id });
      const filePath = `${orgId}/${projectId}/${periodId}/${step.key}/${Date.now()}_${file.name}`;

      const { error: uploadErr } = await supabase.storage.from("documents").upload(filePath, file);
      if (uploadErr) throw uploadErr;

      const { data: doc, error: docErr } = await supabase
        .from("documents")
        .insert({
          name: file.name, file_path: filePath, mime_type: file.type, file_size: file.size,
          organization_id: orgId!, project_id: projectId, uploaded_by: user.id,
          document_type: "contabilidad", source: "supabase" as const,
        })
        .select().single();
      if (docErr) throw docErr;

      const newDocIds = [...docIds, doc.id];
      updateDetails.mutate({ periodId, projectId, stepKey: step.key, updates: { document_ids: newDocIds } });
      queryClient.invalidateQueries({ queryKey: ["step-documents", periodId, step.key] });
      toast.success(`Archivo "${file.name}" subido`);
    } catch (err: any) {
      toast.error("Error al subir archivo: " + err.message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="rounded-md border border-border/50 overflow-hidden">
      {/* Main row */}
      <div
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 text-sm transition-colors cursor-pointer hover:bg-muted/50",
          step.completed && "opacity-70"
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={step.completed}
            onCheckedChange={(checked) =>
              toggleStep.mutate({ periodId, projectId, stepKey: step.key, completed: !!checked })
            }
          />
        </div>
        <span className="text-muted-foreground text-xs font-mono w-5">{index + 1}.</span>
        <span className={cn("flex-1", step.completed && "line-through")}>{step.label}</span>
        <div className="flex items-center gap-2 shrink-0">
          {(savedTime > 0 || timerRunning) && (
            <Badge variant="outline" className={cn("text-xs gap-1 font-mono", timerRunning && "border-primary text-primary animate-pulse")}>
              <Timer className="h-3 w-3" />
              {timerRunning ? formatTime(displaySeconds) : formatTimeCompact(savedTime)}
            </Badge>
          )}
          {localStatus !== "pendiente" && (
            <Badge variant="outline" className={cn("text-xs", STEP_STATUS_STYLES[localStatus as StepStatus] || STEP_STATUS_STYLES.pendiente)}>
              {STEP_STATUS_OPTIONS.find((o) => o.value === localStatus)?.label}
            </Badge>
          )}
          {localDate && (
            <span className="text-xs text-muted-foreground">{format(localDate, "dd/MM/yy")}</span>
          )}
          {docIds.length > 0 && (
            <Badge variant="secondary" className="text-xs gap-1">
              <FileText className="h-3 w-3" />
              {docIds.length}
            </Badge>
          )}
          <ChevronDown
            className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", expanded && "rotate-180")}
          />
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border/50 bg-muted/20 px-4 py-3 space-y-3">
          {/* Timer */}
          <div className="flex items-center gap-3 rounded-md border border-border/50 bg-background px-3 py-2">
            <Timer className="h-4 w-4 text-muted-foreground" />
            <span className="font-mono text-sm font-medium flex-1">{formatTime(displaySeconds)}</span>
            <Button
              variant={timerRunning ? "destructive" : "default"}
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={timerRunning ? stopTimer : startTimer}
            >
              {timerRunning ? (
                <>
                  <Pause className="h-3 w-3" />
                  Pausar
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  Iniciar
                </>
              )}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Status */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Estatus</label>
              <Select value={localStatus} onValueChange={(v) => { setLocalStatus(v as StepStatus); markChanged(); }}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STEP_STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Date */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Fecha</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn("h-8 w-full justify-start text-left text-xs font-normal", !localDate && "text-muted-foreground")}
                  >
                    <CalendarIcon className="mr-2 h-3 w-3" />
                    {localDate ? format(localDate, "PPP", { locale: es }) : "Seleccionar fecha"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={localDate}
                    onSelect={(d) => { setLocalDate(d); markChanged(); }}
                    initialFocus
                    className="p-3 pointer-events-auto"
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Notas</label>
            <Textarea
              className="text-xs min-h-[60px] resize-none"
              placeholder="Observaciones del paso..."
              value={localNotes}
              onChange={(e) => { setLocalNotes(e.target.value); markChanged(); }}
            />
          </div>

          {/* Documents */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Documentos</label>
              <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                Subir archivo
              </Button>
            </div>

            {stepDocuments.length > 0 && (
              <div className="space-y-1">
                {stepDocuments.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-xs bg-background border border-border/50">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate flex-1">{doc.name}</span>
                    <span className="text-muted-foreground shrink-0">
                      {formatDateMX(doc.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {docIds.length === 0 && !uploading && (
              <p className="text-xs text-muted-foreground italic">Sin documentos adjuntos</p>
            )}
          </div>

          {/* Save button */}
          <div className="flex justify-end pt-1">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges || updateDetails.isPending}
            >
              <Save className="h-4 w-4 mr-1" />
              Guardar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
