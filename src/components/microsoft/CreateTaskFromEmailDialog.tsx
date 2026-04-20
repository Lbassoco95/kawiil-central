import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCreateTask } from "@/hooks/useTasks";
import { useClients } from "@/hooks/useClients";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useCurrentProfile } from "@/hooks/useCurrentProfile";
import { Loader2, Sparkles, Wand2, X, Check, Info } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { KAWIIL_AI_HEADER_BG } from "@/lib/kawiilAi";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  emailSubject?: string;
  senderName?: string;
  senderEmail?: string;
  bodyPreview?: string;
  /** Cuerpo completo (texto o HTML) — se usa para mejor sugerencia IA. */
  bodyText?: string;
  bodyHtml?: string;
  receivedDate?: string;
  /** ISO original (para enviar al edge). */
  receivedAtISO?: string;
  /** Resumen IA si ya está disponible. */
  aiSummary?: string | null;
  aiSuggestedAction?: string | null;
}

const UNASSIGNED_VALUE = "__unassigned__";
const NO_CLIENT_VALUE = "__none__";

type Suggestion = {
  title: string;
  description: string;
  priority: "baja" | "media" | "alta" | "urgente";
  dueHint: string | null;
  dueDate: string | null;
  reasoning: string;
};

export function CreateTaskFromEmailDialog({
  open,
  onOpenChange,
  emailSubject,
  senderName,
  senderEmail,
  bodyPreview,
  bodyText,
  bodyHtml,
  receivedDate,
  receivedAtISO,
  aiSummary,
  aiSuggestedAction,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("media");
  const [assignedTo, setAssignedTo] = useState(UNASSIGNED_VALUE);
  const [clientId, setClientId] = useState(NO_CLIENT_VALUE);
  const [dueDate, setDueDate] = useState<string>("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<Suggestion | null>(null);
  const [aiApplied, setAiApplied] = useState(false);

  const createTask = useCreateTask();
  const { data: clients } = useClients();
  const { data: users } = useOrgUsers();
  const { data: currentProfile } = useCurrentProfile();

  const fallbackDescription = useMemo(() => {
    const parts: string[] = [];
    if (senderName || senderEmail) parts.push(`De: ${senderName || ""} <${senderEmail || ""}>`);
    if (receivedDate) parts.push(`Fecha: ${receivedDate}`);
    if (bodyPreview) parts.push(`\n${bodyPreview.substring(0, 500)}`);
    return parts.join("\n");
  }, [senderName, senderEmail, receivedDate, bodyPreview]);

  // Resetea el form al abrir
  useEffect(() => {
    if (open) {
      setTitle(`[Correo] ${emailSubject || "(sin asunto)"}`);
      setDescription(fallbackDescription);
      setPriority("media");
      setAssignedTo(UNASSIGNED_VALUE);
      setClientId(NO_CLIENT_VALUE);
      setDueDate("");
      setAiSuggestion(null);
      setAiError(null);
      setAiApplied(false);
    }
  }, [open, emailSubject, fallbackDescription]);

  const runSuggest = useCallback(async () => {
    if (aiBusy) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const userName = (currentProfile as { full_name?: string } | undefined)?.full_name;
      const { data, error } = await supabase.functions.invoke<{
        suggestion?: Suggestion;
        error?: string;
        message?: string;
      }>("email-ai-task-suggest", {
        body: {
          subject: emailSubject ?? "",
          senderName: senderName ?? "",
          senderEmail: senderEmail ?? "",
          bodyText: bodyText ?? "",
          bodyHtml: bodyHtml ?? "",
          aiSummary: aiSummary ?? "",
          aiSuggestedAction: aiSuggestedAction ?? "",
          receivedAt: receivedAtISO ?? "",
          locale: "es",
          userName: userName ?? "",
        },
      });
      if (error) throw new Error(error.message || "Error invocando IA");
      const s = data?.suggestion;
      if (!s) throw new Error(data?.message || "Sin sugerencia disponible");
      setAiSuggestion(s);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setAiBusy(false);
    }
  }, [
    aiBusy,
    currentProfile,
    emailSubject,
    senderName,
    senderEmail,
    bodyText,
    bodyHtml,
    aiSummary,
    aiSuggestedAction,
    receivedAtISO,
  ]);

  const applySuggestion = useCallback(() => {
    if (!aiSuggestion) return;
    setTitle(aiSuggestion.title);
    if (aiSuggestion.description) setDescription(aiSuggestion.description);
    setPriority(aiSuggestion.priority);
    if (aiSuggestion.dueDate) setDueDate(aiSuggestion.dueDate);
    setAiApplied(true);
  }, [aiSuggestion]);

  const handleCreate = () => {
    if (!title.trim()) return;
    createTask.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        due_date: dueDate || undefined,
        assigned_to: assignedTo === UNASSIGNED_VALUE ? undefined : assignedTo,
        client_id: clientId === NO_CLIENT_VALUE ? undefined : clientId,
      },
      {
        onSuccess: () => {
          toast.success("Tarea creada desde correo");
          onOpenChange(false);
        },
        onError: () => toast.error("Error al crear la tarea"),
      },
    );
  };

  const priorityChipClass = (p: Suggestion["priority"]) => {
    switch (p) {
      case "urgente":
        return "bg-red-100 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/40";
      case "alta":
        return "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900/40";
      case "baja":
        return "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/40";
      default:
        return "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/40";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0 rounded-2xl border-sky-200/50 dark:border-sky-900/40 [&>button.absolute]:hidden">
        <DialogHeader
          className="shrink-0 px-5 py-3 text-left text-white"
          style={{ background: KAWIIL_AI_HEADER_BG }}
        >
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-white">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/15">
                <Sparkles className="h-3.5 w-3.5" />
              </span>
              Crear tarea desde correo
            </DialogTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md p-1.5 text-white/80 transition-colors hover:bg-white/15 hover:text-white"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="text-[11px] text-white/85">
            Kawiil AI puede prellenar los campos a partir del contenido del correo.
          </p>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          {/* Banner sugerencia IA */}
          {aiSuggestion && (
            <div
              className={cn(
                "rounded-xl border p-3 shadow-sm",
                "border-sky-200/70 bg-gradient-to-br from-sky-50 to-blue-50",
                "dark:border-sky-900/40 dark:from-sky-950/30 dark:to-blue-950/20",
              )}
            >
              <div className="flex items-start gap-2">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blue-600 text-white">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-[11.5px] font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                      Sugerencia de Kawiil AI
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
                          priorityChipClass(aiSuggestion.priority),
                        )}
                      >
                        {aiSuggestion.priority}
                      </span>
                      {aiSuggestion.dueHint ? (
                        <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-100 px-2 py-0.5 text-[10.5px] font-medium text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-300">
                          {aiSuggestion.dueHint}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <p className="text-sm font-medium text-foreground line-clamp-2">
                    {aiSuggestion.title}
                  </p>
                  {aiSuggestion.reasoning ? (
                    <p className="inline-flex items-start gap-1 text-[11.5px] text-muted-foreground">
                      <Info className="mt-[1px] h-3 w-3 shrink-0" />
                      {aiSuggestion.reasoning}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2 pt-1.5">
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 gap-1.5 text-white shadow-sm hover:opacity-90"
                      style={{ background: KAWIIL_AI_HEADER_BG }}
                      onClick={applySuggestion}
                      disabled={aiApplied}
                    >
                      {aiApplied ? <Check className="h-3.5 w-3.5" /> : <Wand2 className="h-3.5 w-3.5" />}
                      {aiApplied ? "Aplicado" : "Usar sugerencia"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1.5 text-blue-700 border-blue-200 hover:bg-blue-50 dark:text-blue-300 dark:border-blue-900/40 dark:hover:bg-blue-950/30"
                      onClick={() => void runSuggest()}
                      disabled={aiBusy}
                    >
                      {aiBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                      Regenerar
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* CTA inicial */}
          {!aiSuggestion && (
            <div className="flex items-center justify-between gap-2 rounded-xl border border-dashed border-sky-200 bg-sky-50/40 px-3 py-2.5 dark:border-sky-900/40 dark:bg-sky-950/20">
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                <div>
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">
                    Prefill con Kawiil AI
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    Genera título, descripción, prioridad y fecha sugerida desde el correo.
                  </p>
                </div>
              </div>
              <Button
                type="button"
                size="sm"
                className="shrink-0 gap-1.5 text-white shadow-sm hover:opacity-90 disabled:opacity-60"
                style={{ background: KAWIIL_AI_HEADER_BG }}
                onClick={() => void runSuggest()}
                disabled={aiBusy}
              >
                {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Sugerir con IA
              </Button>
            </div>
          )}

          {aiError && (
            <p className="text-[11.5px] text-destructive">{aiError}</p>
          )}

          <div className="space-y-1">
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Descripción</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Prioridad</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baja">Baja</SelectItem>
                  <SelectItem value="media">Media</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="urgente">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Fecha límite</Label>
              <Input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Asignar a</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED_VALUE}>Sin asignar</SelectItem>
                  {users
                    ?.filter((u) => u.is_active)
                    .map((u) => (
                      <SelectItem key={u.user_id} value={u.user_id}>
                        {u.full_name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Cliente (opcional)</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin cliente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_CLIENT_VALUE}>Sin cliente</SelectItem>
                  {clients?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter className="border-t border-border/60 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={createTask.isPending || !title.trim()}
            className="gap-1.5 text-white shadow-sm hover:opacity-90 disabled:opacity-60"
            style={{ background: KAWIIL_AI_HEADER_BG }}
          >
            {createTask.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Crear tarea
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
