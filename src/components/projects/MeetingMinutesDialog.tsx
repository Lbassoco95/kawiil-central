import { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
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
import { PRIORITY_CONFIG } from "@/lib/statusStyles";
import { cn } from "@/lib/utils";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { documentsLimits, withLimits, STANDARD_BATCH_MAX_FILES } from "@/lib/fileIntake/limits";
import {
  Loader2,
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
  Layers,
  X,
} from "lucide-react";
import { appendProjectPhases, ensureCompliancePhasesOnProject, type SyncPhase } from "@/lib/projectPhaseSync";

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
  /** Nombre mostrable de la fase (opcional, legacy). */
  phase: string | null;
  /** Clave alineada con `projects.phases` y `tasks.phase_key`. */
  phase_key: string | null;
}

interface MeetingMinutesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null;
  clientId?: string | null;
  area?: string | null;
  projectName?: string;
}

export function MeetingMinutesDialog({
  open,
  onOpenChange,
  projectId,
  clientId,
  area,
  projectName,
}: MeetingMinutesDialogProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: orgUsers = [] } = useOrgUsers();
  const meetingUploadLimits = withLimits(documentsLimits, {
    accept: ".pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.xml",
    maxFiles: STANDARD_BATCH_MAX_FILES,
  });

  const [step, setStep] = useState<"input" | "preview">("input");
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [summary, setSummary] = useState("");
  const [proposedTasks, setProposedTasks] = useState<ProposedTask[]>([]);
  const [creating, setCreating] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  /** Clave → nombre visible para fases (proyecto + sugerencia IA + manuales). */
  const [phaseKeyNameMap, setPhaseKeyNameMap] = useState<Record<string, string>>({});
  const [newPhaseName, setNewPhaseName] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  /** Con `projectId`: añadir al actual o crear proyecto nuevo. */
  const [importMode, setImportMode] = useState<"same" | "new">("same");
  const isStandalone = !projectId;

  const applyAnalyzeResponse = useCallback(
    (data: {
      summary?: string;
      phases?: { key: string; name: string }[];
      tasks?: any[];
      import_mode_suggestion?: string | null;
    }, projectRows: { key: string; name: string }[]) => {
      const fromProject: Record<string, string> = {};
      for (const p of projectRows) {
        fromProject[p.key] = p.name;
      }
      const fromApi: { key: string; name: string }[] = Array.isArray(data.phases) ? data.phases : [];
      for (const p of fromApi) {
        fromProject[p.key] = p.name;
      }
      const rawTasks = data.tasks || [];
      for (const t of rawTasks) {
        if (t?.phase_key && t.phase) {
          if (!fromProject[t.phase_key]) fromProject[t.phase_key] = t.phase;
        }
      }
      setPhaseKeyNameMap({ ...fromProject });
      setProposedTasks(
        rawTasks.map((t: any) => ({
          ...t,
          accepted: true,
          phase_key: t.phase_key ?? null,
          phase: t.phase_key
            ? (fromProject[t.phase_key] ?? t.phase ?? null)
            : t.phase ?? null,
        })),
      );
      if (data.import_mode_suggestion === "new_project") {
        setImportMode("new");
      } else {
        setImportMode("same");
      }
    },
    [],
  );

  const fetchExistingPhasesForProject = useCallback(async (): Promise<{ key: string; name: string }[]> => {
    if (!projectId) return [];
    const { data, error } = await supabase.from("projects").select("phases").eq("id", projectId).single();
    if (error) return [];
    const raw = data?.phases;
    if (!Array.isArray(raw)) return [];
    return raw
      .map((p: { key: string; name: string }) => ({ key: p.key, name: p.name }))
      .filter((p) => p.key && p.name);
  }, [projectId]);

  /** Igual que el tab Cumplimiento: asegura claves canónicas en `projects.phases` antes de analizar o crear tareas. */
  const seedComplianceProjectPhasesIfNeeded = useCallback(async () => {
    if (!projectId || area !== "cumplimiento") return;
    try {
      const changed = await ensureCompliancePhasesOnProject(projectId);
      if (changed) {
        queryClient.invalidateQueries({ queryKey: ["project", projectId] });
        queryClient.invalidateQueries({ queryKey: ["compliance-dashboard-project", projectId] });
      }
    } catch {
      /* no bloquear minuta si falla el sembrado */
    }
  }, [projectId, area, queryClient]);

  const processMeetingFile = async (
    file: File,
    ctx: { append: boolean; pdfUseFullPipeline: boolean },
  ) => {
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const isText = file.type.startsWith("text/") || [".md", ".txt", ".csv", ".log"].some((e) => file.name.toLowerCase().endsWith(e));

    const merge = (value: string) => {
      if (ctx.append) {
        setContent((c) => (c.trim() ? `${c}\n\n---\n\n${value}` : value));
      } else {
        setContent(value);
      }
    };

    if (isText) {
      const text = await file.text();
      merge(text);
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
          toast.error("No se pudo leer el PDF. Pega el contenido en el cuadro de texto.");
          return;
        }
      }

      if (!extractedText) {
        setAnalyzing(false);
        toast.error("El PDF no tiene texto legible. Pega el contenido abajo.");
        return;
      }

      if (!ctx.pdfUseFullPipeline) {
        setAnalyzing(false);
        merge(extractedText);
        toast.info("Texto de PDF añadido. Pulsa «Analizar y proponer tareas» para unificar con el resto.");
        return;
      }

      toast.info(`Texto extraído (${Math.round(extractedText.length / 1000)}k caracteres). Analizando con IA…`);

      try {
        await seedComplianceProjectPhasesIfNeeded();
        const projectRows = await fetchExistingPhasesForProject();
        const { data, error } = await supabase.functions.invoke("analyze-meeting", {
          body: {
            content: extractedText,
            project_id: projectId,
            client_id: clientId ?? null,
            area: area ?? null,
            existing_phases: projectRows,
          },
        });
        if (error) throw new Error(data?.message ?? data?.error ?? error.message);
        if (data?.error) throw new Error(data.message ?? data.error);
        if (ctx.append) {
          setContent((c) => (c.trim() ? `${c}\n\n---\n\n${extractedText}` : extractedText));
        } else {
          setContent(extractedText);
        }
        setSummary(data.summary ?? "");
        applyAnalyzeResponse(data, projectRows);
        setStep("preview");
        toast.success("Análisis listo. Revisa las tareas propuestas.");
      } catch (err: any) {
        console.error("PDF analysis error:", err);
        merge(extractedText);
        toast.info("Texto cargado. Pulsa «Analizar y proponer tareas» para reintentar.");
      } finally {
        setAnalyzing(false);
      }
      return;
    }

    if (ext === "docx" || file.type.includes("wordprocessingml")) {
      try {
        toast.info("Extrayendo texto del Word…");
        const mammoth = await import("mammoth");
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        merge(result.value.trim() || "(No se pudo extraer texto del documento)");
        toast.success("Texto del Word cargado");
      } catch (err: any) {
        console.error(err);
        toast.error("No se pudo leer el Word. Pega el contenido en el cuadro de texto.");
      }
      return;
    }

    const isExcel =
      ext === "xlsx" ||
      ext === "xls" ||
      (file.type || "").includes("spreadsheetml") ||
      (file.type || "") === "application/vnd.ms-excel";
    if (isExcel) {
      try {
        toast.info("Leyendo hojas de Excel…");
        const XLSX = await import("xlsx");
        const arrayBuffer = await file.arrayBuffer();
        const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
        if (!wb.SheetNames?.length) {
          throw new Error("Sin hojas");
        }
        const stringifyCell = (v: unknown): string => {
          if (v == null || v === "") return "";
          if (v instanceof Date) {
            return Number.isNaN(v.getTime()) ? "" : v.toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
          }
          if (typeof v === "number" && Number.isFinite(v)) return String(v);
          return String(v);
        };
        const MAX_ROWS = 10_000;
        const parts: string[] = [];
        for (const sheetName of wb.SheetNames) {
          const sheet = wb.Sheets[sheetName];
          if (!sheet) continue;
          const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }) as unknown[][];
          const rows = matrix.slice(0, MAX_ROWS);
          const lines = rows.map((row) =>
            (Array.isArray(row) ? row : []).map((c) => stringifyCell(c)).join("\t"),
          );
          parts.push(`--- ${sheetName} ---\n${lines.join("\n")}`);
        }
        const text = parts.join("\n\n").trim();
        merge(text || "(No se pudo extraer texto del archivo)");
        toast.success("Contenido de Excel cargado");
      } catch (err: any) {
        console.error(err);
        toast.error("No se pudo leer el Excel. Pega el contenido o exporta a CSV.");
      }
      return;
    }

    toast.info("Para este tipo de archivo, copia y pega el contenido en el campo de texto.");
  };

  const onMeetingFilesChange = async (next: File[]) => {
    const list = next.slice(0, STANDARD_BATCH_MAX_FILES);
    if (list.length === 0) return;
    setFileName(list.map((f) => f.name).join(", "));
    let firstPdf = true;
    for (const file of list) {
      const fext = file.name.split(".").pop()?.toLowerCase() ?? "";
      const isPdf = fext === "pdf";
      const pdfUseFull = !isPdf || firstPdf;
      if (isPdf) firstPdf = false;
      await processMeetingFile(file, { append: list.length > 1, pdfUseFullPipeline: pdfUseFull });
    }
  };

  const handleAnalyze = async () => {
    if (!content.trim()) {
      toast.error("Ingresa el contenido del documento");
      return;
    }
    setAnalyzing(true);
    try {
      await seedComplianceProjectPhasesIfNeeded();
      const projectRows = await fetchExistingPhasesForProject();
      const { data, error } = await supabase.functions.invoke("analyze-meeting", {
        body: {
          content: content.trim(),
          project_id: projectId,
          client_id: clientId || null,
          area: area || null,
          existing_phases: projectRows,
        },
      });

      if (error) {
        const errorMsg = data?.message || data?.error || error.message || "Error desconocido";
        throw new Error(errorMsg);
      }
      if (data?.error) throw new Error(data.message || data.error);

      setSummary(data.summary || "");
      applyAnalyzeResponse(data, projectRows);
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
      phase_key: null,
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

  const buildPhaseObjectsForNewProject = (accepted: ProposedTask[]): SyncPhase[] => {
    const keys = new Set<string>();
    for (const k of Object.keys(phaseKeyNameMap)) {
      if (k) keys.add(k);
    }
    for (const t of accepted) {
      if (t.phase_key) keys.add(t.phase_key);
    }
    return [...keys].map((k, i) => ({
      key: k,
      name: phaseKeyNameMap[k] || k,
      order: i,
    }));
  };

  const handleCreateTasks = async () => {
    const accepted = proposedTasks.filter((t) => t.accepted && t.title.trim());
    if (accepted.length === 0) {
      toast.error("Selecciona al menos una tarea con título");
      return;
    }
    const needsNewName = isStandalone || (!isStandalone && importMode === "new");
    if (needsNewName && !newProjectName.trim()) {
      toast.error("Indica un nombre para el nuevo proyecto");
      return;
    }
    setCreating(true);
    try {
      await seedComplianceProjectPhasesIfNeeded();

      const { data: orgId } = await supabase.rpc("get_user_org_id", {
        _user_id: user!.id,
      });

      let targetProjectId = projectId || null;
      const createNew = isStandalone || (!isStandalone && importMode === "new");

      if (createNew && newProjectName.trim()) {
        const phaseObjs = buildPhaseObjectsForNewProject(accepted);
        const { data: newProject, error: projError } = await supabase
          .from("projects")
          .insert({
            name: newProjectName.trim(),
            description: summary || null,
            client_id: clientId || null,
            area: (area as any) || null,
            organization_id: orgId!,
            created_by: user!.id,
            responsible_user_id: user!.id,
            phases: phaseObjs,
          } as any)
          .select("id")
          .single();
        if (projError) throw projError;
        targetProjectId = newProject.id;
        toast.success(`Proyecto "${newProjectName.trim()}" creado`);
        if ((area as any) === "cumplimiento" && targetProjectId) {
          await ensureCompliancePhasesOnProject(targetProjectId);
        }
      } else if (!createNew && projectId) {
        const { data: projRow, error: loadErr } = await supabase
          .from("projects")
          .select("phases")
          .eq("id", projectId)
          .single();
        if (loadErr) throw loadErr;
        const inDb = new Set(
          (Array.isArray(projRow?.phases) ? (projRow!.phases as { key: string }[]) : []).map((p) => p.key),
        );
        const additions: SyncPhase[] = [];
        for (const [k, n] of Object.entries(phaseKeyNameMap)) {
          if (!inDb.has(k)) {
            additions.push({ key: k, name: n, order: 0 });
          }
        }
        if (additions.length > 0) {
          await appendProjectPhases(projectId, additions);
        }
      }

      let created = 0;
      for (const task of accepted) {
        const { error } = await supabase.from("tasks").insert({
          title: task.title,
          description: task.description || null,
          priority: task.priority || "media",
          due_date: task.due_date || null,
          assigned_to: task.assigned_to_id || null,
          project_id: targetProjectId || null,
          client_id: clientId || null,
          area: (area as any) || null,
          organization_id: orgId!,
          created_by: user!.id,
          status: "pendiente",
          phase_key: task.phase_key || null,
        });
        if (!error) created++;
      }

      if (createNew && targetProjectId) {
        const path =
          area === "cumplimiento"
            ? `/proyectos/${targetProjectId}?tab=cumplimiento`
            : `/proyectos/${targetProjectId}?tab=tareas`;
        navigate(path);
      }

      toast.success(`${created} tarea${created !== 1 ? "s" : ""} creada${created !== 1 ? "s" : ""} exitosamente`);
      if (targetProjectId) {
        queryClient.invalidateQueries({ queryKey: ["project-tasks", targetProjectId] });
        queryClient.invalidateQueries({ queryKey: ["project", targetProjectId] });
        queryClient.invalidateQueries({ queryKey: ["compliance-tasks", targetProjectId] });
        queryClient.invalidateQueries({ queryKey: ["compliance-dashboard-project", targetProjectId] });
      }
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
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
    setPhaseKeyNameMap({});
    setNewPhaseName("");
    setNewProjectName("");
    setImportMode("same");
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
          {step === "input" ? (
            <DialogDescription>
              {isStandalone
                ? "Sube o pega el contenido del documento para generar un proyecto con tareas automáticamente."
                : `Sube o pega el contenido del documento para generar tareas automáticamente en "${projectName}".`}
            </DialogDescription>
          ) : (
            <>
              <DialogDescription className="sr-only">
                Resumen generado a partir del documento. Revisa y ajusta las tareas propuestas.
              </DialogDescription>
              {summary ? (
                <div className="text-left mt-1 space-y-2 max-h-40 overflow-y-auto pr-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Resumen del documento
                  </p>
                  <KawiilAiMarkdown variant="compact">{summary}</KawiilAiMarkdown>
                </div>
              ) : null}
            </>
          )}
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
                  <p className="text-xs text-muted-foreground mb-1">
                    {fileName
                      ? `Seleccionado: ${fileName}`
                      : `Hasta ${STANDARD_BATCH_MAX_FILES} archivos (PDF, Word, Excel, .txt, .md, .csv)`}
                  </p>
                  <FileDropzone
                    files={[]}
                    onChange={(next) => void onMeetingFilesChange(next)}
                    limits={meetingUploadLimits}
                    variant="area"
                    className="min-h-20"
                    showChips={false}
                    hint="Arrastra o elige documentos (mismo criterio que el resto de Kawiil)"
                    subhint="El primer PDF con análisis IA; los demás se unen al texto. Pulsa Analizar para unificar."
                  />
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
            {/* Nombre de proyecto: standalone o al crear sub-proyecto desde uno existente */}
            {(isStandalone || (!isStandalone && importMode === "new")) && (
              <div className="space-y-1.5 pb-2 border-b border-border/40">
                <label className="text-xs font-medium text-muted-foreground">Nombre del nuevo proyecto *</label>
                <Input
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Ej: Respuesta observaciones de auditoría 2026"
                  className="text-sm"
                />
              </div>
            )}

            {/* Destino de la importación (con proyecto abierto) */}
            {!isStandalone && projectId && (
              <div className="space-y-2 pb-2 border-b border-border/40">
                <p className="text-xs font-medium text-muted-foreground">Destino de las tareas</p>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    size="sm"
                    variant={importMode === "same" ? "default" : "outline"}
                    className="justify-start h-auto min-h-9 py-1.5 px-3"
                    onClick={() => setImportMode("same")}
                  >
                    Añadir a «{projectName || "este proyecto"}»
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={importMode === "new" ? "default" : "outline"}
                    className="justify-start h-auto min-h-9 py-1.5 px-3"
                    onClick={() => setImportMode("new")}
                  >
                    Crear un proyecto nuevo (mismo cliente/área)
                  </Button>
                </div>
              </div>
            )}

            {/* Phase management */}
            <div className="space-y-2 pb-2 border-b border-border/40">
              <div className="flex items-center gap-2">
                <Layers className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Fases / Etapas (claves y nombres)</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {Object.entries(phaseKeyNameMap).map(([phKey, phLabel]) => (
                  <Badge key={phKey} variant="secondary" className="text-xs gap-1 pr-1 max-w-full">
                    <span className="truncate">{phLabel}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setPhaseKeyNameMap((m) => {
                          const n = { ...m };
                          delete n[phKey];
                          return n;
                        });
                        setProposedTasks((prev) =>
                          prev.map((t) => (t.phase_key === phKey ? { ...t, phase_key: null, phase: null } : t))
                        );
                      }}
                      className="ml-0.5 hover:text-destructive shrink-0"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <div className="flex items-center gap-1">
                  <Input
                    value={newPhaseName}
                    onChange={(e) => setNewPhaseName(e.target.value)}
                    placeholder="Nueva fase..."
                    className="h-7 text-xs w-32"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newPhaseName.trim()) {
                        const k = `fase_user_${Date.now()}`;
                        setPhaseKeyNameMap((m) => ({ ...m, [k]: newPhaseName.trim() }));
                        setNewPhaseName("");
                      }
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    disabled={!newPhaseName.trim()}
                    onClick={() => {
                      if (newPhaseName.trim()) {
                        const k = `fase_user_${Date.now()}`;
                        setPhaseKeyNameMap((m) => ({ ...m, [k]: newPhaseName.trim() }));
                        setNewPhaseName("");
                      }
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            {proposedTasks.length === 0 ? (
              <div className="text-center py-8">
                <AlertTriangle className="h-8 w-8 text-warning mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No se encontraron tareas.</p>
              </div>
            ) : (
              (() => {
                // Group tasks by phase
                const phaseGroups = new Map<string, { task: ProposedTask; index: number }[]>();
                proposedTasks.forEach((task, index) => {
                  const key = task.phase_key || "__none__";
                  if (!phaseGroups.has(key)) phaseGroups.set(key, []);
                  phaseGroups.get(key)!.push({ task, index });
                });
                // Ordered: phases first, then "Sin fase"
                const orderedKeys = [...phaseGroups.keys()].sort((a, b) => {
                  if (a === "__none__") return 1;
                  if (b === "__none__") return -1;
                  return 0;
                });
                const hasPhases = orderedKeys.some(k => k !== "__none__");

                const renderTaskRow = (task: ProposedTask, index: number) => {
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
                              variant="secondary"
                              className={cn(
                                "text-[10px] px-1.5 py-0 shrink-0 border-0",
                                PRIORITY_CONFIG[task.priority]?.color ?? "bg-muted text-muted-foreground"
                              )}
                            >
                              {PRIORITY_CONFIG[task.priority]?.label ?? task.priority}
                            </Badge>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                            {!hasPhases && (task.phase_key || task.phase) && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                                <Layers className="h-2.5 w-2.5 mr-0.5" />
                                {(task.phase_key && phaseKeyNameMap[task.phase_key]) || task.phase}
                              </Badge>
                            )}
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
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Fase / Etapa</label>
                            <Select
                              value={task.phase_key || "__none__"}
                              onValueChange={(v) => {
                                setProposedTasks((prev) =>
                                  prev.map((t, i) => {
                                    if (i !== index) return t;
                                    if (v === "__none__") return { ...t, phase_key: null, phase: null };
                                    return { ...t, phase_key: v, phase: phaseKeyNameMap[v] ?? v };
                                  })
                                );
                              }}
                            >
                              <SelectTrigger className="text-sm">
                                <SelectValue placeholder="Sin fase" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Sin fase</SelectItem>
                                {Object.keys(phaseKeyNameMap)
                                  .sort((a, b) => (phaseKeyNameMap[a] || a).localeCompare(phaseKeyNameMap[b] || b, "es"))
                                  .map((pk) => (
                                    <SelectItem key={pk} value={pk}>
                                      {phaseKeyNameMap[pk] || pk}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                };

                if (!hasPhases) {
                  return proposedTasks.map((task, index) => renderTaskRow(task, index));
                }

                return orderedKeys.map((phaseKey) => {
                  const items = phaseGroups.get(phaseKey)!;
                  const phaseName =
                    phaseKey === "__none__"
                      ? "Sin fase asignada"
                      : phaseKeyNameMap[phaseKey] || phaseKey;
                  const acceptedInPhase = items.filter(i => i.task.accepted).length;
                  return (
                    <div key={phaseKey} className="space-y-1.5">
                      <div className="flex items-center gap-2 px-1 py-1.5 rounded-md bg-secondary/40 border border-border/30">
                        <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs font-semibold text-foreground">{phaseName}</span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-auto">
                          {acceptedInPhase}/{items.length}
                        </Badge>
                      </div>
                      <div className="pl-2 space-y-1.5">
                        {items.map(({ task, index }) => renderTaskRow(task, index))}
                      </div>
                    </div>
                  );
                });
              })()
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
              <Button
                onClick={handleCreateTasks}
                disabled={
                  creating ||
                  acceptedCount === 0 ||
                  ((isStandalone || (!isStandalone && importMode === "new")) && !newProjectName.trim())
                }
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
