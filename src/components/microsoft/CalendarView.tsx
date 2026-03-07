import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCalendarEvents, useCreateCalendarEvent, useDeleteCalendarEvent } from "@/hooks/useMicrosoft";
import { CDMX_TZ } from "@/lib/dateUtils";
import {
  format, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
  parseISO, addMonths, subMonths, addWeeks, subWeeks,
  eachDayOfInterval, isToday, addDays, subDays, isSameMonth,
} from "date-fns";
import { toZonedTime } from "date-fns-tz";
import { es } from "date-fns/locale";
import { Plus, ChevronLeft, ChevronRight, Loader2, Trash2 } from "lucide-react";

type ViewMode = "day" | "3days" | "week" | "month";

const HOURS = Array.from({ length: 16 }, (_, i) => i + 6); // 6:00 - 21:00
const HOUR_HEIGHT = 48; // Fixed pixel height per hour slot

/** Parse an event datetime string into CDMX-adjusted Date */
function parseEventTime(dt: string): Date {
  if (dt.includes("T") && !dt.includes("Z") && !dt.includes("+") && !dt.includes("-", 10)) {
    return new Date(dt);
  }
  return toZonedTime(parseISO(dt), CDMX_TZ);
}

export function CalendarView() {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [newEvent, setNewEvent] = useState({ subject: "", startTime: "09:00", endTime: "10:00" });

  const viewDays = useMemo(() => {
    switch (viewMode) {
      case "day":
        return [currentDate];
      case "3days":
        return eachDayOfInterval({ start: currentDate, end: addDays(currentDate, 2) });
      case "week":
        return eachDayOfInterval({
          start: startOfWeek(currentDate, { weekStartsOn: 1 }),
          end: endOfWeek(currentDate, { weekStartsOn: 1 }),
        });
      case "month":
        return [];
      default:
        return [];
    }
  }, [viewMode, currentDate]);

  const monthDays = useMemo(() => {
    if (viewMode !== "month") return [];
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    const monthStart = startOfWeek(start, { weekStartsOn: 1 });
    const monthEnd = endOfWeek(end, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: monthStart, end: monthEnd });
  }, [viewMode, currentDate]);

  const rangeStart = useMemo(() => {
    if (viewMode === "month") return startOfMonth(currentDate).toISOString();
    if (viewMode === "day") return currentDate.toISOString();
    return (viewDays[0] || currentDate).toISOString();
  }, [viewMode, currentDate, viewDays]);

  const rangeEnd = useMemo(() => {
    if (viewMode === "month") return endOfMonth(currentDate).toISOString();
    if (viewMode === "day") return addDays(currentDate, 1).toISOString();
    const last = viewDays[viewDays.length - 1] || currentDate;
    return addDays(last, 1).toISOString();
  }, [viewMode, currentDate, viewDays]);

  const { data: events = [], isLoading } = useCalendarEvents(rangeStart, rangeEnd);
  const createEvent = useCreateCalendarEvent();
  const deleteEvent = useDeleteCalendarEvent();

  const goNext = () => {
    switch (viewMode) {
      case "day": setCurrentDate(addDays(currentDate, 1)); break;
      case "3days": setCurrentDate(addDays(currentDate, 3)); break;
      case "week": setCurrentDate(addWeeks(currentDate, 1)); break;
      case "month": setCurrentDate(addMonths(currentDate, 1)); break;
    }
  };
  const goPrev = () => {
    switch (viewMode) {
      case "day": setCurrentDate(subDays(currentDate, 1)); break;
      case "3days": setCurrentDate(subDays(currentDate, 3)); break;
      case "week": setCurrentDate(subWeeks(currentDate, 1)); break;
      case "month": setCurrentDate(subMonths(currentDate, 1)); break;
    }
  };
  const goToday = () => setCurrentDate(new Date());

  const eventsByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    events.forEach((e: any) => {
      const dt = e.start?.dateTime || e.start?.date;
      if (!dt) return;
      const parsed = parseEventTime(dt);
      const dateKey = format(parsed, "yyyy-MM-dd");
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push({ ...e, _parsedStart: parsed });
    });
    map.forEach((evts) => evts.sort((a: any, b: any) => a._parsedStart.getTime() - b._parsedStart.getTime()));
    return map;
  }, [events]);

  const getEventsForDay = (date: Date) => {
    const key = format(date, "yyyy-MM-dd");
    return eventsByDate.get(key) || [];
  };

  const handleCreateEvent = () => {
    if (!newEvent.subject) return;
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    createEvent.mutate(
      {
        subject: newEvent.subject,
        start: { dateTime: `${dateStr}T${newEvent.startTime}:00`, timeZone: CDMX_TZ },
        end: { dateTime: `${dateStr}T${newEvent.endTime}:00`, timeZone: CDMX_TZ },
      },
      {
        onSuccess: () => {
          setShowCreate(false);
          setNewEvent({ subject: "", startTime: "09:00", endTime: "10:00" });
        },
      }
    );
  };

  const headerLabel = useMemo(() => {
    switch (viewMode) {
      case "day":
        return format(currentDate, "EEEE d 'de' MMMM, yyyy", { locale: es });
      case "3days": {
        const end = addDays(currentDate, 2);
        return `${format(currentDate, "d MMM", { locale: es })} – ${format(end, "d MMM yyyy", { locale: es })}`;
      }
      case "week": {
        const ws = startOfWeek(currentDate, { weekStartsOn: 1 });
        const we = endOfWeek(currentDate, { weekStartsOn: 1 });
        return `${format(ws, "d MMM", { locale: es })} – ${format(we, "d MMM yyyy", { locale: es })}`;
      }
      case "month":
        return format(currentDate, "MMMM yyyy", { locale: es });
    }
  }, [viewMode, currentDate]);

  const colCount = viewMode === "month" ? 7 : viewDays.length;

  // Minimum width per column based on view mode
  const getMinWidth = () => {
    switch (viewMode) {
      case "day": return "min-w-[400px]";
      case "3days": return "min-w-[600px]";
      case "week": return "min-w-[750px]";
      default: return "";
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={goPrev}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToday}>Hoy</Button>
          <Button variant="outline" size="icon" className="h-8 w-8" onClick={goNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <h2 className="text-lg font-semibold capitalize ml-2">{headerLabel}</h2>
          {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList className="h-8">
              <TabsTrigger value="day" className="text-xs px-3 h-7">Día</TabsTrigger>
              <TabsTrigger value="3days" className="text-xs px-3 h-7">3 Días</TabsTrigger>
              <TabsTrigger value="week" className="text-xs px-3 h-7">Semana</TabsTrigger>
              <TabsTrigger value="month" className="text-xs px-3 h-7">Mes</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button size="sm" onClick={() => { setSelectedDate(new Date()); setShowCreate(true); }}>
            <Plus className="mr-1 h-4 w-4" /> Evento
          </Button>
        </div>
      </div>

      {/* Day / 3-day / Week grid view */}
      {viewMode !== "month" && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <div className={getMinWidth()}>
              {/* Day headers - sticky */}
              <div
                className="grid border-b border-border sticky top-0 z-10 bg-card"
                style={{ gridTemplateColumns: `56px repeat(${colCount}, 1fr)` }}
              >
                <div className="p-2 text-[10px] text-muted-foreground text-center border-r border-border flex items-center justify-center">
                  CDMX
                </div>
                {viewDays.map((day) => (
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
                      {format(day, "d", { locale: es })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Time grid - uniform height per row */}
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="grid border-b border-border last:border-b-0"
                  style={{
                    gridTemplateColumns: `56px repeat(${colCount}, 1fr)`,
                    height: `${HOUR_HEIGHT}px`,
                  }}
                >
                  <div className="text-[11px] text-muted-foreground text-right pr-2 border-r border-border pt-1 leading-none">
                    {`${hour.toString().padStart(2, "0")}:00`}
                  </div>
                  {viewDays.map((day) => {
                    const dayEvents = getEventsForDay(day).filter((e: any) => {
                      return e._parsedStart.getHours() === hour;
                    });
                    return (
                      <div
                        key={day.toISOString() + hour}
                        className="border-r border-border last:border-r-0 p-0.5 cursor-pointer hover:bg-muted/30 transition-colors overflow-hidden"
                        onClick={() => {
                          setSelectedDate(day);
                          setNewEvent({
                            ...newEvent,
                            startTime: `${hour.toString().padStart(2, "0")}:00`,
                            endTime: `${(hour + 1).toString().padStart(2, "0")}:00`,
                          });
                          setShowCreate(true);
                        }}
                      >
                        {dayEvents.map((event: any) => {
                          const startStr = format(event._parsedStart, "HH:mm");
                          const endDt = event.end?.dateTime ? parseEventTime(event.end.dateTime) : null;
                          const endStr = endDt ? format(endDt, "HH:mm") : "";
                          return (
                            <div
                              key={event.id}
                              className="bg-primary/20 text-primary rounded px-1.5 py-0.5 text-xs truncate mb-0.5 group relative"
                              title={`${startStr}${endStr ? " - " + endStr : ""} ${event.subject}`}
                            >
                              <span className="text-[10px] text-primary/70 mr-1">{startStr}</span>
                              <span className="font-medium">{event.subject}</span>
                              <button
                                className="absolute right-0.5 top-0.5 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                                onClick={(e) => { e.stopPropagation(); deleteEvent.mutate(event.id); }}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </button>
                            </div>
                          );
                        })}
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
            <div className="grid grid-cols-7 border-b border-border">
              {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
                <div key={d} className="p-2 text-xs text-muted-foreground text-center font-medium">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {monthDays.map((day) => {
                const dayEvents = getEventsForDay(day);
                const inMonth = isSameMonth(day, currentDate);
                return (
                  <div
                    key={day.toISOString()}
                    className={`h-[100px] border-b border-r border-border p-1 cursor-pointer hover:bg-muted/30 transition-colors overflow-hidden ${
                      !inMonth ? "bg-muted/20" : ""
                    } ${isToday(day) ? "bg-primary/5" : ""}`}
                    onClick={() => { setSelectedDate(day); setShowCreate(true); }}
                  >
                    <div className={`text-xs mb-1 ${isToday(day) ? "text-primary font-bold" : inMonth ? "text-foreground" : "text-muted-foreground"}`}>
                      {format(day, "d")}
                    </div>
                    <div className="space-y-0.5">
                      {dayEvents.slice(0, 3).map((event: any) => {
                        const time = event._parsedStart ? format(event._parsedStart, "HH:mm") : "";
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
                <Label>Hora inicio (CDMX)</Label>
                <Input
                  type="time"
                  value={newEvent.startTime}
                  onChange={(e) => setNewEvent({ ...newEvent, startTime: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Hora fin (CDMX)</Label>
                <Input
                  type="time"
                  value={newEvent.endTime}
                  onChange={(e) => setNewEvent({ ...newEvent, endTime: e.target.value })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Zona horaria: América/Ciudad de México</p>
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
