import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListChecks, NotebookPen, Plus, Trash2, Pencil, CheckSquare, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatDateMX, toDateStringMX } from "@/lib/dateUtils";
import { commentPlainText, parseComment } from "@/lib/commentContent";
import {
  CLOSED_LAWSUIT_STATUSES,
  defaultStagesForType,
  isLegalProcedure,
  statusMeta,
  LAWSUIT_TYPE_OPTIONS,
  currentStageLabel,
  mergeSuggestedStages,
  type SuggestedStage,
  parseLawsuitStages,
  type LawsuitStage,
} from "@/lib/lawsuits";
import { useProfiles } from "@/hooks/useTasks";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LawsuitCommentsPanel } from "@/components/projects/LawsuitCommentsPanel";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import type { Database } from "@/integrations/supabase/types";

type LawsuitRow = Database["public"]["Tables"]["project_lawsuits"]["Row"];
type EntryRow = Database["public"]["Tables"]["project_lawsuit_entries"]["Row"];

interface Props {
  lawsuit: LawsuitRow | null;
  clientId?: string | null;
  /** Carpeta de Dropbox del cliente/juicios donde abre el selector de documentos. */
  dropboxPath?: string;
  lockDropboxToPath?: boolean;
  onClose: () => void;
  onEdit: (lawsuit: LawsuitRow) => void;
}

export function LawsuitWorkspaceSheet({ lawsuit, clientId, dropboxPath, lockDropboxToPath, onClose, onEdit }: Props) {
  const lawsuitId = lawsuit?.id;
  const status = lawsuit ? statusMeta(lawsuit.status, lawsuit.lawsuit_type) : undefined;
  const typeLabel = LAWSUIT_TYPE_OPTIONS.find((t) => t.value === lawsuit?.lawsuit_type)?.label;

  return (
    <Sheet open={!!lawsuit} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        {lawsuit && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="pr-6">{lawsuit.name}</SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {status && <Badge variant="outline" className={status.className}>{status.label}</Badge>}
                  {typeLabel && <Badge variant="outline">{typeLabel}</Badge>}
                  {lawsuit.case_number && <span>Exp. {lawsuit.case_number}</span>}
                  {lawsuit.court && <span>· {lawsuit.court}</span>}
                  <Button variant="ghost" size="sm" className="h-6 px-2 ml-auto" onClick={() => onEdit(lawsuit)}>
                    <Pencil className="h-3 w-3 mr-1" /> Editar datos
                  </Button>
                </div>
              </SheetDescription>
            </SheetHeader>

            <Tabs defaultValue="etapas" className="mt-4">
              <TabsList className="grid grid-cols-5 w-full">
                <TabsTrigger value="etapas" className="px-1 text-xs sm:text-sm">Etapas</TabsTrigger>
                <TabsTrigger value="actuaciones" className="px-1 text-xs sm:text-sm">Actuaciones</TabsTrigger>
                <TabsTrigger value="tareas" className="px-1 text-xs sm:text-sm">Tareas</TabsTrigger>
                <TabsTrigger value="comentarios" className="px-1 text-xs sm:text-sm">Comentarios</TabsTrigger>
                <TabsTrigger value="documentos" className="px-1 text-xs sm:text-sm">Documentos</TabsTrigger>
              </TabsList>
              <TabsContent value="etapas" className="mt-4">
                <StagesPanel lawsuit={lawsuit} />
              </TabsContent>
              <TabsContent value="actuaciones" className="mt-4">
                <EntriesPanel lawsuit={lawsuit} />
              </TabsContent>
              <TabsContent value="tareas" className="mt-4">
                <TasksPanel lawsuitId={lawsuitId!} projectId={lawsuit.project_id} clientId={clientId} />
              </TabsContent>
              <TabsContent value="comentarios" className="mt-4">
                <LawsuitCommentsPanel
                  lawsuit={lawsuit}
                  mode="comments"
                  dropboxPath={dropboxPath}
                  lockDropboxToPath={lockDropboxToPath}
                />
              </TabsContent>
              <TabsContent value="documentos" className="mt-4">
                <LawsuitCommentsPanel
                  lawsuit={lawsuit}
                  mode="documents"
                  dropboxPath={dropboxPath}
                  lockDropboxToPath={lockDropboxToPath}
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function StagesPanel({ lawsuit }: { lawsuit: LawsuitRow }) {
  const queryClient = useQueryClient();
  const [newStage, setNewStage] = useState("");
  const stages = parseLawsuitStages(lawsuit.stages);
  const closed = CLOSED_LAWSUIT_STATUSES.includes(lawsuit.status);

  const saveStages = useMutation({
    mutationFn: async (next: LawsuitStage[]) => {
      const update: Database["public"]["Tables"]["project_lawsuits"]["Update"] = {
        stages: next as unknown as Database["public"]["Tables"]["project_lawsuits"]["Update"]["stages"],
      };
      // La etapa actual sigue a la checklist; si ya no quedan pendientes no la sobreescribimos.
      const current = currentStageLabel(next);
      if (current) update.current_stage = current;
      const { error } = await supabase.from("project_lawsuits").update(update).eq("id", lawsuit.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-lawsuits", lawsuit.project_id] });
    },
    onError: (e: Error) => toast.error("No se pudo guardar las etapas: " + e.message),
  });

  const toggle = (key: string) =>
    saveStages.mutate(
      stages.map((s) =>
        s.key === key
          ? { ...s, completed: !s.completed, completed_at: s.completed ? null : toDateStringMX() }
          : s,
      ),
    );

  const addStage = () => {
    const label = newStage.trim();
    if (!label) return;
    saveStages.mutate([...stages, { key: `custom-${Date.now()}`, label, completed: false, completed_at: null }]);
    setNewStage("");
  };

  const done = stages.filter((s) => s.completed).length;

  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedStage[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [replacePending, setReplacePending] = useState(true);

  const suggestWithAi = async () => {
    setAiOpen(true);
    setAiBusy(true);
    setAiError(null);
    setSuggestions([]);
    try {
      const [entriesRes, commentsRes] = await Promise.all([
        supabase
          .from("project_lawsuit_entries")
          .select("entry_date, content")
          .eq("lawsuit_id", lawsuit.id)
          .order("entry_date", { ascending: false })
          .limit(25),
        supabase
          .from("project_lawsuit_comments")
          .select("created_at, content")
          .eq("lawsuit_id", lawsuit.id)
          .order("created_at", { ascending: false })
          .limit(25),
      ]);
      const documents: string[] = [];
      const comments = (commentsRes.data ?? []).map((c) => {
        const { body, attachments } = parseComment(c.content);
        attachments.forEach((a) => documents.push(a.name));
        return { date: c.created_at.slice(0, 10), text: commentPlainText(body) };
      });
      const { data, error } = await supabase.functions.invoke<{
        stages?: SuggestedStage[];
        error?: string;
        message?: string;
      }>("lawsuit-ai-stages", {
        body: {
          lawsuit: {
            name: lawsuit.name,
            type: lawsuit.lawsuit_type,
            typeLabel: LAWSUIT_TYPE_OPTIONS.find((t) => t.value === lawsuit.lawsuit_type)?.label,
            isProcedure: isLegalProcedure(lawsuit.lawsuit_type),
            caseNumber: lawsuit.case_number,
            court: lawsuit.court,
            plaintiff: lawsuit.plaintiff,
            defendant: lawsuit.defendant,
            status: lawsuit.status,
            filedDate: lawsuit.filed_date,
            notes: lawsuit.notes,
          },
          stages: stages.map((st) => ({ label: st.label, completed: st.completed })),
          entries: (entriesRes.data ?? []).map((e) => ({ date: e.entry_date, content: e.content })),
          comments,
          documents: Array.from(new Set(documents)),
        },
      });
      if (error) throw new Error(error.message || "Error invocando IA");
      const list = data?.stages ?? [];
      if (list.length === 0) throw new Error(data?.message || "La IA no devolvió etapas");
      setSuggestions(list);
      setPicked(new Set(list.map((_, i) => i)));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setAiBusy(false);
    }
  };

  const applySuggestions = () => {
    const chosen = suggestions.filter((_, i) => picked.has(i));
    saveStages.mutate(mergeSuggestedStages(stages, chosen, replacePending));
    setAiOpen(false);
  };

  const aiButton = (
    <Button size="sm" variant="outline" onClick={suggestWithAi} disabled={aiBusy || saveStages.isPending}>
      <Sparkles className="h-3.5 w-3.5 mr-1" /> Sugerir etapas con IA
    </Button>
  );

  return (
    <div className="space-y-3">
      {stages.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center space-y-3">
          <ListChecks className="h-7 w-7 mx-auto text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            Aún no hay etapas. Carga las estándar de este tipo o agrega las tuyas.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {aiButton}
            <Button size="sm" variant="outline" onClick={() => saveStages.mutate(defaultStagesForType(lawsuit.lawsuit_type))}>
              Cargar etapas estándar
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {done} de {stages.length} etapas completadas
            {closed ? (isLegalProcedure(lawsuit.lawsuit_type) ? " · trámite cerrado" : " · juicio cerrado") : ""}
          </p>
          {aiButton}
          </div>
          <ul className="divide-y divide-border/50 rounded-lg border">
            {stages.map((s) => (
              <li key={s.key} className="flex items-center gap-3 px-3 py-2">
                <Checkbox checked={s.completed} onCheckedChange={() => toggle(s.key)} />
                <span className={`text-sm flex-1 ${s.completed ? "line-through text-muted-foreground" : ""}`}>
                  {s.label}
                </span>
                {s.completed_at && (
                  <span className="text-[11px] text-muted-foreground">{formatDateMX(s.completed_at)}</span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground"
                  onClick={() => saveStages.mutate(stages.filter((x) => x.key !== s.key))}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="flex gap-2">
        <Input
          value={newStage}
          onChange={(e) => setNewStage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addStage()}
          placeholder="Agregar etapa (ej. Solicitud de oficio)"
        />
        <Button size="sm" onClick={addStage} disabled={!newStage.trim() || saveStages.isPending}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      <Dialog open={aiOpen} onOpenChange={(o) => !aiBusy && setAiOpen(o)}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Etapas sugeridas por IA</DialogTitle>
            <DialogDescription>
              Se basan en los datos del expediente, notas, actuaciones, comentarios y nombres de los documentos
              adjuntos. Revísalas antes de aplicarlas.
            </DialogDescription>
          </DialogHeader>
          {aiBusy ? (
            <div className="flex items-center gap-2 py-6 justify-center text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Analizando la información del asunto…
            </div>
          ) : aiError ? (
            <p className="text-sm text-destructive py-2">{aiError}</p>
          ) : (
            <div className="space-y-3">
              <ul className="divide-y divide-border/50 rounded-lg border">
                {suggestions.map((sg, i) => (
                  <li key={i} className="flex items-start gap-3 px-3 py-2">
                    <Checkbox
                      className="mt-0.5"
                      checked={picked.has(i)}
                      onCheckedChange={() =>
                        setPicked((prev) => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          return next;
                        })
                      }
                    />
                    <div className="min-w-0">
                      <div className="text-sm">{sg.label}</div>
                      {sg.reason && <div className="text-[11px] text-muted-foreground">{sg.reason}</div>}
                    </div>
                  </li>
                ))}
              </ul>
              {stages.some((st) => !st.completed) && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox checked={replacePending} onCheckedChange={(v) => setReplacePending(v === true)} />
                  Reemplazar las etapas pendientes actuales (las completadas se conservan)
                </label>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiOpen(false)} disabled={aiBusy}>
              Cancelar
            </Button>
            {!aiBusy && aiError ? (
              <Button onClick={suggestWithAi}>Reintentar</Button>
            ) : (
              <Button onClick={applySuggestions} disabled={aiBusy || picked.size === 0}>
                Aplicar {picked.size > 0 ? `(${picked.size})` : ""}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EntriesPanel({ lawsuit }: { lawsuit: LawsuitRow }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: profiles } = useProfiles();
  const [content, setContent] = useState("");
  const [entryDate, setEntryDate] = useState(toDateStringMX());
  const queryKey = ["lawsuit-entries", lawsuit.id];

  const { data: entries = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("project_lawsuit_entries")
        .select("*")
        .eq("lawsuit_id", lawsuit.id)
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as EntryRow[];
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("project_lawsuit_entries").insert({
        lawsuit_id: lawsuit.id,
        organization_id: lawsuit.organization_id,
        content: content.trim(),
        entry_date: entryDate,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setContent("");
      setEntryDate(toDateStringMX());
    },
    onError: (e: Error) => toast.error("No se pudo guardar la actuación: " + e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("project_lawsuit_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e: Error) => toast.error("No se pudo eliminar: " + e.message),
  });

  const nameOf = (uid: string | null) =>
    (profiles as { user_id: string; full_name: string | null }[] | undefined)?.find((p) => p.user_id === uid)
      ?.full_name ?? null;

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border p-3">
        <Textarea
          rows={3}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Registra una actuación: acuerdo, promoción, visita al juzgado, llamada…"
        />
        <div className="flex items-center gap-2">
          <Input type="date" className="w-40" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => add.mutate()}
            disabled={!content.trim() || !entryDate || add.isPending}
          >
            <NotebookPen className="h-4 w-4 mr-1" /> Registrar
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">Aún no hay actuaciones registradas.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((e) => (
            <li key={e.id} className="rounded-lg border p-3">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-1">
                <span className="font-medium text-foreground">{formatDateMX(e.entry_date)}</span>
                {nameOf(e.created_by) && <span>· {nameOf(e.created_by)}</span>}
                {e.created_by === user?.id && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 ml-auto text-muted-foreground"
                    onClick={() => remove.mutate(e.id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <p className="text-sm whitespace-pre-wrap">{e.content}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TasksPanel({
  lawsuitId,
  projectId,
  clientId,
}: {
  lawsuitId: string;
  projectId: string;
  clientId?: string | null;
}) {
  const navigate = useNavigate();
  const [newTaskOpen, setNewTaskOpen] = useState(false);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["lawsuit-tasks", lawsuitId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, status, priority, due_date")
        .eq("lawsuit_id", lawsuitId)
        .order("due_date", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {tasks.length === 0 ? "Sin tareas vinculadas" : `${tasks.length} tarea${tasks.length === 1 ? "" : "s"}`}
        </p>
        <Button size="sm" onClick={() => setNewTaskOpen(true)}>
          <Plus className="h-4 w-4 mr-1" /> Nueva tarea
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          <CheckSquare className="h-7 w-7 mx-auto mb-2 opacity-40" />
          Crea las tareas de este juicio (ir al juzgado, escanear expediente, presentar promoción…).
        </div>
      ) : (
        <ul className="divide-y divide-border/50 rounded-lg border">
          {tasks.map((t) => (
            <li key={t.id}>
              <button
                className="flex items-center gap-3 w-full px-3 py-2 text-left hover:bg-secondary/30"
                onClick={() => navigate(`/proyectos/${projectId}?tab=tareas&taskId=${t.id}`)}
              >
                <span className="text-sm flex-1 truncate">{t.title}</span>
                {t.due_date && <span className="text-[11px] text-muted-foreground">{formatDateMX(t.due_date)}</span>}
                <Badge variant="outline" className="text-[10px]">{String(t.status).replace("_", " ")}</Badge>
              </button>
            </li>
          ))}
        </ul>
      )}

      <TaskFormDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        defaultProjectId={projectId}
        defaultClientId={clientId ?? undefined}
        defaultArea="juicios"
        defaultLawsuitId={lawsuitId}
      />
    </div>
  );
}
