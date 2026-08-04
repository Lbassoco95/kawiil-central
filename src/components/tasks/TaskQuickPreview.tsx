import { useState } from "react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { useTaskDetail, useUpdateTask, useAddComment, useProfiles } from "@/hooks/useTasks";
import { useCelulaOptions } from "@/hooks/useCelulaOptions";
import { TASK_STATUS_CONFIG } from "@/lib/statusStyles";
import { formatMX } from "@/lib/dateUtils";
import {
  CheckCircle2,
  XCircle,
  ExternalLink,
  Loader2,
  Send,
  MessageSquare,
} from "lucide-react";

const STATUS_KEYS = ["pendiente", "en_progreso", "en_revision", "completada", "cancelada"] as const;

interface Props {
  taskId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Abrir la tarea completa (recibe la tarea cargada, con project_id). */
  onOpenFull: (task: { id: string; project_id?: string | null; phase_key?: string | null }) => void;
}

/**
 * Previo de tarea: panel lateral para cambios rápidos (estatus, responsable,
 * fecha, comentario) sin abrir el detalle completo. "Abrir tarea completa"
 * sigue a un clic.
 */
export function TaskQuickPreview({ taskId, open, onOpenChange, onOpenFull }: Props) {
  const { task, isLoading, comments } = useTaskDetail(taskId ?? undefined);
  const updateTask = useUpdateTask();
  const addComment = useAddComment();
  const { data: profiles = [] } = useProfiles();
  const { celulaOptions } = useCelulaOptions();
  const [comment, setComment] = useState("");

  const setField = (updates: Record<string, unknown>) => {
    if (taskId) updateTask.mutate({ id: taskId, ...updates });
  };

  const submitComment = () => {
    const content = comment.trim();
    if (!content || !taskId) return;
    addComment.mutate(
      { taskId, content },
      { onSuccess: () => setComment("") },
    );
  };

  const status = task?.status ?? "pendiente";
  const isClosed = status === "completada" || status === "cancelada";
  const dueValue = task?.due_date ? String(task.due_date).slice(0, 10) : "";
  const clientName = (task as any)?.clients?.name as string | undefined;
  const projectName = (task as any)?.projects?.name as string | undefined;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-md p-0 flex flex-col gap-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {isLoading || !task ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : (
          <>
            {/* Header — pr para no chocar con la X de cerrar */}
            <div className="border-b px-5 py-4 pr-12">
              <div className="text-[11px] text-muted-foreground truncate">
                {clientName ? clientName : "Interno"}
                {projectName ? ` · ${projectName}` : ""}
              </div>
              <h2 className="mt-1 text-base font-semibold leading-snug text-foreground">
                {task.title}
              </h2>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {/* Acciones rápidas */}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="flex-1 gap-1.5"
                  disabled={status === "completada" || updateTask.isPending}
                  onClick={() => setField({ status: "completada" })}
                >
                  <CheckCircle2 className="h-4 w-4" /> Completar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 gap-1.5 text-destructive hover:text-destructive"
                  disabled={status === "cancelada" || updateTask.isPending}
                  onClick={() => setField({ status: "cancelada" })}
                >
                  <XCircle className="h-4 w-4" /> Cancelar
                </Button>
              </div>

              {/* Estatus */}
              <div className="space-y-1.5">
                <Label className="text-xs">Estatus</Label>
                <Select value={status} onValueChange={(v) => setField({ status: v })}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_KEYS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {TASK_STATUS_CONFIG[k].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Responsable */}
              <div className="space-y-1.5">
                <Label className="text-xs">Responsable</Label>
                <Select
                  value={task.assigned_to ?? "none"}
                  onValueChange={(v) => setField({ assigned_to: v === "none" ? null : v })}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Sin asignar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin asignar</SelectItem>
                    {profiles.map((p) => (
                      <SelectItem key={p.user_id} value={p.user_id}>
                        <span className="inline-flex items-center gap-2">
                          <UserAvatar name={p.full_name} avatarUrl={p.avatar_url} userId={p.user_id} size="xs" />
                          {p.full_name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Fecha y célula */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Fecha límite</Label>
                  <Input
                    type="date"
                    value={dueValue}
                    onChange={(e) => setField({ due_date: e.target.value || null })}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Célula</Label>
                  <Select
                    value={task.area ?? "none"}
                    onValueChange={(v) => setField({ area: v === "none" ? null : v })}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {celulaOptions.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {isClosed && (
                <p className="text-[11px] text-muted-foreground">
                  Esta tarea está {TASK_STATUS_CONFIG[status].label.toLowerCase()}.
                </p>
              )}

              {/* Comentario rápido */}
              <div className="space-y-1.5">
                <Label className="text-xs flex items-center gap-1.5">
                  <MessageSquare className="h-3.5 w-3.5" /> Comentario
                  {comments.length > 0 && (
                    <span className="text-muted-foreground">({comments.length})</span>
                  )}
                </Label>
                <Textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitComment();
                  }}
                  rows={3}
                  className="resize-none text-sm"
                  placeholder="Agregar un comentario…"
                />
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={!comment.trim() || addComment.isPending}
                    onClick={submitComment}
                  >
                    {addComment.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    Enviar
                  </Button>
                </div>
                {comments.length > 0 && (
                  <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                    {comments.slice(0, 5).map((c: any) => (
                      <div key={c.id} className="rounded-md bg-muted/40 px-2.5 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-medium text-foreground truncate">
                            {c.profile?.full_name ?? "Usuario"}
                          </span>
                          {c.created_at && (
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {formatMX(c.created_at, "dd MMM")}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-foreground/80 whitespace-pre-wrap break-words">
                          {c.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="border-t px-5 py-3">
              <Button
                variant="outline"
                className="w-full gap-1.5"
                onClick={() => {
                  if (task) {
                    onOpenFull({
                      id: task.id,
                      project_id: (task as any).project_id ?? null,
                      phase_key: (task as any).phase_key ?? null,
                    });
                  }
                }}
              >
                <ExternalLink className="h-4 w-4" /> Abrir tarea completa
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
