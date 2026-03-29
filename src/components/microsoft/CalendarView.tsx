import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
// Tabs replaced with custom tab-pill classes for view mode
import {
  useCalendarEvents,
  useCreateCalendarEvent,
  useDeleteCalendarEvent,
  useEventDetail,
  useUpdateCalendarEvent,
  useOutlookCategories,
} from "@/hooks/useMicrosoft";
import { CDMX_TZ, formatMX } from "@/lib/dateUtils";
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  parseISO,
  addMonths,
  subMonths,
  addWeeks,
  subWeeks,
  eachDayOfInterval,
  isToday,
  addDays,
  subDays,
  isSameMonth,
} from "date-fns";
import { Plus, ChevronLeft, ChevronRight, Loader2, Trash2, Video, Pencil } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";

type ViewMode = "day" | "3days" | "week" | "month";

const START_HOUR = 6;
const END_HOUR = 21;
const SLOT_MINUTES = 30; // Intervalos de 30 minutos, similar a Outlook
const TIME_SLOTS = Array.from(
  { length: ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES + 1 },
  (_, i) => START_HOUR * 60 + i * SLOT_MINUTES
);
const SLOT_HEIGHT = 32;

/** Parsea fecha/hora ISO del evento. Usar formatMX() para mostrar en zona CDMX. */
function parseEventTime(dt: string, fallback = new Date()): Date {
  if (!dt || typeof dt !== "string") return fallback;
  try {
    const d = parseISO(dt);
    return isNaN(d.getTime()) ? fallback : d;
  } catch {
    return fallback;
  }
}

function safeDescription(content: unknown): string {
  if (typeof content !== "string") return "";
  try {
    return content.replace(/<[^>]*>/g, "").trim() || "";
  } catch {
    return "";
  }
}

function minutesToLabel(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

const CATEGORY_COLOR_CLASSES = [
  "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-200",
  "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-200",
  "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
];

function getCategoryClasses(name?: string | null) {
  if (!name) return "";
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash + name.charCodeAt(i)) % 2147483647;
  }
  const index = hash % CATEGORY_COLOR_CLASSES.length;
  return CATEGORY_COLOR_CLASSES[index];
}

export function CalendarView() {
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [newEvent, setNewEvent] = useState({
    subject: "",
    startTime: "09:00",
    endTime: "10:00",
    attendees: "",
    location: "",
    description: "",
    isOnlineMeeting: true,
    isAllDay: false,
    categories: [] as string[],
  });

  const { data: eventDetail, isLoading: eventDetailLoading } = useEventDetail(selectedEventId);
  const updateEvent = useUpdateCalendarEvent();
  const { data: outlookCategories = [] } = useOutlookCategories();

  const [draggedEvent, setDraggedEvent] = useState<any>(null);

  const handleDrop = useCallback(
    (day: Date, slotMinutes: number) => {
      if (!draggedEvent) return;
      const startDt = parseEventTime(
        draggedEvent.start?.dateTime || draggedEvent.start?.date,
        new Date()
      );
      const endDt = parseEventTime(
        draggedEvent.end?.dateTime || draggedEvent.end?.date,
        new Date(startDt.getTime() + 60 * 60 * 1000)
      );
      const durationMs = endDt.getTime() - startDt.getTime();

      const newStartDate = format(day, "yyyy-MM-dd");
      const newStartHour = Math.floor(slotMinutes / 60);
      const newStartMin = slotMinutes % 60;
      const newStartTime = `${newStartHour.toString().padStart(2, "0")}:${newStartMin.toString().padStart(2, "0")}`;

      const newEndMs = new Date(`${newStartDate}T${newStartTime}:00`).getTime() + durationMs;
      const newEnd = new Date(newEndMs);
      const newEndDate = format(newEnd, "yyyy-MM-dd");
      const newEndTime = format(newEnd, "HH:mm");

      updateEvent.mutate({
        eventId: draggedEvent.id,
        payload: {
          start: { dateTime: `${newStartDate}T${newStartTime}:00`, timeZone: CDMX_TZ },
          end: { dateTime: `${newEndDate}T${newEndTime}:00`, timeZone: CDMX_TZ },
        },
      });
      setDraggedEvent(null);
    },
    [draggedEvent, updateEvent]
  );

  const [editForm, setEditForm] = useState({
    subject: "",
    startDate: "",
    startTime: "09:00",
    endDate: "",
    endTime: "10:00",
    location: "",
    description: "",
    categories: [] as string[],
    attendees: "",
  });

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

  const { data: eventsData, isLoading } = useCalendarEvents(rangeStart, rangeEnd);
  const events = Array.isArray(eventsData) ? eventsData : [];
  const createEvent = useCreateCalendarEvent();
  const deleteEvent = useDeleteCalendarEvent();

  const cachedEvent = useMemo(
    () => (selectedEventId ? events.find((e: any) => e.id === selectedEventId) : null),
    [events, selectedEventId]
  );

  useEffect(() => {
    const source = eventDetail || (cachedEvent && selectedEventId ? cachedEvent : null);
    if (!source) return;
    try {
      const start = source.start?.dateTime || source.start?.date;
      const end = source.end?.dateTime || source.end?.date;
      const parsedStart = parseEventTime(start, new Date());
      const parsedEnd = parseEventTime(end, new Date(parsedStart.getTime() + 60 * 60 * 1000));
      const attendeesStr = (source.attendees || [])
        .map((a: any) => a.emailAddress?.address)
        .filter(Boolean)
        .join(", ");
      setEditForm({
        subject: source.subject ?? "",
        startDate: formatMX(parsedStart, "yyyy-MM-dd"),
        startTime: formatMX(parsedStart, "HH:mm"),
        endDate: formatMX(parsedEnd, "yyyy-MM-dd"),
        endTime: formatMX(parsedEnd, "HH:mm"),
        location: source.location?.displayName ?? "",
        description: safeDescription(source.body?.content),
        categories: Array.isArray(source.categories) ? [...source.categories] : [],
        attendees: attendeesStr,
      });
    } catch (_) {
      setEditForm((prev) => ({ ...prev, subject: (eventDetail || cachedEvent)?.subject ?? prev.subject }));
    }
  }, [eventDetail, cachedEvent, selectedEventId]);

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
    const eventsList = Array.isArray(events) ? events : [];

    eventsList.forEach((e: any) => {
      try {
        const rawStart = e?.start?.dateTime || e?.start?.date;
        if (!rawStart) return;

        const parsedStart = parseEventTime(rawStart);
        if (isNaN(parsedStart.getTime())) return;
        const dateKey = formatMX(parsedStart, "yyyy-MM-dd");

        const isAllDay =
          e.isAllDay === true ||
          (!!e.start?.date && !e.start?.dateTime) ||
          (!!e.end?.date && !e.end?.dateTime);

        const enhancedEvent = {
          ...e,
          _parsedStart: parsedStart,
          _isAllDay: isAllDay,
        };

        if (!map.has(dateKey)) map.set(dateKey, []);
        map.get(dateKey)!.push(enhancedEvent);
      } catch {
        // omitir evento con datos inválidos para no romper la vista
      }
    });

    map.forEach((evts) =>
      evts.sort((a: any, b: any) => (a._parsedStart?.getTime() ?? 0) - (b._parsedStart?.getTime() ?? 0))
    );

    return map;
  }, [events]);

  const getEventsForDay = (date: Date) => {
    const key = format(date, "yyyy-MM-dd");
    return eventsByDate.get(key) || [];
  };

  const getAllDayEventsForDay = (date: Date) => {
    return getEventsForDay(date).filter((e: any) => e._isAllDay);
  };

  const handleCreateEvent = () => {
    if (!newEvent.subject) return;
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    const attendees = newEvent.attendees
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((address) => ({
        emailAddress: { address },
        type: "required",
      }));

    const nextDayStr = format(addDays(selectedDate, 1), "yyyy-MM-dd");

    const baseEvent: any = newEvent.isAllDay
      ? {
          subject: newEvent.subject,
          isAllDay: true,
          start: { dateTime: `${dateStr}T00:00:00`, timeZone: CDMX_TZ },
          end: { dateTime: `${nextDayStr}T00:00:00`, timeZone: CDMX_TZ },
        }
      : {
          subject: newEvent.subject,
          start: { dateTime: `${dateStr}T${newEvent.startTime}:00`, timeZone: CDMX_TZ },
          end: { dateTime: `${dateStr}T${newEvent.endTime}:00`, timeZone: CDMX_TZ },
        };

    if (newEvent.description.trim()) {
      baseEvent.body = {
        contentType: "HTML",
        content: newEvent.description.trim(),
      };
    }

    if (newEvent.location.trim()) {
      baseEvent.location = {
        displayName: newEvent.location.trim(),
      };
    }

    if (attendees.length > 0) {
      baseEvent.attendees = attendees;
    }

    if (newEvent.isOnlineMeeting) {
      baseEvent.isOnlineMeeting = true;
      baseEvent.onlineMeetingProvider = "teamsForBusiness";
    }

    if (newEvent.categories.length > 0) {
      baseEvent.categories = newEvent.categories;
    }

    createEvent.mutate(
      baseEvent,
      {
        onSuccess: () => {
          setShowCreate(false);
          setNewEvent({
            subject: "",
            startTime: "09:00",
            endTime: "10:00",
            attendees: "",
            location: "",
            description: "",
            isOnlineMeeting: true,
            isAllDay: false,
            categories: [],
          });
        },
      }
    );
  };

  const handleUpdateEvent = () => {
    if (!selectedEventId) return;
    const attendees = editForm.attendees
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((address) => ({
        emailAddress: { address },
        type: "required",
      }));

    const payload: any = {
      subject: editForm.subject,
      start: {
        dateTime: `${editForm.startDate}T${editForm.startTime}:00`,
        timeZone: CDMX_TZ,
      },
      end: {
        dateTime: `${editForm.endDate}T${editForm.endTime}:00`,
        timeZone: CDMX_TZ,
      },
      location: editForm.location.trim() ? { displayName: editForm.location.trim() } : undefined,
      body: editForm.description.trim()
        ? { contentType: "HTML", content: editForm.description.trim() }
        : undefined,
      categories: editForm.categories,
      attendees: attendees.length > 0 ? attendees : undefined,
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    updateEvent.mutate(
      { eventId: selectedEventId, payload },
      {
        onSuccess: () => setSelectedEventId(null),
      }
    );
  };

  const toggleEditCategory = (name: string) => {
    setEditForm((prev) => ({
      ...prev,
      categories: prev.categories.includes(name)
        ? prev.categories.filter((c) => c !== name)
        : [...prev.categories, name],
    }));
  };

  const toggleNewEventCategory = (name: string) => {
    setNewEvent((prev) => ({
      ...prev,
      categories: prev.categories.includes(name)
        ? prev.categories.filter((c) => c !== name)
        : [...prev.categories, name],
    }));
  };

  const headerLabel = useMemo(() => {
    switch (viewMode) {
      case "day":
        return format(currentDate, "EEEE d 'de' MMMM, yyyy");
      case "3days": {
        const end = addDays(currentDate, 2);
        return `${format(currentDate, "d MMM")} – ${format(end, "d MMM yyyy")}`;
      }
      case "week": {
        const ws = startOfWeek(currentDate, { weekStartsOn: 1 });
        const we = endOfWeek(currentDate, { weekStartsOn: 1 });
        return `${format(ws, "d MMM")} – ${format(we, "d MMM yyyy")}`;
      }
      case "month":
        return format(currentDate, "MMMM yyyy");
    }
  }, [viewMode, currentDate]);

  const colCount = viewMode === "month" ? 7 : viewDays.length;

  // Anchura mínima por columna según la vista,
  // para evitar que el calendario se "rompa" en pantallas pequeñas.
  const getMinWidth = () => {
    switch (viewMode) {
      case "day": return "min-w-[400px]";
      case "3days": return "min-w-[600px]";
      case "week": return "min-w-[820px]";
      default: return "";
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
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
          <div className="flex gap-1 bg-secondary/30 rounded-full p-0.5">
            {(["day", "3days", "week", "month"] as const).map((v) => (
              <button
                key={v}
                className={`tab-pill ${viewMode === v ? "tab-pill-active" : "tab-pill-inactive"}`}
                onClick={() => setViewMode(v)}
              >
                {v === "day" ? "Día" : v === "3days" ? "3 Días" : v === "week" ? "Semana" : "Mes"}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={() => { setSelectedDate(new Date()); setShowCreate(true); }}>
            <Plus className="mr-1 h-4 w-4" /> Evento
          </Button>
        </div>
      </div>

      {/* Vista Día / 3 días / Semana - estilo rejilla de Outlook */}
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
                      {format(day, "EEE")}
                    </div>
                    <div className={`text-sm font-medium ${isToday(day) ? "text-primary" : ""}`}>
                      {format(day, "d")}
                    </div>
                  </div>
                ))}
              </div>

              {/* Banda de eventos de día completo (Todo el día), similar a Outlook */}
              <div
                className="grid border-b border-border bg-muted/40"
                style={{ gridTemplateColumns: `56px repeat(${colCount}, 1fr)` }}
              >
                <div className="text-[11px] text-muted-foreground text-right pr-2 border-r border-border py-1.5 leading-none">
                  Todo el día
                </div>
                {viewDays.map((day) => {
                  const allDayEvents = getAllDayEventsForDay(day);
                  return (
                    <div
                      key={day.toISOString() + "-allday"}
                      className="border-r border-border last:border-r-0 px-1 py-1 space-y-1 overflow-hidden cursor-pointer hover:bg-muted/40 transition-colors"
                      onClick={() => {
                        setSelectedDate(day);
                        setShowCreate(true);
                      }}
                    >
                      {allDayEvents.map((event: any) => (
                        <div
                          key={event.id}
                          className="bg-primary/20 text-primary rounded px-1.5 py-0.5 text-[11px] truncate group relative cursor-pointer"
                          title={event.subject}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedEventId(event.id);
                          }}
                        >
                          <span className="font-medium">{event.subject}</span>
                          <button
                            className="absolute right-0.5 top-0.5 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteEvent.mutate(event.id);
                            }}
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              {/* Time grid - una sola columna de horas y columnas de día con bloques continuos */}
              <div
                className="grid border-t border-border"
                style={{ gridTemplateColumns: `56px repeat(${colCount}, 1fr)` }}
              >
                {/* Columna de horas */}
                <div className="border-r border-border">
                  {TIME_SLOTS.map((slotMinutes) => (
                    <div
                      key={slotMinutes}
                      className="text-[11px] text-muted-foreground text-right pr-2 border-b border-border pt-1 leading-none"
                      style={{ height: `${SLOT_HEIGHT}px` }}
                    >
                      {minutesToLabel(slotMinutes)}
                    </div>
                  ))}
                </div>

                {/* Columnas por día, con fondo por slot y eventos posicionados como en Outlook */}
                {viewDays.map((day) => {
                  const dayEvents = getEventsForDay(day).filter((e: any) => !e._isAllDay);
                  return (
                    <div
                      key={day.toISOString() + "-column"}
                      className="relative border-r border-border last:border-r-0 cursor-pointer hover:bg-muted/10"
                      onClick={() => {
                        setSelectedDate(day);
                        setShowCreate(true);
                      }}
                    >
                      {/* Fondo por slot - drop targets */}
                      {TIME_SLOTS.map((slotMinutes) => (
                        <div
                          key={slotMinutes}
                          className="border-b border-border/60 last:border-b-0 transition-colors duration-100 relative"
                          style={{ height: `${SLOT_HEIGHT}px` }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            e.currentTarget.classList.add("bg-primary/20");
                            // Show time label
                            const label = e.currentTarget.querySelector(".drop-label");
                            if (label) (label as HTMLElement).style.display = "block";
                          }}
                          onDragLeave={(e) => {
                            e.currentTarget.classList.remove("bg-primary/20");
                            const label = e.currentTarget.querySelector(".drop-label");
                            if (label) (label as HTMLElement).style.display = "none";
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove("bg-primary/20");
                            const label = e.currentTarget.querySelector(".drop-label");
                            if (label) (label as HTMLElement).style.display = "none";
                            handleDrop(day, slotMinutes);
                          }}
                        >
                          <span
                            className="drop-label absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-primary pointer-events-none z-10"
                            style={{ display: "none" }}
                          >
                            {minutesToLabel(slotMinutes)}
                          </span>
                        </div>
                      ))}

                      {/* Capa de eventos */}
                      {dayEvents.map((event: any) => {
                        const startTotal =
                          event._parsedStart.getHours() * 60 + event._parsedStart.getMinutes();
                        const endDt = event.end?.dateTime
                          ? parseEventTime(event.end.dateTime)
                          : null;
                        const endTotal = endDt
                          ? endDt.getHours() * 60 + endDt.getMinutes()
                          : startTotal + SLOT_MINUTES;

                        const dayStart = START_HOUR * 60;
                        const dayEnd = END_HOUR * 60;

                        const clampedStart = Math.max(startTotal, dayStart);
                        const clampedEnd = Math.min(endTotal, dayEnd);

                        if (clampedEnd <= clampedStart) return null;

                        const offsetMinutes = clampedStart - dayStart;
                        const top =
                          (offsetMinutes / SLOT_MINUTES) * SLOT_HEIGHT + 2; // pequeño offset
                        const height = Math.max(
                          SLOT_HEIGHT,
                          ((clampedEnd - clampedStart) / SLOT_MINUTES) * SLOT_HEIGHT - 4
                        );

                        const startStr = formatMX(event._parsedStart, "HH:mm");
                        const endStr = endDt ? formatMX(endDt, "HH:mm") : "";
                        const primaryCategory: string | undefined = event.categories?.[0];
                        const categoryClasses = getCategoryClasses(primaryCategory);
                        const meetingUrl: string | undefined =
                          event.onlineMeeting?.joinUrl || event.onlineMeetingUrl;

                        return (
                          <div
                            key={event.id}
                            className={`absolute inset-x-0 px-0.5 ${draggedEvent?.id === event.id ? "opacity-40" : ""}`}
                            style={{ top, height }}
                            draggable
                            onDragStart={(e) => {
                              e.stopPropagation();
                              setDraggedEvent(event);
                              e.dataTransfer.effectAllowed = "move";
                            }}
                            onDragEnd={() => setDraggedEvent(null)}
                          >
                            <div
                              className="h-full bg-primary/20 text-primary rounded px-1.5 py-0.5 text-xs truncate mb-0.5 group relative shadow-sm cursor-grab active:cursor-grabbing transition-all duration-150 hover:shadow-md hover:bg-primary/25"
                              title={`${startStr}${endStr ? " - " + endStr : ""} ${event.subject}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedEventId(event.id);
                              }}
                            >
                              <div className="flex items-start gap-1 pr-4">
                                {primaryCategory && (
                                  <span
                                    className={`rounded px-1 py-px text-[9px] font-medium ${categoryClasses}`}
                                  >
                                    {primaryCategory}
                                  </span>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="text-[10px] text-primary/70">
                                    {endStr ? `${startStr}–${endStr}` : startStr}
                                  </div>
                                  <div className="font-medium truncate leading-tight">
                                    {event.subject}
                                  </div>
                                  {event.location?.displayName && (
                                    <div className="text-[9px] text-primary/80 truncate">
                                      {event.location.displayName}
                                    </div>
                                  )}
                                </div>
                                {meetingUrl && (
                                  <button
                                    type="button"
                                    className="ml-auto p-0.5"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      window.open(meetingUrl, "_blank");
                                    }}
                                    title="Abrir enlace de reunión"
                                  >
                                    <Video className="h-3 w-3 text-primary" />
                                  </button>
                                )}
                              </div>
                              <button
                                className="absolute right-0.5 top-0.5 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  deleteEvent.mutate(event.id);
                                }}
                              >
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
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
                        const time = event._parsedStart ? formatMX(event._parsedStart, "HH:mm") : "";
                        return (
                          <div
                            key={event.id}
                            className="bg-primary/15 text-primary rounded px-1 py-0.5 text-[10px] truncate cursor-pointer transition-all duration-150 hover:bg-primary/25 hover:shadow-sm"
                            title={`${time} ${event.subject}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEventId(event.id);
                            }}
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
            <DialogTitle>Nuevo evento – {format(selectedDate, "EEEE d 'de' MMMM, yyyy")}</DialogTitle>
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
            <div className="flex items-center justify-between gap-2">
              <Label className="text-sm">Día completo</Label>
              <Switch
                checked={newEvent.isAllDay}
                onCheckedChange={(checked) =>
                  setNewEvent({ ...newEvent, isAllDay: checked })
                }
              />
            </div>
            {!newEvent.isAllDay && (
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
            )}
            <div className="space-y-2">
              <Label>Invitados (correos separados por coma)</Label>
              <Input
                placeholder="persona1@ejemplo.com, persona2@ejemplo.com"
                value={newEvent.attendees}
                onChange={(e) => setNewEvent({ ...newEvent, attendees: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Ubicación / dirección</Label>
              <Input
                placeholder="Oficina, sala, dirección física, etc."
                value={newEvent.location}
                onChange={(e) => setNewEvent({ ...newEvent, location: e.target.value })}
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div>
                <Label className="text-sm">Crear reunión de Microsoft Teams</Label>
                <p className="text-xs text-muted-foreground">
                  Si está activo, Outlook generará el enlace de Teams automáticamente.
                </p>
              </div>
              <Switch
                checked={newEvent.isOnlineMeeting}
                onCheckedChange={(checked) =>
                  setNewEvent({ ...newEvent, isOnlineMeeting: checked })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Descripción / notas</Label>
              <Textarea
                placeholder="Agenda, notas, instrucciones de conexión, etc."
                value={newEvent.description}
                onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })}
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label>Etiquetas (categorías)</Label>
              {outlookCategories.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {outlookCategories.map((cat: any) => (
                    <label
                      key={cat.displayName || cat.id}
                      className="flex items-center gap-1.5 text-sm cursor-pointer"
                    >
                      <Checkbox
                        checked={newEvent.categories.includes(cat.displayName)}
                        onCheckedChange={() => toggleNewEventCategory(cat.displayName)}
                      />
                      <span>{cat.displayName}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <Input
                  placeholder="Ej: Personal, Trabajo (separadas por coma)"
                  value={newEvent.categories.join(", ")}
                  onChange={(e) =>
                    setNewEvent({
                      ...newEvent,
                      categories: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              )}
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

      {/* Ver / Editar evento */}
      <Dialog open={!!selectedEventId} onOpenChange={(open) => !open && setSelectedEventId(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              Ver y editar evento
            </DialogTitle>
          </DialogHeader>
          {eventDetailLoading && !cachedEvent ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (cachedEvent || eventDetail) ? (
            <div className="space-y-4 py-2">
              {(eventDetail?.onlineMeeting?.joinUrl ||
                cachedEvent?.onlineMeeting?.joinUrl ||
                cachedEvent?.onlineMeetingUrl) && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(
                        eventDetail?.onlineMeeting?.joinUrl ||
                          cachedEvent?.onlineMeeting?.joinUrl ||
                          cachedEvent?.onlineMeetingUrl,
                        "_blank"
                      )
                    }
                  >
                    <Video className="mr-1 h-4 w-4" /> Unirse a la reunión (Teams)
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                <Label>Asunto</Label>
                <Input
                  value={editForm.subject}
                  onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                  placeholder="Asunto del evento"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Fecha inicio</Label>
                  <Input
                    type="date"
                    value={editForm.startDate}
                    onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Hora inicio</Label>
                  <Input
                    type="time"
                    value={editForm.startTime}
                    onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Fecha fin</Label>
                  <Input
                    type="date"
                    value={editForm.endDate}
                    onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Hora fin</Label>
                  <Input
                    type="time"
                    value={editForm.endTime}
                    onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Ubicación</Label>
                <Input
                  value={editForm.location}
                  onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                  placeholder="Lugar o dirección"
                />
              </div>
              <div className="space-y-2">
                <Label>Invitados (correos separados por coma)</Label>
                <Input
                  value={editForm.attendees}
                  onChange={(e) => setEditForm({ ...editForm, attendees: e.target.value })}
                  placeholder="email@ejemplo.com"
                />
              </div>
              <div className="space-y-2">
                <Label>Descripción</Label>
                <Textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <Label>Etiquetas (categorías)</Label>
                {outlookCategories.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {outlookCategories.map((cat: any) => (
                      <label
                        key={cat.displayName || cat.id}
                        className="flex items-center gap-1.5 text-sm cursor-pointer"
                      >
                        <Checkbox
                          checked={editForm.categories.includes(cat.displayName)}
                          onCheckedChange={() => toggleEditCategory(cat.displayName)}
                        />
                        <span>{cat.displayName}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <Input
                    placeholder="Ej: Personal, Trabajo (separadas por coma)"
                    value={editForm.categories.join(", ")}
                    onChange={(e) =>
                      setEditForm({
                        ...editForm,
                        categories: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                  />
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="destructive"
              onClick={() => {
                if (selectedEventId) {
                  deleteEvent.mutate(selectedEventId, { onSuccess: () => setSelectedEventId(null) });
                }
              }}
              disabled={deleteEvent.isPending}
            >
              {deleteEvent.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Eliminar
            </Button>
            <div className="flex-1" />
            <Button variant="outline" onClick={() => setSelectedEventId(null)}>
              Cerrar
            </Button>
            <Button
              onClick={handleUpdateEvent}
              disabled={updateEvent.isPending || !editForm.subject}
            >
              {updateEvent.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
