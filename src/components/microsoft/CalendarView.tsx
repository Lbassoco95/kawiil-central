import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCalendarEvents, useCreateCalendarEvent, useDeleteCalendarEvent } from "@/hooks/useMicrosoft";
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  parseISO, isSameDay, addMonths, subMonths, addWeeks, subWeeks,
  eachDayOfInterval, getDay, startOfDay, isToday, addDays, isSameMonth,
} from "date-fns";
import { es } from "date-fns/locale";
import { Plus, ChevronLeft, ChevronRight, Clock, Loader2, Trash2 } from "lucide-react";

type ViewMode = "week" | "month";

const HOURS = Array.from({ length: 15 }, (_, i) => i + 7); // 7:00 - 21:00

export function CalendarView() {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [newEvent, setNewEvent] = useState({ subject: "", startTime: "09:00", endTime: "10:00" });

  // Range for fetching events
  const rangeStart = viewMode === "week"
    ? startOfWeek(currentDate, { weekStartsOn: 1 }).toISOString()
    : startOfMonth(subMonths(currentDate, 0)).toISOString();
  const rangeEnd = viewMode === "week"
    ? endOfWeek(currentDate, { weekStartsOn: 1 }).toISOString()
    : endOfMonth(currentDate).toISOString();

  const { data: events = [], isLoading } = useCalendarEvents(rangeStart, rangeEnd);
  const createEvent = useCreateCalendarEvent();
  const deleteEvent = useDeleteCalendarEvent();

  // Navigate
  const goNext = () => {
    if (viewMode === "week") setCurrentDate(addWeeks(currentDate, 1));
    else setCurrentDate(addMonths(currentDate, 1));
  };
  const goPrev = () => {
    if (viewMode === "week") setCurrentDate(subWeeks(currentDate, 1));
    else setCurrentDate(subMonths(currentDate, 1));
  };
  const goToday = () => setCurrentDate(new Date());

  // Events grouped by date
  const eventsByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    events.forEach((e: any) => {
      const dateKey = format(parseISO(e.start?.dateTime || e.start?.date), "yyyy-MM-dd");
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(e);
    });
    return map;
  }, [events]);

  // Week days
  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end: addDays(start, 6) });
  }, [currentDate]);

  // Month days
  const monthDays = useMemo(() => {
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const monthStart = startOfWeek(start, { weekStartsOn: 1 });
    const monthEnd = endOfWeek(end, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: monthStart, end: monthEnd });
  }, [currentDate]);

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

  const getEventsForDay = (date: Date) => {
    const key = format(date, "yyyy-MM-dd");
    return eventsByDate.get(key) || [];
  };

  const headerLabel = viewMode === "week"
    ? `${format(weekDays[0], "d MMM", { locale: es })} – ${format(weekDays[6], "d MMM yyyy", { locale: es })}`
    : format(currentDate, "MMMM yyyy", { locale: es });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>Hoy</Button>
          <Button variant="outline" size="sm" onClick={goNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold capitalize ml-2">{headerLabel}</h2>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList className="h-8">
              <TabsTrigger value="week" className="text-xs px-3 h-7">Semana</TabsTrigger>
              <TabsTrigger value="month" className="text-xs px-3 h-7">Mes</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" onClick={() => { setSelectedDate(new Date()); setShowCreate(true); }}>
            <Plus className="mr-1 h-4 w-4" /> Evento
          </Button>
        </div>
      </div>

      {/* Weekly view */}
      {viewMode === "week" && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <div className="min-w-[700px]">
              {/* Day headers */}
              <div className="grid grid-cols-8 border-b border-border">
                <div className="p-2 text-xs text-muted-foreground text-center border-r border-border">Hora</div>
                {weekDays.map((day) => (
                  <div
                    key={day.toISOString()}
                    className={`p-2 text-center border-r border-border last:border-r-0 cursor-pointer hover:bg-muted/50 transition-colors ${
                      isToday(day) ? "bg-primary/10" : ""
                    }`}
                    onClick={() => { setSelectedDate(day); setShowCreate(true); }}
                  >
                    <div className="text-xs text-muted-foreground capitalize">
                      {format(day, "EEE", { locale: es })}
                    </div>
                    <div className={`text-sm font-medium ${isToday(day) ? "text-primary" : ""}`}>
                      {format(day, "d")}
                    </div>
                  </div>
                ))}
              </div>

              {/* Time grid */}
              {HOURS.map((hour) => (
                <div key={hour} className="grid grid-cols-8 border-b border-border last:border-b-0 min-h-[48px]">
                  <div className="p-1 text-xs text-muted-foreground text-right pr-2 border-r border-border pt-1">
                    {`${hour}:00`}
                  </div>
                  {weekDays.map((day) => {
                    const dayEvents = getEventsForDay(day).filter((e: any) => {
                      if (!e.start?.dateTime) return false;
                      const eventHour = parseISO(e.start.dateTime).getHours();
                      return eventHour === hour;
                    });
                    return (
                      <div
                        key={day.toISOString() + hour}
                        className="border-r border-border last:border-r-0 p-0.5 cursor-pointer hover:bg-muted/30 transition-colors"
                        onClick={() => {
                          setSelectedDate(day);
                          setNewEvent({ ...newEvent, startTime: `${hour.toString().padStart(2, "0")}:00`, endTime: `${(hour + 1).toString().padStart(2, "0")}:00` });
                          setShowCreate(true);
                        }}
                      >
                        {dayEvents.map((event: any) => (
                          <div
                            key={event.id}
                            className="bg-primary/20 text-primary rounded px-1 py-0.5 text-xs truncate mb-0.5 group relative"
                            title={event.subject}
                          >
                            <span className="font-medium">{event.subject}</span>
                            <button
                              className="absolute right-0.5 top-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => { e.stopPropagation(); deleteEvent.mutate(event.id); }}
                            >
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly view */}
      {viewMode === "month" && (
        <Card>
          <CardContent className="p-0">
            {/* Day names header */}
            <div className="grid grid-cols-7 border-b border-border">
              {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
                <div key={d} className="p-2 text-xs text-muted-foreground text-center font-medium">
                  {d}
                </div>
              ))}
            </div>
            {/* Days grid */}
            <div className="grid grid-cols-7">
              {monthDays.map((day) => {
                const dayEvents = getEventsForDay(day);
                const inMonth = isSameMonth(day, currentDate);
                return (
                  <div
                    key={day.toISOString()}
                    className={`min-h-[90px] border-b border-r border-border p-1 cursor-pointer hover:bg-muted/30 transition-colors ${
                      !inMonth ? "bg-muted/20" : ""
                    } ${isToday(day) ? "bg-primary/5" : ""}`}
                    onClick={() => { setSelectedDate(day); setShowCreate(true); }}
                  >
                    <div className={`text-xs mb-1 ${isToday(day) ? "text-primary font-bold" : inMonth ? "text-foreground" : "text-muted-foreground"}`}>
                      {format(day, "d")}
                    </div>
                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 3).map((event: any) => {
                        const time = event.start?.dateTime
                          ? format(parseISO(event.start.dateTime), "HH:mm")
                          : "";
                        return (
                          <div
                            key={event.id}
                            className="bg-primary/15 text-primary rounded px-1 py-0.5 text-[10px] truncate"
                            title={`${time} ${event.subject}`}
                          >
                            {time && <span className="font-medium mr-1">{time}</span>}
                            {event.subject}
                          </div>
                        );
                      })}
                      {dayEvents.length > 3 && (
                        <div className="text-[10px] text-muted-foreground pl-1">
                          +{dayEvents.length - 3} más
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create event dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo evento – {format(selectedDate, "EEEE d 'de' MMMM, yyyy", { locale: es })}</DialogTitle>
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
