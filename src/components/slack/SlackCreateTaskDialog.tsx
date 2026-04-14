import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useCreateTask, useProfiles } from "@/hooks/useTasks";
import type { SlackMessage } from "@/lib/slackApi";
import { toast } from "sonner";

const UNASSIGNED_VALUE = "__unassigned__";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  message: SlackMessage | null;
  channelId: string;
  channelTitle: string;
  authorLabel: string;
};

function compactSlackText(input: string | undefined): string {
  const raw = (input || "").trim();
  if (!raw) return "";
  return raw.replace(/\s+/g, " ").replace(/<@([A-Z0-9]+)>/g, "@$1");
}

function messageSeedTitle(message: SlackMessage | null): string {
  const base = compactSlackText(message?.text);
  if (!base) return "Tarea desde Slack";
  const clipped = base.length > 90 ? `${base.slice(0, 87)}...` : base;
  return `[Slack] ${clipped}`;
}

export function SlackCreateTaskDialog({
  open,
  onOpenChange,
  message,
  channelId,
  channelTitle,
  authorLabel,
}: Props) {
  const createTask = useCreateTask();
  const { data: profiles = [] } = useProfiles();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("media");
  const [assignedTo, setAssignedTo] = useState(UNASSIGNED_VALUE);
  const [dueDate, setDueDate] = useState("");

  const messageLink = useMemo(() => {
    if (!message?.ts) return "";
    if (typeof window === "undefined") return `/comunicacion?channel=${channelId}&ts=${message.ts}`;
    const url = new URL("/comunicacion", window.location.origin);
    url.searchParams.set("channel", channelId);
    url.searchParams.set("ts", message.ts);
    return url.toString();
  }, [channelId, message?.ts]);

  useEffect(() => {
    if (!open || !message) return;
    setTitle(messageSeedTitle(message));
    const parts = [
      `Origen: Slack · ${channelTitle || channelId}`,
      `Autor: ${authorLabel || message.user || "desconocido"}`,
      message.ts ? `Timestamp: ${message.ts}` : "",
      messageLink ? `Mensaje: ${messageLink}` : "",
      "",
      compactSlackText(message.text),
    ].filter(Boolean);
    setDescription(parts.join("\n"));
    setPriority("media");
    setAssignedTo(UNASSIGNED_VALUE);
    setDueDate("");
  }, [open, message, channelTitle, channelId, authorLabel, messageLink]);

  const handleCreate = () => {
    if (!title.trim()) return;
    createTask.mutate(
      {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        due_date: dueDate || undefined,
        assigned_to: assignedTo === UNASSIGNED_VALUE ? undefined : assignedTo,
      },
      {
        onSuccess: () => {
          toast.success("Tarea creada desde Slack");
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Crear tarea desde mensaje de Slack</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Título</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título de la tarea" />
          </div>
          <div className="space-y-1">
            <Label>Descripción</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={7}
              placeholder="Contexto del mensaje de Slack"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
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
            <div className="space-y-1 col-span-2">
              <Label>Asignar a</Label>
              <Select value={assignedTo} onValueChange={setAssignedTo}>
                <SelectTrigger>
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED_VALUE}>Sin asignar</SelectItem>
                  {profiles.map((p) => (
                    <SelectItem key={p.user_id} value={p.user_id}>
                      {p.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Fecha límite (opcional)</Label>
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={createTask.isPending || !title.trim()}>
            {createTask.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Crear tarea
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
