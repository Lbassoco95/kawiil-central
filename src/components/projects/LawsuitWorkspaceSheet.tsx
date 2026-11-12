import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Brain,
  CalendarClock,
  Check,
  CheckSquare,
  ListChecks,
  Loader2,
  MapPin,
  NotebookPen,
  Pencil,
  Plus,
  Send,
  Sparkles,
  Trash2,
  UserRound,
} from "lucide-react";
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
  LAWSUIT_ENTRY_TYPE_OPTIONS,
  entryTypeLabel,
  formatScheduledAt,
  mapsSearchUrl,
  currentStageLabel,
  mergeSuggestedStages,
  type SuggestedStage,
  parseLawsuitStages,
  setCurrentStage,
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LawsuitCommentsPanel } from "@/components/projects/LawsuitCommentsPanel";
import { LawsuitDocumentsPanel } from "@/components/projects/LawsuitDocumentsPanel";
import { LawsuitClientVisibilityPanel } from "@/components/projects/LawsuitClientVisibilityPanel";
import { LawsuitClientMessagesPanel } from "@/components/projects/LawsuitClientMessagesPanel";
import { LawsuitDatesHistoryPanel } from "@/components/projects/LawsuitDatesHistoryPanel";
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

  // Mensajes del cliente sin leer (se muestran junto a la pestaña «Cliente»).
  const { data: unread = 0 } = useQuery({
    queryKey: ["lawsuit-client-unread", lawsuitId],
    enabled: !!lawsuitId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("lawsuit_client_messages")
        .select("id", { count: "exact", head: true })
        .eq("lawsuit_id", lawsuitId!)
        .eq("sender", "client")
        .is("read_by_team_at", null);
      if (error) throw error;
      return count ?? 0;
    },
  });

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
              <TabsList className="grid grid-cols-7 w-full">
                <TabsTrigger value="etapas" className="px-1 text-xs sm:text-sm">Etapas</TabsTrigger>
                <TabsTrigger value="fechas" className="px-1 text-xs sm:text-sm">Fechas</TabsTrigger>
                <TabsTrigger value="actuaciones" className="px-1 text-xs sm:text-sm">Actuaciones</TabsTrigger>
                <TabsTrigger value="tareas" className="px-1 text-xs sm:text-sm">Tareas</TabsTrigger>
                <TabsTrigger value="comentarios" className="px-1 text-xs sm:text-sm">Comentarios</TabsTrigger>
                <TabsTrigger value="documentos" className="px-1 text-xs sm:text-sm">Documentos</TabsTrigger>
                <TabsTrigger value="cliente" className="px-1 text-xs sm:text-sm">
                  Cliente{unread > 0 ? ` (${unread})` : ""}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="etapas" className="mt-4">
                <StagesPanel lawsuit={lawsuit} />
              </TabsContent>
              <TabsContent value="fechas" className="mt-4">
                <LawsuitDatesHistoryPanel lawsuit={lawsuit} />
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
              <TabsContent value="documentos" className="mt-4 space-y-5">
                <LawsuitDocumentsPanel lawsuit={lawsuit} clientId={clientId} />
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-muted-foreground">Enlaces de Dropbox y adjuntos de comentarios</h4>
                <LawsuitCommentsPanel
                  lawsuit={lawsuit}
                  mode="documents"
                  dropboxPath={dropboxPath}
                  lockDropboxToPath={lockDropboxToPath}
                />
                </div>
              </TabsContent>
              <TabsContent value="cliente" className="mt-4">
                <LawsuitClientVisibilityPanel lawsuit={lawsuit} />
                <div className="mt-5">
                  <LawsuitClientMessagesPanel lawsuit={lawsuit} />
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

type AiTurn =
  | { role: "assistant"; stages: SuggestedStage[]; reply?: string }
  | { role: "user"; text: string };

function StagesPanel({ lawsuit }: { lawsuit: LawsuitRow }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newStage, setNewStage] = useState("");
  const stages = parseLawsuitStages(lawsuit.stages);
  const closed = CLOSED_LAWSUIT_STATUSES.includes(lawsuit.status);

  const saveStages = useMutation({
    mutationFn: async (next: LawsuitStage[]) => {
      const before = currentStageLabel(stages);
      const update: Database["public"]["Tables"]["project_lawsuits"]["Update"] = {
        stages: next as unknown as Database["public"]["Tables"]["project_lawsuits"]["Update"]["stages"],
      };
      // La etapa actual sigue a la checklist; si ya no quedan pendientes no la sobreescribimos.
      const current = currentStageLabel(next);
      if (current) update.current_stage = current;
      const { error } = await supabase.from("project_lawsuits").update(update).eq("id", lawsuit.id);
      if (error) throw error;
      // Cada avance de etapa queda en la bitácora de actuaciones (y alimenta a la IA).
      if (stages.length > 0 && current !== before) {
        const text = current
          ? `Avance de etapa: ${before ? `de «${before}» a ` : "ahora en "}«${current}»`
          : "Todas las etapas quedaron completadas";
        await supabase.from("project_lawsuit_entries").insert({
          lawsuit_id: lawsuit.id,
          organization_id: lawsuit.organization_id,
          content: text,
          entry_date: toDateStringMX(),
          created_by: user?.id ?? null,
        });
        queryClient.invalidateQueries({ queryKey: ["lawsuit-entries", lawsuit.id] });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-lawsuits", lawsuit.project_id] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-lawsuits"] });
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

  const chooseCurrent = (key: string) => saveStages.mutate(setCurrentStage(stages, key));

  const addStage = () => {
    const label = newStage.trim();
    if (!label) return;
    saveStages.mutate([...stages, { key: `custom-${Date.now()}`, label, completed: false, completed_at: null }]);
    setNewStage("");
  };

  const done = stages.filter((s) => s.completed).length;
  const currentKey = stages.find((s) => !s.completed)?.key ?? null;

  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedStage[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [replacePending, setReplacePending] = useState(true);
  const [conversation, setConversation] = useState<AiTurn[]>([]);
  const [feedback, setFeedback] = useState("");
  const [memory, setMemory] = useState(lawsuit.ai_memory ?? "");
  const [memoryDraft, setMemoryDraft] = useState<string | null>(null);

  const saveMemory = useMutation({
    mutationFn: async (next: string) => {
      const value = next.trim() || null;
      const { error } = await supabase
        .from("project_lawsuits")
        .update({
          ai_memory: value,
          ai_memory_updated_at: new Date().toISOString(),
          ai_memory_updated_by: user?.id ?? null,
        })
        .eq("id", lawsuit.id);
      if (error) throw error;
      return value ?? "";
    },
    onSuccess: (value) => {
      setMemory(value);
      setMemoryDraft(null);
      queryClient.invalidateQueries({ queryKey: ["project-lawsuits", lawsuit.project_id] });
    },
    onError: (e: Error) => toast.error("No se pudo guardar la memoria de la IA: " + e.message),
  });

  const runAi = async (history: AiTurn[], mem = memory) => {
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
      // Documentos del expediente ya leídos por IA: nombre + resumen de su contenido.
      const { data: docRows } = await supabase
        .from("documents")
        .select("id, name")
        .eq("project_id", lawsuit.project_id)
        .eq("metadata->>lawsuit_id", lawsuit.id)
        .order("created_at", { ascending: false })
        .limit(30);
      const docList = docRows ?? [];
      const summaries: { name: string; summary: string }[] = [];
      if (docList.length > 0) {
        const { data: ext } = await supabase
          .from("extracted_documents")
          .select("document_id, ai_summary, document_type")
          .in("document_id", docList.map((d) => d.id))
          .eq("extraction_status", "completed");
        const byId = new Map((ext ?? []).map((e) => [e.document_id, e]));
        for (const d of docList) {
          documents.push(d.name);
          const e = byId.get(d.id);
          if (e?.ai_summary) summaries.push({ name: d.name, summary: e.ai_summary });
        }
      }
      const comments = (commentsRes.data ?? []).map((c) => {
        const { body, attachments } = parseComment(c.content);
        attachments.forEach((a) => documents.push(a.name));
        return { date: c.created_at.slice(0, 10), text: commentPlainText(body) };
      });
      const { data, error } = await supabase.functions.invoke<{
        stages?: SuggestedStage[];
        reply?: string;
        memory?: string;
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
          documentSummaries: summaries,
          conversation: history,
          memory: mem || null,
        },
      });
      if (error) throw new Error(error.message || "Error invocando IA");
      const list = data?.stages ?? [];
      if (list.length === 0) throw new Error(data?.message || "La IA no devolvió etapas");
      setSuggestions(list);
      setPicked(new Set(list.map((_, i) => i)));
      setConversation([...history, { role: "assistant", stages: list, reply: data?.reply || undefined }]);
      if (typeof data?.memory === "string" && data.memory.trim() !== mem.trim()) saveMemory.mutate(data.memory);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setAiBusy(false);
    }
  };

  const suggestWithAi = () => {
    const mem = lawsuit.ai_memory ?? "";
    setConversation([]);
    setFeedback("");
    setMemory(mem);
    setMemoryDraft(null);
    void runAi([], mem);
  };

  const sendFeedback = () => {
    const text = feedback.trim();
    if (!text || aiBusy) return;
    const history: AiTurn[] = [...conversation, { role: "user", text }];
    setConversation(history);
    setFeedback("");
    void runAi(history);
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
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
            <span className="text-xs font-medium whitespace-nowrap">Vamos en:</span>
            <Select
              value={currentKey ?? ""}
              onValueChange={chooseCurrent}
              disabled={saveStages.isPending}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue placeholder={closed ? "Todas las etapas completas" : "Elige la etapa"} />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-muted-foreground -mt-1">
            Al elegir una etapa, las anteriores se marcan como completadas.
          </p>
          <ul className="divide-y divide-border/50 rounded-lg border">
            {stages.map((s) => (
              <li key={s.key} className="flex items-center gap-3 px-3 py-2">
                <Checkbox checked={s.completed} onCheckedChange={() => toggle(s.key)} />
                <span className={`text-sm flex-1 ${s.completed ? "line-through text-muted-foreground" : ""}`}>
                  {s.label}
                </span>
                {s.key === currentKey && (
                  <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-700 border-blue-500/30">
                    Etapa actual
                  </Badge>
                )}
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
              Se basan en los datos del expediente, notas, actuaciones, comentarios y el contenido de los documentos
              del expediente que ya fueron leídos. Revísalas antes de aplicarlas.
            </DialogDescription>
          </DialogHeader>
          {(memory || memoryDraft !== null) && (
            <div className="space-y-1.5 rounded-lg border border-violet-500/30 bg-violet-500/5 p-2.5">
              <div className="flex items-center gap-1.5">
                <Brain className="h-3.5 w-3.5 text-violet-600" />
                <span className="text-xs font-medium flex-1">Lo que la IA recuerda de este asunto</span>
                {memoryDraft === null && (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => setMemoryDraft(memory)}
                      disabled={aiBusy || saveMemory.isPending}
                    >
                      Editar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs text-muted-foreground"
                      onClick={() => saveMemory.mutate("")}
                      disabled={aiBusy || saveMemory.isPending}
                    >
                      Borrar
                    </Button>
                  </>
                )}
              </div>
              {memoryDraft === null ? (
                <p className="text-xs whitespace-pre-wrap text-muted-foreground">{memory}</p>
              ) : (
                <div className="space-y-1.5">
                  <Textarea
                    rows={4}
                    className="text-xs"
                    value={memoryDraft}
                    onChange={(e) => setMemoryDraft(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setMemoryDraft(null)}>
                      Cancelar
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => saveMemory.mutate(memoryDraft)}
                      disabled={saveMemory.isPending}
                    >
                      Guardar
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
          {conversation.some((t) => t.role === "user") && (
            <div className="space-y-2 rounded-lg border bg-muted/30 p-2">
              {conversation.map((t, i) =>
                t.role === "user" ? (
                  <div key={i} className="ml-8 rounded-md bg-primary/10 px-2.5 py-1.5 text-xs">
                    {t.text}
                  </div>
                ) : t.reply && i > 0 ? (
                  <div key={i} className="mr-8 flex gap-1.5 rounded-md bg-background px-2.5 py-1.5 text-xs text-muted-foreground">
                    <Sparkles className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>{t.reply}</span>
                  </div>
                ) : null,
              )}
            </div>
          )}
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
          {!aiError && (suggestions.length > 0 || conversation.length > 0) && (
            <div className="space-y-1.5">
              <label htmlFor="ai-stages-feedback" className="text-xs font-medium">
                ¿Algo que corregir? Coméntaselo a la IA
              </label>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Lo que le aclares se guarda en la memoria de este juicio y la IA lo toma en cuenta las siguientes veces.
              </p>
              <div className="flex items-end gap-2">
                <Textarea
                  id="ai-stages-feedback"
                  rows={2}
                  className="min-h-0 text-sm"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendFeedback();
                    }
                  }}
                  placeholder="Ej. Es un procedimiento paraprocesal, no una demanda laboral"
                  disabled={aiBusy}
                />
                <Button size="sm" onClick={sendFeedback} disabled={aiBusy || !feedback.trim()}>
                  <Send className="h-3.5 w-3.5 mr-1" /> Ajustar
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAiOpen(false)} disabled={aiBusy}>
              Cancelar
            </Button>
            {!aiBusy && aiError ? (
              <Button onClick={() => void runAi(conversation)}>Reintentar</Button>
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

interface EntryForm {
  entry_type: string;
  content: string;
  entry_date: string;
  scheduled_date: string;
  scheduled_time: string;
  assigned_to: string;
  location: string;
  notes: string;
  client_visible: boolean;
}

const NO_ASSIGNEE = "__none";

const emptyEntryForm = (): EntryForm => ({
  entry_type: "",
  content: "",
  entry_date: toDateStringMX(),
  scheduled_date: "",
  scheduled_time: "",
  assigned_to: "",
  location: "",
  notes: "",
  client_visible: false,
});

const entryToForm = (e: EntryRow): EntryForm => ({
  entry_type: e.entry_type ?? "",
  content: e.content,
  entry_date: e.entry_date,
  scheduled_date: e.scheduled_date ?? "",
  scheduled_time: e.scheduled_time?.slice(0, 5) ?? "",
  assigned_to: e.assigned_to ?? "",
  location: e.location ?? "",
  notes: e.notes ?? "",
  client_visible: e.client_visible,
});

const formToRow = (f: EntryForm) => ({
  entry_type: f.entry_type || null,
  content: f.content.trim(),
  entry_date: f.entry_date,
  scheduled_date: f.scheduled_date || null,
  scheduled_time: f.scheduled_date && f.scheduled_time ? f.scheduled_time : null,
  assigned_to: f.assigned_to || null,
  location: f.location.trim() || null,
  notes: f.notes.trim() || null,
  client_visible: f.client_visible,
});

type ProfileOption = { user_id: string; full_name: string | null; email?: string | null };

function EntryFormFields({
  form,
  onChange,
  profiles,
}: {
  form: EntryForm;
  onChange: (patch: Partial<EntryForm>) => void;
  profiles: ProfileOption[];
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Tipo de actuación</Label>
          <Select value={form.entry_type || undefined} onValueChange={(v) => onChange({ entry_type: v })}>
            <SelectTrigger>
              <SelectValue placeholder="Selecciona…" />
            </SelectTrigger>
            <SelectContent>
              {LAWSUIT_ENTRY_TYPE_OPTIONS.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Fecha de registro</Label>
          <Input type="date" value={form.entry_date} onChange={(e) => onChange({ entry_date: e.target.value })} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Descripción</Label>
        <Textarea
          rows={3}
          value={form.content}
          onChange={(e) => onChange({ content: e.target.value })}
          placeholder="Ej. Ir a revisar el expediente, presentar escrito de autorizados…"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Se llevará a cabo</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              type="date"
              aria-label="Fecha en que se llevará a cabo"
              className="min-w-[9rem] flex-1"
              value={form.scheduled_date}
              onChange={(e) => onChange({ scheduled_date: e.target.value })}
            />
            <Input
              type="time"
              aria-label="Hora en que se llevará a cabo"
              className="w-[7.5rem] shrink-0"
              value={form.scheduled_time}
              disabled={!form.scheduled_date}
              onChange={(e) => onChange({ scheduled_time: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Asignada a</Label>
          <Select
            value={form.assigned_to || NO_ASSIGNEE}
            onValueChange={(v) => onChange({ assigned_to: v === NO_ASSIGNEE ? "" : v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Sin asignar" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_ASSIGNEE}>Sin asignar</SelectItem>
              {profiles.map((p) => (
                <SelectItem key={p.user_id} value={p.user_id}>
                  {p.full_name || p.email || "Usuario"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Dirección / lugar</Label>
        <Input
          value={form.location}
          onChange={(e) => onChange({ location: e.target.value })}
          placeholder="Ej. Quinto Tribunal Laboral, Av. … (opcional)"
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Notas internas</Label>
        <Textarea
          rows={2}
          value={form.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Qué llevar, con quién hablar, pendientes… (el cliente no las ve)"
        />
      </div>
    </div>
  );
}

function EntriesPanel({ lawsuit }: { lawsuit: LawsuitRow }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: profiles } = useProfiles();
  const profileList = (profiles ?? []) as ProfileOption[];
  const [form, setForm] = useState<EntryForm>(emptyEntryForm);
  const [editing, setEditing] = useState<{ id: string; form: EntryForm } | null>(null);
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

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey });
    queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
  };

  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("project_lawsuit_entries").insert({
        ...formToRow(form),
        lawsuit_id: lawsuit.id,
        organization_id: lawsuit.organization_id,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refresh();
      setForm(emptyEntryForm());
    },
    onError: (e: Error) => toast.error("No se pudo guardar la actuación: " + e.message),
  });

  const update = useMutation({
    mutationFn: async (v: { id: string; patch: Database["public"]["Tables"]["project_lawsuit_entries"]["Update"] }) => {
      const { error } = await supabase.from("project_lawsuit_entries").update(v.patch).eq("id", v.id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error("No se pudo actualizar: " + e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("project_lawsuit_entries").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
    onError: (e: Error) => toast.error("No se pudo eliminar: " + e.message),
  });

  const nameOf = (uid: string | null) => profileList.find((p) => p.user_id === uid)?.full_name ?? null;
  const canSubmit = (f: EntryForm) => !!f.content.trim() && !!f.entry_date;

  const saveEdit = () => {
    if (!editing) return;
    update.mutate({ id: editing.id, patch: formToRow(editing.form) }, { onSuccess: () => setEditing(null) });
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border p-3">
        <EntryFormFields form={form} onChange={(p) => setForm((f) => ({ ...f, ...p }))} profiles={profileList} />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={form.client_visible}
              onCheckedChange={(v) => setForm((f) => ({ ...f, client_visible: v === true }))}
            />
            Visible para el cliente
          </label>
          <Button
            size="sm"
            className="ml-auto"
            onClick={() => add.mutate()}
            disabled={!canSubmit(form) || add.isPending}
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
          {entries.map((e) => {
            const scheduled = formatScheduledAt(e.scheduled_date, e.scheduled_time);
            const overdue = !!e.scheduled_date && !e.completed_at && e.scheduled_date < toDateStringMX();
            const typeName = entryTypeLabel(e.entry_type);
            return (
              <li key={e.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground mb-1">
                  <span className="font-medium text-foreground">{formatDateMX(e.entry_date)}</span>
                  {typeName && (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-normal">
                      {typeName}
                    </Badge>
                  )}
                  {nameOf(e.created_by) && <span>· {nameOf(e.created_by)}</span>}
                  <button
                    type="button"
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${
                      e.client_visible
                        ? "bg-blue-500/10 text-blue-700 border-blue-500/30"
                        : "text-muted-foreground hover:bg-secondary/40"
                    }`}
                    title={e.client_visible ? "Quitar de lo que ve el cliente" : "Mostrar al cliente"}
                    onClick={() => update.mutate({ id: e.id, patch: { client_visible: !e.client_visible } })}
                  >
                    {e.client_visible ? "Visible para el cliente" : "Interna"}
                  </button>
                  <div className="ml-auto flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground"
                      title="Editar actuación"
                      onClick={() => setEditing({ id: e.id, form: entryToForm(e) })}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    {e.created_by === user?.id && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 text-muted-foreground"
                        title="Eliminar actuación"
                        onClick={() => remove.mutate(e.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-sm whitespace-pre-wrap">{e.content}</p>

                {(scheduled || e.assigned_to || e.location) && (
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {scheduled && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          {e.completed_at ? "Se llevó a cabo" : "Se llevará a cabo"}:{" "}
                          <span className={`font-medium ${overdue ? "text-destructive" : "text-foreground"}`}>
                            {scheduled}
                          </span>
                        </span>
                        <button
                          type="button"
                          className={`rounded border px-1.5 py-0.5 text-[10px] ${
                            e.completed_at
                              ? "bg-green-500/10 text-green-700 border-green-500/30"
                              : overdue
                                ? "bg-destructive/10 text-destructive border-destructive/30"
                                : "bg-amber-500/10 text-amber-700 border-amber-500/30"
                          }`}
                          title={e.completed_at ? "Marcar como pendiente" : "Marcar como realizada"}
                          onClick={() =>
                            update.mutate({
                              id: e.id,
                              patch: { completed_at: e.completed_at ? null : new Date().toISOString() },
                            })
                          }
                        >
                          {e.completed_at ? (
                            <span className="inline-flex items-center gap-0.5">
                              <Check className="h-2.5 w-2.5" /> Realizada
                            </span>
                          ) : overdue ? (
                            "Vencida · marcar realizada"
                          ) : (
                            "Pendiente · marcar realizada"
                          )}
                        </button>
                      </div>
                    )}
                    {e.assigned_to && (
                      <div className="flex items-center gap-1.5">
                        <UserRound className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          Asignada a{" "}
                          <span className="font-medium text-foreground">{nameOf(e.assigned_to) ?? "usuario"}</span>
                        </span>
                      </div>
                    )}
                    {e.location?.trim() && (
                      <div className="flex items-start gap-1.5">
                        <MapPin className="h-3.5 w-3.5 shrink-0 mt-px" />
                        <a
                          href={mapsSearchUrl(e.location)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground underline-offset-2 hover:underline whitespace-pre-wrap"
                        >
                          {e.location}
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {e.notes?.trim() && (
                  <div className="mt-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
                    <span className="font-medium text-muted-foreground">Notas: </span>
                    <span className="whitespace-pre-wrap">{e.notes}</span>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar actuación</DialogTitle>
            <DialogDescription>Actualiza cuándo se lleva a cabo, a quién se asigna, el lugar o las notas.</DialogDescription>
          </DialogHeader>
          {editing && (
            <>
              <EntryFormFields
                form={editing.form}
                onChange={(p) => setEditing((ed) => (ed ? { ...ed, form: { ...ed.form, ...p } } : ed))}
                profiles={profileList}
              />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Checkbox
                  checked={editing.form.client_visible}
                  onCheckedChange={(v) =>
                    setEditing((ed) => (ed ? { ...ed, form: { ...ed.form, client_visible: v === true } } : ed))
                  }
                />
                Visible para el cliente
              </label>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={update.isPending}>
              Cancelar
            </Button>
            <Button onClick={saveEdit} disabled={!editing || !canSubmit(editing.form) || update.isPending}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
