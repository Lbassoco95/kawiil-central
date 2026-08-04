import { useState } from "react";
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
import { CheckCircle2, XCircle, ExternalLink, Loader2, Send } from "lucide-react";

const STATUS_KEYS = ["pendiente", "en_progreso", "en_revision", "completada", "cancelada"] as const;

interface Props {
  taskId: string;
  /** Abrir la tarea completa (detalle de siempre). */
  onOpenFull: () => void;
}

/**
 * Edición rápida en línea: se muestra al expandir una fila del listado de
 * tareas. Permite cambiar estatus, responsable, fecha, célula, completar/
 * cancelar y comentar sin abrir el detalle completo.
 */
export function TaskInlineQuickEdit({ taskId, onOpenFull }: Props) {
  const { task, isLoading, comments } = useTaskDetail(taskId);
  const updateTask = useUpdateTask();
  const addComment = useAddComment();
  const { data: profiles = [] } = useProfiles();
  const { celulaOptions } = useCelulaOptions();
  const [comment, setComment] = useState("");

  const setField = (updates: Record<string, unknown>) => {
    updateTask.mutate({ id: taskId, ...updates });
  };

  const submitComment = () => {
    const content = comment.trim();
    if (!content) return;
    addComment.mutate({ taskId, content }, { onSuccess: () => setComment("") });
  };

  if (isLoading || !task) {
    return (
      <div className="flex items-center gap-2 border-t border-border/60 bg-muted/20 px-5 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
      </div>
    );
  }

  const status = task.status;
  const dueValue = task.due_date ? String(task.due_date).slice(0, 10) : "";

  return (
    <div
      className="border-t border-border/60 bg-muted/20 px-5 py-4 space-y-3"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Acciones + campos rápidos */}
      <div className="flex flex-wrap items-end gap-3">
        <Button
          size="sm"
          className="h-9 gap-1.5"
          disabled={status === "completada" || updateTask.isPending}
          onClick={() => setField({ status: "completada" })}
        >
          <CheckCircle2 className="h-4 w-4" /> Completar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 gap-1.5 text-destructive hover:text-destructive"
          disabled={status === "cancelada" || updateTask.isPending}
          onClick={() => setField({ status: "cancelada" })}
        >
          <XCircle className="h-4 w-4" /> Cancelar
        </Button>

        <div className="space-y-1 min-w-[150px] flex-1">
          <Label className="text-[11px] text-muted-foreground">Estatus</Label>
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

        <div className="space-y-1 min-w-[170px] flex-1">
          <Label className="text-[11px] text-muted-foreground">Responsable</Label>
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

        <div className="space-y-1 min-w-[140px]">
          <Label className="text-[11px] text-muted-foreground">Fecha límite</Label>
          <Input
            type="date"
            value={dueValue}
            onChange={(e) => setField({ due_date: e.target.value || null })}
            className="h-9"
          />
        </div>

        <div className="space-y-1 min-w-[150px] flex-1">
          <Label className="text-[11px] text-muted-foreground">Célula</Label>
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

      {/* Comentario */}
      <div className="flex items-start gap-2">
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submitComment();
          }}
          rows={2}
          className="resize-none text-sm"
          placeholder={
            comments.length > 0
              ? `Agregar un comentario… (${comments.length} existentes)`
              : "Agregar un comentario…"
          }
        />
        <Button
          size="sm"
          className="h-9 gap-1.5 shrink-0"
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
        <div className="space-y-1.5">
          {comments.slice(-3).map((c: any) => (
            <div key={c.id} className="rounded-md bg-background/70 px-2.5 py-1.5 text-xs">
              <span className="font-medium text-foreground">
                {c.profile?.full_name ?? "Usuario"}
              </span>
              {c.created_at && (
                <span className="ml-2 text-[10px] text-muted-foreground">
                  {formatMX(c.created_at, "dd MMM")}
                </span>
              )}
              <p className="text-foreground/80 whitespace-pre-wrap break-words">{c.content}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={onOpenFull}>
          <ExternalLink className="h-3.5 w-3.5" /> Abrir tarea completa
        </Button>
      </div>
    </div>
  );
}
