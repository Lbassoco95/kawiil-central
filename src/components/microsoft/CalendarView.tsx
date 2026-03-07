import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCalendarEvents, useCreateCalendarEvent } from "@/hooks/useMicrosoft";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, parseISO, isSameDay, addMonths, subMonths } from "date-fns";
import { es } from "date-fns/locale";
import { Plus, ChevronLeft, ChevronRight, Clock, Loader2 } from "lucide-react";

export function CalendarView() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [viewMonth, setViewMonth] = useState(new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [newEvent, setNewEvent] = useState({ subject: "", startTime: "09:00", endTime: "10:00" });

  const rangeStart = startOfMonth(subMonths(viewMonth, 1)).toISOString();
  const rangeEnd = endOfMonth(addMonths(viewMonth, 1)).toISOString();

  const { data: events = [], isLoading } = useCalendarEvents(rangeStart, rangeEnd);
  const createEvent = useCreateCalendarEvent();

  const selectedDayEvents = useMemo(() => {
    return events.filter((e: any) => {
      const eventDate = parseISO(e.start?.dateTime || e.start?.date);
      return isSameDay(eventDate, selectedDate);
    });
  }, [events, selectedDate]);

  const eventDates = useMemo(() => {
    return events.map((e: any) => parseISO(e.start?.dateTime || e.start?.date));
  }, [events]);

  const handleCreateEvent = () => {
    if (!newEvent.subject) return;

    const dateStr = format(selectedDate, "yyyy-MM-dd");
    createEvent.mutate(
      {
        subject: newEvent.subject,
        start: { dateTime: `${dateStr}T${newEvent.startTime}:00`, timeZone: "America/Mexico_City" },
        end: { dateTime: `${dateStr}T${newEvent.endTime}:00`, timeZone: "America/Mexico_City" },
      },
      {
        onSuccess: () => {
          setShowCreate(false);
          setNewEvent({ subject: "", startTime: "09:00", endTime: "10:00" });
        },
      }
    );
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Calendar picker */}
      <Card>
        <CardContent className="p-4">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(d) => d && setSelectedDate(d)}
            month={viewMonth}
            onMonthChange={setViewMonth}
            locale={es}
            modifiers={{ hasEvent: eventDates }}
            modifiersClassNames={{ hasEvent: "bg-primary/20 font-bold" }}
          />
        </CardContent>
      </Card>

      {/* Events for selected day */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              {format(selectedDate, "EEEE d 'de' MMMM, yyyy", { locale: es })}
            </CardTitle>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="mr-1 h-4 w-4" /> Nuevo evento
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : selectedDayEvents.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">Sin eventos para este día</p>
          ) : (
            <div className="space-y-2">
              {selectedDayEvents.map((event: any) => {
                const startTime = event.start?.dateTime
                  ? format(parseISO(event.start.dateTime), "HH:mm")
                  : "Todo el día";
                const endTime = event.end?.dateTime
                  ? format(parseISO(event.end.dateTime), "HH:mm")
                  : "";

                return (
                  <div
                    key={event.id}
                    className="flex items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 pt-0.5">
                      <Clock className="h-3 w-3" />
                      {startTime}{endTime ? ` - ${endTime}` : ""}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{event.subject}</p>
                      {event.location?.displayName && (
                        <p className="text-xs text-muted-foreground">{event.location.displayName}</p>
                      )}
                      {event.organizer?.emailAddress?.name && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Organizador: {event.organizer.emailAddress.name}
                        </p>
                      )}
                    </div>
                    {event.isAllDay && <Badge variant="secondary" className="text-xs">Todo el día</Badge>}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create event dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo evento – {format(selectedDate, "d MMM yyyy", { locale: es })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Asunto</Label>
              <Input
                value={newEvent.subject}
                onChange={(e) => setNewEvent({ ...newEvent, subject: e.target.value })}
                placeholder="Nombre del evento..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Hora inicio</Label>
                <Input
                  type="time"
                  value={newEvent.startTime}
                  onChange={(e) => setNewEvent({ ...newEvent, startTime: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Hora fin</Label>
                <Input
                  type="time"
                  value={newEvent.endTime}
                  onChange={(e) => setNewEvent({ ...newEvent, endTime: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button onClick={handleCreateEvent} disabled={createEvent.isPending || !newEvent.subject}>
              {createEvent.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Crear evento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
