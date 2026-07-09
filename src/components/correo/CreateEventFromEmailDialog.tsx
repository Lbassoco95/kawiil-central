import { useState, useEffect, useMemo } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon, Loader2, X } from "lucide-react";
import { format, addDays } from "date-fns";
import { es } from "date-fns/locale";
import { useCreateCalendarEvent } from "@/hooks/useMicrosoft";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Recipient {
  email: string;
  name?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  emailSubject?: string;
  emailFrom?: Recipient | null;
  emailTo?: Recipient[];
  emailCc?: Recipient[];
  myEmail?: string;
}

function stripEmailPrefix(subject: string): string {
  return subject.replace(/^(re|rv|fw|fwd|reenviado|reenv):\s*/gi, "").trim();
}

export function CreateEventFromEmailDialog({
  open, onOpenChange,
  emailSubject, emailFrom, emailTo, emailCc, myEmail,
}: Props) {
  const createEvent = useCreateCalendarEvent();

  const [subject, setSubject] = useState("");
  const [date, setDate] = useState<Date>(addDays(new Date(), 1));
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [isOnlineMeeting, setIsOnlineMeeting] = useState(false);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [attendees, setAttendees] = useState<Recipient[]>([]);
  const [attendeeInput, setAttendeeInput] = useState("");
  const [dateOpen, setDateOpen] = useState(false);

  const initialAttendees = useMemo(() => {
    const all: Recipient[] = [];
    const seen = new Set<string>();
    const add = (r: Recipient) => {
      const e = r.email?.trim().toLowerCase();
      if (e && !seen.has(e) && e !== myEmail?.toLowerCase()) {
        seen.add(e);
        all.push(r);
      }
    };
    if (emailFrom) add(emailFrom);
    (emailTo ?? []).forEach(add);
    (emailCc ?? []).forEach(add);
    return all;
  }, [emailFrom, emailTo, emailCc, myEmail]);

  useEffect(() => {
    if (open) {
      setSubject(emailSubject ? stripEmailPrefix(emailSubject) : "");
      setDate(addDays(new Date(), 1));
      setStartTime("09:00");
      setEndTime("10:00");
      setIsOnlineMeeting(false);
      setLocation("");
      setDescription("");
      setAttendees(initialAttendees);
      setAttendeeInput("");
    }
  }, [open, emailSubject, initialAttendees]);

  const removeAttendee = (email: string) =>
    setAttendees((prev) => prev.filter((a) => a.email !== email));

  const addAttendeeFromInput = () => {
    const emails = attendeeInput.split(/[,;\s]+/).map((e) => e.trim()).filter(Boolean);
    setAttendees((prev) => {
      const seen = new Set(prev.map((a) => a.email.toLowerCase()));
      const toAdd = emails.filter((e) => !seen.has(e.toLowerCase())).map((e) => ({ email: e }));
      return [...prev, ...toAdd];
    });
    setAttendeeInput("");
  };

  const handleCreate = () => {
    if (!subject.trim()) { toast.error("Escribe el asunto del evento"); return; }
    const tz = "America/Mexico_City";
    const dateStr = format(date, "yyyy-MM-dd");
    createEvent.mutate(
      {
        subject: subject.trim(),
        start: { dateTime: `${dateStr}T${startTime}:00`, timeZone: tz },
        end: { dateTime: `${dateStr}T${endTime}:00`, timeZone: tz },
        isOnlineMeeting,
        onlineMeetingProvider: isOnlineMeeting ? "teamsForBusiness" : undefined,
        location: location.trim() ? { displayName: location.trim() } : undefined,
        body: description.trim()
          ? { contentType: "text", content: description.trim() }
          : undefined,
        attendees: attendees
          .filter((a) => a.email)
          .map((a) => ({ emailAddress: { address: a.email, name: a.name || a.email } })),
      },
      {
        onSuccess: () => {
          toast.success("Evento creado en tu calendario de Outlook");
          onOpenChange(false);
        },
        onError: (e) => {
          toast.error(e instanceof Error ? e.message : "No se pudo crear el evento");
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[15px]">
            <CalendarIcon className="w-4 h-4 text-primary" />
            Crear evento desde correo
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Asunto */}
          <div className="space-y-1.5">
            <Label className="text-[12px]">Asunto</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Nombre del evento…"
              className="text-[13px]"
            />
          </div>

          {/* Fecha */}
          <div className="space-y-1.5">
            <Label className="text-[12px]">Fecha</Label>
            <Popover open={dateOpen} onOpenChange={setDateOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal text-[13px]",
                    !date && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-3.5 w-3.5" />
                  {format(date, "EEEE d 'de' MMMM, yyyy", { locale: es })}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => { if (d) { setDate(d); setDateOpen(false); } }}
                  initialFocus
                  locale={es}
                />
              </PopoverContent>
            </Popover>
          </div>

          {/* Hora */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px]">Hora inicio (CDMX)</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="text-[13px]" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px]">Hora fin (CDMX)</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="text-[13px]" />
            </div>
          </div>

          {/* Asistentes */}
          <div className="space-y-1.5">
            <Label className="text-[12px]">Asistentes</Label>
            {attendees.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {attendees.map((a) => (
                  <span
                    key={a.email}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11.5px] font-medium"
                  >
                    {a.name && a.name !== a.email ? a.name : a.email}
                    <button
                      type="button"
                      onClick={() => removeAttendee(a.email)}
                      className="hover:text-destructive transition-colors"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={attendeeInput}
                onChange={(e) => setAttendeeInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addAttendeeFromInput(); } }}
                placeholder="correo@ejemplo.com y Enter para agregar…"
                className="text-[12.5px]"
              />
              <Button type="button" variant="outline" size="sm" onClick={addAttendeeFromInput} className="shrink-0 text-[12px]">
                Agregar
              </Button>
            </div>
          </div>

          {/* Reunión de Teams */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] font-medium">Reunión de Teams</p>
              <p className="text-[11px] text-muted-foreground">Outlook generará el enlace automáticamente</p>
            </div>
            <Switch checked={isOnlineMeeting} onCheckedChange={setIsOnlineMeeting} />
          </div>

          {/* Ubicación */}
          {!isOnlineMeeting && (
            <div className="space-y-1.5">
              <Label className="text-[12px]">Ubicación</Label>
              <Input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Oficina, sala, dirección…"
                className="text-[13px]"
              />
            </div>
          )}

          {/* Descripción */}
          <div className="space-y-1.5">
            <Label className="text-[12px]">Notas / agenda</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Agenda, contexto, instrucciones…"
              rows={3}
              className="text-[13px] resize-none"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={handleCreate}
            disabled={createEvent.isPending || !subject.trim()}
            className="gap-1.5"
          >
            {createEvent.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CalendarIcon className="w-3.5 h-3.5" />
            )}
            Crear evento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
