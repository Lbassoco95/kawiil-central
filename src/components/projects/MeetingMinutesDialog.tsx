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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Upload,
  Sparkles,
  Calendar,
  User,
  AlertTriangle,
  Check,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Pencil,
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
  phase: string | null;
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
  const { data: orgUsers = [] } = useOrgUsers();

  const [step, setStep] = useState<"input" | "preview">("input");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [summary, setSummary] = useState("");
  const [proposedTasks, setProposedTasks] = useState<ProposedTask[]>([]);
  const [creating, setCreating] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [phases, setPhases] = useState<string[]>([]);
  const [newPhaseName, setNewPhaseName] = useState("");

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isText = file.type.startsWith("text/") || [".md", ".txt", ".csv", ".log"].some((e) => file.name.toLowerCase().endsWith(e));

    if (isText) {
      const text = await file.text();
      setContent(text);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    if (ext === "pdf") {
      setAnalyzing(true);
      toast.info("Extrayendo texto del PDF…");
      const arrayBuffer = await file.arrayBuffer();

      // Always extract text client-side first — supports any number of pages
      let extractedText = "";
      try {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const bytes = new Uint8Array(arrayBuffer);
        const pdf = await getDocumentProxy(bytes);
        const { text: pdfText } = await extractText(pdf, { mergePages: true });
        const textResult = Array.isArray(pdfText) ? pdfText.join("\n") : (pdfText ?? "");
        extractedText = textResult.trim();
      } catch {
        try {
          const pdfjsLib = await import("pdfjs-dist");
          const pdfjs = pdfjsLib.default ?? pdfjsLib;
          (pdfjs as any).disableWorker = true;
          const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
          const doc = await loadingTask.promise;
          let t = "";
          for (let i = 1; i <= doc.numPages; i++) {
            const page = await doc.getPage(i);
            const textContent = await page.getTextContent();
            t += textContent.items.map((item: any) => item.str ?? "").join(" ") + "\n";
          }
          extractedText = t.trim();
        } catch {
          setAnalyzing(false);
          if (fileRef.current) fileRef.current.value = "";
          toast.error("No se pudo leer el PDF. Pega el contenido en el cuadro de texto.");
          return;
        }
      }

      if (!extractedText) {
        setAnalyzing(false);
        if (fileRef.current) fileRef.current.value = "";
        toast.error("El PDF no tiene texto legible. Pega el contenido abajo.");
        return;
      }

      toast.info(`Texto extraído (${Math.round(extractedText.length / 1000)}k caracteres). Analizando con IA…`);

      try {
        const { data, error } = await supabase.functions.invoke("analyze-meeting", {
          body: {
            content: extractedText,
            project_id: projectId,
            client_id: clientId ?? null,
            area: area ?? null,
          },
        });
        if (error) throw new Error(data?.error ?? error.message);
        if (data?.error) throw new Error(data.error);
        setContent(extractedText);
        setSummary(data.summary ?? "");
        setProposedTasks((data.tasks ?? []).map((t: any) => ({ ...t, accepted: true, phase: null })));
        setStep("preview");
        toast.success("Análisis listo. Revisa las tareas propuestas.");
      } catch (err: any) {
        console.error("PDF analysis error:", err);
        setContent(extractedText);
        toast.info("Texto cargado. Pulsa «Analizar y proponer tareas» para reintentar.");
      } finally {
        setAnalyzing(false);
        if (fileRef.current) fileRef.current.value = "";
      }
      return;
    }

    if (ext === "docx" || file.type.includes("wordprocessingml")) {
      try {
        toast.info("Extrayendo texto del Word…");
        const mammoth = await import("mammoth");
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        setContent(result.value.trim() || "(No se pudo extraer texto del documento)");
        toast.success("Texto del Word cargado");
      } catch (err: any) {
        console.error(err);
        toast.error("No se pudo leer el Word. Pega el contenido en el cuadro de texto.");
      }
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    toast.info("Para este tipo de archivo, copia y pega el contenido en el campo de texto.");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleAnalyze = async () => {
    if (!content.trim()) {
      toast.error("Ingresa el contenido del documento");
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
        (data.tasks || []).map((t: any) => ({ ...t, accepted: true, phase: null }))
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

  const updateTask = (index: number, field: keyof ProposedTask, value: any) => {
    setProposedTasks((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    );
  };

  const deleteTask = (index: number) => {
    setProposedTasks((prev) => prev.filter((_, i) => i !== index));
    if (expandedIndex === index) setExpandedIndex(null);
    else if (expandedIndex !== null && expandedIndex > index) setExpandedIndex(expandedIndex - 1);
  };

  const addTask = () => {
    const newTask: ProposedTask = {
      title: "",
      description: "",
      priority: "media",
      due_date: null,
      assigned_to_name: null,
      assigned_to_id: null,
      project_id: projectId,
      client_id: clientId || null,
      area: area || null,
      accepted: true,
      phase: null,
    };
    setProposedTasks((prev) => [...prev, newTask]);
    setExpandedIndex(proposedTasks.length);
  };

  const handleAssigneeChange = (index: number, userId: string) => {
    if (userId === "none") {
      updateTask(index, "assigned_to_id", null);
      updateTask(index, "assigned_to_name", null);
      return;
    }
    const member = orgUsers.find((u) => u.user_id === userId);
    if (member) {
      updateTask(index, "assigned_to_id", userId);
      updateTask(index, "assigned_to_name", member.full_name);
    }
  };

  const handleCreateTasks = async () => {
    const accepted = proposedTasks.filter((t) => t.accepted && t.title.trim());
    if (accepted.length === 0) {
      toast.error("Selecciona al menos una tarea con título");
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
    setExpandedIndex(null);
    onOpenChange(false);
  };

  const acceptedCount = proposedTasks.filter((t) => t.accepted && t.title.trim()).length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            {step === "input" ? "Analizar documento / minuta" : "Tareas propuestas por AI"}
          </DialogTitle>
          <DialogDescription>
            {step === "input"
              ? `Sube o pega el contenido del documento para generar tareas automáticamente en "${projectName}".`
              : summary}
          </DialogDescription>
        </DialogHeader>

        {step === "input" ? (
          <div className="space-y-4 flex-1 overflow-y-auto">
            {analyzing ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
                <Loader2 className="h-10 w-10 animate-spin" />
                <p className="text-sm font-medium">Analizando PDF en el servidor…</p>
                <p className="text-xs">Extracción de texto y análisis con IA. No cierres el diálogo.</p>
              </div>
            ) : (
              <>
                <div>
                  <input ref={fileRef} type="file" className="hidden" accept=".pdf,.doc,.docx,.txt,.md,.csv" onChange={handleFileUpload} />
                  <Button
                    variant="outline"
                    className="w-full h-20 border-dashed flex flex-col gap-1"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="h-5 w-5 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {fileName || "Sube un archivo (PDF, Word, .txt, .md)"}
                    </span>
                  </Button>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">O pega el contenido:</label>
                  <Textarea
                    className="min-h-[200px] text-sm"
                    placeholder="Pega aquí el resumen, minuta, notas de la reunión o contenido del documento...&#10;&#10;Ejemplo:&#10;- Se acordó preparar la declaración anual de Cliente X para el 15 de abril&#10;- María revisará los estados financieros&#10;- Urgente: entregar constancia de situación fiscal antes del viernes"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">{content.length} caracteres</p>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-2">
            {proposedTasks.length === 0 ? (
              <div className="text-center py-8">
                <AlertTriangle className="h-8 w-8 text-warning mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No se encontraron tareas.</p>
              </div>
            ) : (
              proposedTasks.map((task, index) => {
                const isExpanded = expandedIndex === index;
                return (
                  <div
                    key={index}
                    className={`border rounded-lg transition-colors ${
                      task.accepted
                        ? "bg-background border-border"
                        : "bg-muted/30 border-border/50 opacity-60"
                    }`}
                  >
                    {/* Collapsed row */}
                    <div className="flex items-center gap-3 p-3">
                      <Checkbox
                        checked={task.accepted}
                        onCheckedChange={() => toggleTask(index)}
                        className="shrink-0"
                      />
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => setExpandedIndex(isExpanded ? null : index)}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-medium truncate">
                            {task.title || <span className="text-muted-foreground italic">Sin título</span>}
                          </h4>
                          <Badge
                            variant="outline"
                            className={`text-[10px] px-1.5 py-0 shrink-0 ${PRIORITY_STYLES[task.priority] || ""}`}
                          >
                            {task.priority}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
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
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => setExpandedIndex(isExpanded ? null : index)}
                        >
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => deleteTask(index)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* Expanded edit form */}
                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 border-t border-border/40 space-y-3">
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Título</label>
                          <Input
                            value={task.title}
                            onChange={(e) => updateTask(index, "title", e.target.value)}
                            placeholder="Título de la tarea"
                            className="text-sm"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Descripción</label>
                          <Textarea
                            value={task.description}
                            onChange={(e) => updateTask(index, "description", e.target.value)}
                            placeholder="Descripción..."
                            className="text-sm min-h-[60px]"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Prioridad</label>
                            <Select
                              value={task.priority}
                              onValueChange={(v) => updateTask(index, "priority", v)}
                            >
                              <SelectTrigger className="text-sm">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="urgente">🔴 Urgente</SelectItem>
                                <SelectItem value="alta">🟠 Alta</SelectItem>
                                <SelectItem value="media">🔵 Media</SelectItem>
                                <SelectItem value="baja">⚪ Baja</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Fecha límite</label>
                            <Input
                              type="date"
                              value={task.due_date || ""}
                              onChange={(e) => updateTask(index, "due_date", e.target.value || null)}
                              className="text-sm"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Responsable</label>
                          <Select
                            value={task.assigned_to_id || "none"}
                            onValueChange={(v) => handleAssigneeChange(index, v)}
                          >
                            <SelectTrigger className="text-sm">
                              <SelectValue placeholder="Sin asignar" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Sin asignar</SelectItem>
                              {orgUsers
                                .filter((u) => u.is_active)
                                .map((u) => (
                                  <SelectItem key={u.user_id} value={u.user_id}>
                                    {u.full_name}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {/* Add task button */}
            <Button
              variant="outline"
              size="sm"
              className="w-full border-dashed gap-1.5"
              onClick={addTask}
            >
              <Plus className="h-3.5 w-3.5" />
              Agregar tarea manualmente
            </Button>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "input" ? (
            <>
              <Button variant="outline" onClick={handleClose}>Cancelar</Button>
              <Button onClick={handleAnalyze} disabled={analyzing || !content.trim()}>
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
              <Button onClick={handleCreateTasks} disabled={creating || acceptedCount === 0}>
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
