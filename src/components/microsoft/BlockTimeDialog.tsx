import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCreateCalendarEvent, useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { Loader2, Calendar } from "lucide-react";
import { format } from "date-fns";

interface BlockTimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  taskDueDate?: string;
}

export function BlockTimeDialog({ open, onOpenChange, taskTitle, taskDueDate }: BlockTimeDialogProps) {
  const { isConnected } = useMicrosoftConnection();
  const createEvent = useCreateCalendarEvent();

  const defaultDate = taskDueDate || format(new Date(), "yyyy-MM-dd");
  const [eventData, setEventData] = useState({
    date: defaultDate,
    startTime: "09:00",
    endTime: "10:00",
    notes: "",
  });

  const handleBlock = () => {
    createEvent.mutate(
      {
        subject: `🔒 ${taskTitle}`,
        start: {
          dateTime: `${eventData.date}T${eventData.startTime}:00`,
          timeZone: "America/Mexico_City",
        },
        end: {
          dateTime: `${eventData.date}T${eventData.endTime}:00`,
          timeZone: "America/Mexico_City",
        },
        body: eventData.notes
          ? { contentType: "text", content: eventData.notes }
          : undefined,
      },
      { onSuccess: () => onOpenChange(false) }
    );
  };

  if (!isConnected) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bloquear tiempo en Outlook</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-4">
            Necesitas conectar tu cuenta de Microsoft 365 primero. Ve a la sección Microsoft 365 en el menú lateral.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cerrar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Bloquear tiempo en Outlook
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="p-3 rounded-md bg-muted">
            <p className="text-sm font-medium">🔒 {taskTitle}</p>
          </div>
          <div className="space-y-2">
            <Label>Fecha</Label>
            <Input
              type="date"
              value={eventData.date}
              onChange={(e) => setEventData({ ...eventData, date: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Hora inicio</Label>
              <Input
                type="time"
                value={eventData.startTime}
                onChange={(e) => setEventData({ ...eventData, startTime: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Hora fin</Label>
              <Input
                type="time"
                value={eventData.endTime}
                onChange={(e) => setEventData({ ...eventData, endTime: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Notas (opcional)</Label>
            <Textarea
              value={eventData.notes}
              onChange={(e) => setEventData({ ...eventData, notes: e.target.value })}
              placeholder="Notas adicionales para el evento..."
              rows={2}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleBlock} disabled={createEvent.isPending}>
            {createEvent.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Bloquear horario
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
