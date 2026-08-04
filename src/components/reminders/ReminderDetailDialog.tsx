import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { AtSign, Loader2, Trash2, UserPlus } from "lucide-react";
import { formatDateMX } from "@/lib/dateUtils";
import type { OrgUser } from "@/hooks/useOrgUsers";
import type { Reminder, ReminderRepeatKind, ReminderUpdateInput } from "@/hooks/useReminders";

const REPEAT_OPTIONS: { value: ReminderRepeatKind; label: string }[] = [
  { value: "none", label: "Solo en mi lista" },
  { value: "hourly_digest", label: "Resumen cada hora" },
  { value: "daily_digest", label: "Aviso una vez al día" },
];

function repeatLabel(rk: ReminderRepeatKind | undefined) {
  return REPEAT_OPTIONS.find((o) => o.value === (rk ?? "hourly_digest"))?.label ?? "Resumen cada hora";
}

type Props = {
  reminder: Reminder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgUsers: OrgUser[];
  currentUserId: string | undefined;
  onSave: (input: ReminderUpdateInput) => Promise<void> | void;
  isSaving: boolean;
  onToggleComplete: (id: string, is_completed: boolean) => void;
  onAddCollaborator: (userId: string) => Promise<void> | void;
  onRemoveCollaborator: (userId: string) => Promise<void> | void;
  isMutatingCollaborators: boolean;
};

export function ReminderDetailDialog({
  reminder,
  open,
  onOpenChange,
  orgUsers,
  currentUserId,
  onSave,
  isSaving,
  onToggleComplete,
  onAddCollaborator,
  onRemoveCollaborator,
  isMutatingCollaborators,
}: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [repeatKind, setRepeatKind] = useState<ReminderRepeatKind>("hourly_digest");
  const [inviteUserId, setInviteUserId] = useState("");

  const canEdit = !!reminder; // dueño y colaboradores pueden editar (RLS lo permite)
  const isOwner = !!reminder && reminder.user_id === currentUserId;

  useEffect(() => {
    if (!reminder) return;
    setTitle(reminder.title ?? "");
    setDescription(reminder.description ?? "");
    setDueDate(reminder.due_date ?? "");
    setDueTime(reminder.due_time ? reminder.due_time.slice(0, 5) : "");
    setRepeatKind(reminder.repeat_kind ?? "hourly_digest");
    setInviteUserId("");
  }, [reminder]);

  const nameByUserId = useMemo(() => {
    const m = new Map<string, OrgUser>();
    orgUsers.forEach((u) => m.set(u.user_id, u));
    return m;
  }, [orgUsers]);

  const collaboratorUserIds = useMemo(
    () => new Set((reminder?.collaborators ?? []).map((c) => c.user_id)),
    [reminder],
  );

  const inviteCandidates = useMemo(
    () =>
      orgUsers.filter(
        (u) =>
          u.user_id !== reminder?.user_id &&
          u.user_id !== currentUserId &&
          !collaboratorUserIds.has(u.user_id),
      ),
    [orgUsers, reminder, currentUserId, collaboratorUserIds],
  );

  if (!reminder) return null;

  const dirty =
    title.trim() !== (reminder.title ?? "") ||
    (description.trim() || "") !== ((reminder.description ?? "").trim() || "") ||
    (dueDate || "") !== (reminder.due_date ?? "") ||
    (dueTime || "") !== (reminder.due_time ? reminder.due_time.slice(0, 5) : "") ||
    repeatKind !== (reminder.repeat_kind ?? "hourly_digest");

  const handleSave = async () => {
    const t = title.trim();
    if (!t) return;
    await onSave({
      id: reminder.id,
      title: t,
      description: description.trim() || null,
      due_date: dueDate.trim() || null,
      due_time: dueTime.trim() || null,
      repeat_kind: repeatKind,
    });
  };

  const handleInvite = async () => {
    if (!inviteUserId) return;
    await onAddCollaborator(inviteUserId);
    setInviteUserId("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[min(92vh,720px)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Recordatorio
            {!isOwner ? (
              <Badge variant="secondary" className="text-[10px] font-normal">
                Compartido contigo
              </Badge>
            ) : null}
            {reminder.is_completed ? (
              <Badge variant="outline" className="text-[10px] font-normal">
                Completado
              </Badge>
            ) : null}
          </DialogTitle>
          <DialogDescription>
            Abre, edita y comparte este recordatorio con quien deba ver el tema.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label htmlFor="rd-title">Título</Label>
            <Input
              id="rd-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="rd-desc">Detalle o contexto</Label>
            <Textarea
              id="rd-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="resize-y min-h-[88px]"
              disabled={!canEdit}
              placeholder="Notas, enlace en texto, responsable…"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="rd-due">Fecha límite</Label>
              <Input
                id="rd-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rd-time">Hora límite</Label>
              <Input
                id="rd-time"
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                disabled={!canEdit}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label>¿Cada cuánto avisar?</Label>
            <Select value={repeatKind} onValueChange={(v) => setRepeatKind(v as ReminderRepeatKind)} disabled={!canEdit}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPEAT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {reminder.due_date ? (
              <p className="text-[11px] text-muted-foreground">
                Vence {formatDateMX(reminder.due_date)} · {repeatLabel(reminder.repeat_kind)}
              </p>
            ) : null}
          </div>

          {/* Colaboradores */}
          <div className="grid gap-2 border-t border-border/50 pt-4">
            <Label className="flex items-center gap-1.5">
              <AtSign className="h-3.5 w-3.5 text-muted-foreground" />
              Colaboradores
            </Label>
            <p className="text-[11px] text-muted-foreground -mt-1">
              Arroba a quien deba ver este tema. También lo verá en su lista y recibirá un aviso.
            </p>

            {isOwner ? (
              <div className="flex flex-col sm:flex-row gap-2">
                <Select value={inviteUserId || undefined} onValueChange={setInviteUserId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Agregar Kawiiler…" />
                  </SelectTrigger>
                  <SelectContent>
                    {inviteCandidates.length === 0 ? (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">Sin más personas por agregar</div>
                    ) : (
                      inviteCandidates.map((u) => (
                        <SelectItem key={u.user_id} value={u.user_id}>
                          {u.full_name || u.email}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <Button size="sm" disabled={!inviteUserId || isMutatingCollaborators} onClick={handleInvite} className="gap-1.5">
                  {isMutatingCollaborators ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  Agregar
                </Button>
              </div>
            ) : null}

            <div className="space-y-1 mt-1">
              {reminder.collaborators.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1">Nadie más por ahora.</p>
              ) : (
                reminder.collaborators.map((c) => {
                  const u = nameByUserId.get(c.user_id);
                  const label = c.full_name || u?.full_name || u?.email || "Kawiiler";
                  return (
                    <div
                      key={c.user_id}
                      className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md hover:bg-secondary/40"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <UserAvatar
                          name={label}
                          email={u?.email}
                          avatarUrl={c.avatar_url ?? u?.avatar_url}
                          userId={c.user_id}
                          size="sm"
                          showTooltip={false}
                        />
                        <span className="text-sm truncate">{label}</span>
                      </div>
                      {isOwner || c.user_id === currentUserId ? (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive p-0.5 shrink-0"
                          onClick={() => onRemoveCollaborator(c.user_id)}
                          disabled={isMutatingCollaborators}
                          title={c.user_id === currentUserId && !isOwner ? "Dejar de seguir" : "Quitar"}
                          aria-label="Quitar colaborador"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onToggleComplete(reminder.id, !reminder.is_completed)}
          >
            {reminder.is_completed ? "Marcar pendiente" : "Marcar completado"}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
            <Button type="button" onClick={handleSave} disabled={!canEdit || isSaving || !title.trim() || !dirty}>
              {isSaving ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
