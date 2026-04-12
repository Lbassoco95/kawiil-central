import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReminderCreateInput, ReminderRepeatKind } from "@/hooks/useReminders";

const REPEAT_OPTIONS: { value: ReminderRepeatKind; label: string; hint: string }[] = [
  {
    value: "none",
    label: "Solo en mi lista",
    hint: "No entra en avisos automáticos de resumen; lo ves aquí cuando abras la app.",
  },
  {
    value: "hourly_digest",
    label: "Resumen cada hora",
    hint: "Si activaste «Avisarme cada hora…» arriba, este ítem puede aparecer en ese aviso.",
  },
  {
    value: "daily_digest",
    label: "Aviso una vez al día",
    hint: "Incluido en el resumen diario (corre junto al digest de tareas por la mañana).",
  },
];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ReminderCreateInput) => void;
  isPending: boolean;
};

export function ReminderCreateDialog({ open, onOpenChange, onSubmit, isPending }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueTime, setDueTime] = useState("");
  const [repeatKind, setRepeatKind] = useState<ReminderRepeatKind>("hourly_digest");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setDueDate("");
    setDueTime("");
    setRepeatKind("hourly_digest");
  }, [open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    onSubmit({
      title: t,
      description: description.trim() || null,
      due_date: dueDate.trim() || null,
      due_time: dueTime.trim() || null,
      repeat_kind: repeatKind,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[min(90vh,640px)] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Nuevo recordatorio</DialogTitle>
            <DialogDescription>
              Título obligatorio. Puedes añadir fecha límite, hora y cómo quieres que te avisen.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="rem-title">Título</Label>
              <Input
                id="rem-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ej. Enviar declaración al cliente"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="rem-desc">Detalle o contexto (opcional)</Label>
              <Textarea
                id="rem-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Notas, enlace en texto, responsable…"
                rows={3}
                className="resize-y min-h-[72px]"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="rem-due">Fecha límite (opcional)</Label>
                <Input id="rem-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="rem-time">Hora límite (opcional)</Label>
                <Input id="rem-time" type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>¿Cada cuánto avisarte?</Label>
              <Select
                value={repeatKind}
                onValueChange={(v) => setRepeatKind(v as ReminderRepeatKind)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPEAT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value!}>
                      <span className="font-medium">{o.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground leading-snug">
                {REPEAT_OPTIONS.find((o) => o.value === repeatKind)?.hint}
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || !title.trim()}>
              {isPending ? "Guardando…" : "Guardar recordatorio"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
