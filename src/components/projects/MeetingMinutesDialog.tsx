import { useState, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Upload,
  FileText,
  Sparkles,
  Calendar,
  User,
  AlertTriangle,
  Check,
  X,
} from "lucide-react";

interface ProposedTask {
  title: string;
  description: string;
  priority: "urgente" | "alta" | "media" | "baja";
  due_date: string | null;
  assigned_to_name: string | null;
  assigned_to_id: string | null;
  project_id: string | null;
  client_id: string | null;
  area: string | null;
  accepted: boolean;
}

interface MeetingMinutesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  clientId?: string | null;
  area?: string | null;
  projectName: string;
}

const PRIORITY_STYLES: Record<string, string> = {
  urgente: "bg-destructive/10 text-destructive border-destructive/20",
  alta: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 border-orange-200",
  media: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200",
  baja: "bg-muted text-muted-foreground border-border",
};

export function MeetingMinutesDialog({
  open,
  onOpenChange,
  projectId,
  clientId,
  area,
  projectName,
}: MeetingMinutesDialogProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<"input" | "preview">("input");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [summary, setSummary] = useState("");
  const [proposedTasks, setProposedTasks] = useState<ProposedTask[]>([]);
  const [creating, setCreating] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    // Read text content from file
    if (file.type.startsWith("text/") || file.name.endsWith(".md") || file.name.endsWith(".txt")) {
      const text = await file.text();
      setContent(text);
    } else {
      // For PDF/docx, we just note it - content needs to be pasted
      toast.info("Para archivos PDF o Word, copia y pega el contenido de la minuta en el campo de texto.");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleAnalyze = async () => {
    if (!content.trim()) {
      toast.error("Ingresa el contenido de la minuta");
      return;
    }
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-meeting", {
        body: {
          content: content.trim(),
          project_id: projectId,
          client_id: clientId || null,
          area: area || null,
        },
      });

      if (error) {
        const errorMsg = data?.error || error.message || "Error desconocido";
        throw new Error(errorMsg);
      }
      if (data?.error) throw new Error(data.error);

      setSummary(data.summary || "");
      setProposedTasks(
        (data.tasks || []).map((t: any) => ({ ...t, accepted: true }))
      );
      setStep("preview");
    } catch (err: any) {
      toast.error("Error al analizar: " + err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const toggleTask = (index: number) => {
    setProposedTasks((prev) =>
      prev.map((t, i) => (i === index ? { ...t, accepted: !t.accepted } : t))
    );
  };

  const handleCreateTasks = async () => {
    const accepted = proposedTasks.filter((t) => t.accepted);
    if (accepted.length === 0) {
      toast.error("Selecciona al menos una tarea");
      return;
    }
    setCreating(true);
    try {
      const { data: orgId } = await supabase.rpc("get_user_org_id", {
        _user_id: user!.id,
      });

      let created = 0;
      for (const task of accepted) {
        const { error } = await supabase.from("tasks").insert({
          title: task.title,
          description: task.description || null,
          priority: task.priority || "media",
          due_date: task.due_date || null,
          assigned_to: task.assigned_to_id || null,
          project_id: projectId,
          client_id: clientId || null,
          area: (area as any) || null,
          organization_id: orgId!,
          created_by: user!.id,
          status: "pendiente",
        });
        if (!error) created++;
      }

      toast.success(`${created} tarea${created !== 1 ? "s" : ""} creada${created !== 1 ? "s" : ""} exitosamente`);
      queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      handleClose();
    } catch (err: any) {
      toast.error("Error al crear tareas: " + err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    setStep("input");
    setContent("");
    setFileName("");
    setSummary("");
    setProposedTasks([]);
    onOpenChange(false);
  };

  const acceptedCount = proposedTasks.filter((t) => t.accepted).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {step === "input" ? "Analizar minuta de reunión" : "Tareas propuestas por AI"}
          </DialogTitle>
          <DialogDescription>
            {step === "input"
              ? `Sube o pega el contenido de la minuta para generar tareas automáticamente en "${projectName}".`
              : `${summary}`}
          </DialogDescription>
        </DialogHeader>

        {step === "input" ? (
          <div className="space-y-4 flex-1 overflow-y-auto">
            {/* File upload */}
            <div>
              <input ref={fileRef} type="file" className="hidden" accept=".txt,.md,.text" onChange={handleFileUpload} />
              <Button
                variant="outline"
                className="w-full h-20 border-dashed flex flex-col gap-1"
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-5 w-5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {fileName || "Sube un archivo de texto (.txt, .md)"}
                </span>
              </Button>
            </div>

            {/* Text input */}
            <div className="space-y-1">
              <label className="text-sm font-medium">O pega el contenido de la minuta:</label>
              <Textarea
                className="min-h-[200px] text-sm"
                placeholder="Pega aquí el resumen, minuta o notas de la reunión...&#10;&#10;Ejemplo:&#10;- Se acordó preparar la declaración anual de Cliente X para el 15 de abril&#10;- María revisará los estados financieros&#10;- Urgente: entregar constancia de situación fiscal antes del viernes"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {content.length} caracteres
              </p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-2">
            {proposedTasks.length === 0 ? (
              <div className="text-center py-8">
                <AlertTriangle className="h-8 w-8 text-warning mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No se encontraron tareas en la minuta.</p>
              </div>
            ) : (
              proposedTasks.map((task, index) => (
                <div
                  key={index}
                  className={`border rounded-lg p-3 space-y-2 transition-colors ${
                    task.accepted
                      ? "bg-background border-border"
                      : "bg-muted/30 border-border/50 opacity-60"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={task.accepted}
                      onCheckedChange={() => toggleTask(index)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-medium">{task.title}</h4>
                        <Badge
                          variant="outline"
                          className={`text-[10px] px-1.5 py-0 ${PRIORITY_STYLES[task.priority] || ""}`}
                        >
                          {task.priority}
                        </Badge>
                      </div>
                      {task.description && (
                        <p className="text-xs text-muted-foreground">{task.description}</p>
                      )}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        {task.due_date && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {task.due_date}
                          </span>
                        )}
                        {task.assigned_to_name && (
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {task.assigned_to_name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "input" ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button
                onClick={handleAnalyze}
                disabled={analyzing || !content.trim()}
              >
                {analyzing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Analizando con AI...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 mr-2" />
                    Analizar y proponer tareas
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("input")}>
                Volver a editar
              </Button>
              <Button
                onClick={handleCreateTasks}
                disabled={creating || acceptedCount === 0}
              >
                {creating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Creando...
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Crear {acceptedCount} tarea{acceptedCount !== 1 ? "s" : ""}
                  </>
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
