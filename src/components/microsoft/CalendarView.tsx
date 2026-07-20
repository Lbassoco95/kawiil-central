import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  useCalendarEvents,
  useCalendars,
  useCreateCalendarEvent,
  useDeleteCalendarEvent,
  useEventDetail,
  useUpdateCalendarEvent,
  useOutlookCategories,
} from "@/hooks/useMicrosoft";
import { useTasksForCalendar } from "@/hooks/useTasks";
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
  isSameDay,
  differenceInDays,
} from "date-fns";
import { es } from "date-fns/locale";
import {
  Plus, ChevronLeft, ChevronRight, Loader2, Trash2, Video, Pencil,
  CalendarDays, CheckSquare, Clock, MapPin, Users, ExternalLink, AlertCircle,
  PanelRightClose, PanelRightOpen,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Link } from "react-router-dom";
import { CalendarKawiilCard } from "@/components/microsoft/CalendarKawiilCard";
import { CreateTaskFromEventDialog } from "@/components/microsoft/CreateTaskFromEventDialog";
import {
  useLinkedAccounts, useGoogleConnection, useGoogleCalendarEvents, useGoogleCalendars,
  useOutlookConnection, useOutlookAccountEvents, useOutlookAccountCalendars, useRenameLinkedAccount,
} from "@/hooks/useLinkedAccounts";
import { ColorPickerPopover, paletteColorFor, hexAlpha } from "@/components/microsoft/ColorPickerPopover";
import {
  useCalendarCategories, useEventTags, useCreateCalendarCategory,
  useUpdateCalendarCategory, useDeleteCalendarCategory, useToggleEventTag,
} from "@/hooks/useCalendarCategories";
import { useCalendarPrefs, useSaveCalendarPrefs } from "@/hooks/useCalendarPrefs";
import { useWorkLocations, WORK_STATUS_META } from "@/hooks/useWorkLocations";
import { WorkLocationChip } from "@/components/microsoft/WorkLocationChip";
import { useTeamAvailability } from "@/hooks/useTeamAvailability";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { EventTravelSection } from "@/components/microsoft/EventTravelSection";
import { PlaceAutocompleteInput } from "@/components/microsoft/PlaceAutocompleteInput";
import { useAuth } from "@/contexts/AuthContext";

type ViewMode = "day" | "3days" | "week" | "month" | "agenda" | "equipo";

/** Colores de acento por calendario (barra lateral izquierda del evento). */
const CALENDAR_ACCENT_COLORS = [
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#a855f7", // purple
  "#ec4899", // pink
  "#0ea5e9", // sky
  "#ef4444", // red
  "#14b8a6", // teal
];

function calendarAccentColor(calendarId?: string | null, index = 0): string {
  if (!calendarId) return CALENDAR_ACCENT_COLORS[index % CALENDAR_ACCENT_COLORS.length];
  let hash = 0;
  for (let i = 0; i < calendarId.length; i++) hash = (hash + calendarId.charCodeAt(i)) % 2147483647;
  return CALENDAR_ACCENT_COLORS[hash % CALENDAR_ACCENT_COLORS.length];
}

/** Color estable por cuenta conectada (verde primero, reutiliza el de la cuenta Google;
 *  evita el teal del calendario principal de Microsoft). */
const ACCOUNT_COLORS = ["#22c55e", "#f97316", "#a855f7", "#0ea5e9", "#ec4899", "#eab308", "#ef4444", "#8b5cf6"];
function accountColorFor(accountId?: string | null): string {
  if (!accountId) return ACCOUNT_COLORS[0];
  let hash = 0;
  for (let i = 0; i < accountId.length; i++) hash = (hash + accountId.charCodeAt(i)) % 2147483647;
  return ACCOUNT_COLORS[hash % ACCOUNT_COLORS.length];
}

// Identidad de la cuenta principal de Microsoft (Kawiil), que no vive en linked_accounts.
const PRIMARY_MS_ID = "microsoft-primary";
const PRIMARY_MS_COLOR = "#0099bc"; // teal Kawiil por defecto (editable)

/** Extrae el accountId de un calendarId namespaced de una cuenta añadida
 *  (google:<accId>:<calId> u outlook:<accId>:<calId>). null si es el principal M365. */
function linkedAccountIdFromCalendarId(calendarId?: string | null): string | null {
  if (!calendarId) return null;
  if (calendarId.startsWith("google:") || calendarId.startsWith("outlook:")) {
    const parts = calendarId.split(":");
    return parts.length >= 2 ? parts[1] : null;
  }
  return null;
}

const START_HOUR = 6;
const END_HOUR = 23;
const SLOT_MINUTES = 30;
const TIME_SLOTS = Array.from(
  { length: ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES + 1 },
  (_, i) => START_HOUR * 60 + i * SLOT_MINUTES
);
const SLOT_HEIGHT = 32;

function parseEventTime(dt: string, fallback = new Date()): Date {
  if (!dt || typeof dt !== "string") return fallback;
  try {
    const d = parseISO(dt);
    return isNaN(d.getTime()) ? fallback : d;
  } catch { return fallback; }
}

function safeDescription(content: unknown): string {
  if (typeof content !== "string") return "";
  try { return content.replace(/<[^>]*>/g, "").trim() || ""; } catch { return ""; }
}

function minutesToLabel(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

type PositionedEvent = {
  event: any;
  startMin: number;
  endMin: number;
  col: number;
  cols: number;
};

/**
 * Reparte los eventos con hora de un día en carriles (columnas) para que los
 * que se solapan se dibujen lado a lado en vez de encimarse. Agrupa en
 * "clusters" de eventos que se traslapan de forma transitiva y, dentro de cada
 * cluster, asigna cada evento al primer carril libre.
 */
function layoutDayEvents(dayEvents: any[]): PositionedEvent[] {
  const items = dayEvents
    .map((event) => {
      const startTotal = event._parsedStart.getHours() * 60 + event._parsedStart.getMinutes();
      const endDt = event.end?.dateTime ? parseEventTime(event.end.dateTime) : null;
      const endTotal = endDt ? endDt.getHours() * 60 + endDt.getMinutes() : startTotal + SLOT_MINUTES;
      return { event, startMin: startTotal, endMin: Math.max(endTotal, startTotal + SLOT_MINUTES) };
    })
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

  const positioned: PositionedEvent[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -1;

  const flush = () => {
    if (cluster.length === 0) return;
    const columnEnds: number[] = []; // minuto de fin del último evento de cada carril
    const assigned: Array<{ item: (typeof cluster)[number]; col: number }> = [];
    for (const it of cluster) {
      let col = columnEnds.findIndex((end) => it.startMin >= end);
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(it.endMin);
      } else {
        columnEnds[col] = it.endMin;
      }
      assigned.push({ item: it, col });
    }
    const cols = columnEnds.length;
    for (const a of assigned) {
      positioned.push({ event: a.item.event, startMin: a.item.startMin, endMin: a.item.endMin, col: a.col, cols });
    }
    cluster = [];
    clusterEnd = -1;
  };

  for (const it of items) {
    if (cluster.length > 0 && it.startMin >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  flush();

  return positioned;
}

const PRIORITY_COLORS: Record<string, string> = {
  urgente: "bg-red-500",
  alta: "bg-orange-500",
  media: "bg-amber-400",
  baja: "bg-green-500",
};

function taskDetailHref(taskId: string) {
  return `/tareas?taskId=${encodeURIComponent(taskId)}`;
}

/** Fecha de vencimiento como yyyy-MM-dd (evita desajuste si due_date viene con hora/Z). */
function taskDueDateKey(due: string | null | undefined): string | null {
  if (!due || typeof due !== "string") return null;
  const s = due.trim();
  if (s.length >= 10) return s.slice(0, 10);
  return null;
}

export function CalendarView({
  aiEvents,
  aiTasksDue,
  aiPeriodLabel,
}: {
  aiEvents?: any[];
  aiTasksDue?: any[];
  aiPeriodLabel?: string;
}) {
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth < 768 ? "day" : "week"
  );
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [showTaskFromEvent, setShowTaskFromEvent] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showKawiilTasks, setShowKawiilTasks] = useState(true);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  // Cuando el panel derecho está abierto en escritorio, corre el botón flotante
  // de IA a la izquierda del panel para que no lo tape. Se limpia al salir.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (rightPanelOpen && !isMobile) {
      root.style.setProperty("--kawiil-fab-right", "280px");
    } else {
      root.style.removeProperty("--kawiil-fab-right");
    }
    return () => root.style.removeProperty("--kawiil-fab-right");
  }, [rightPanelOpen, isMobile]);
  const [hiddenCalendarIds, setHiddenCalendarIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("kawiil-cal-hidden-calendars");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem("kawiil-cal-hidden-calendars", JSON.stringify(hiddenCalendarIds)); } catch { /* ignore */ }
  }, [hiddenCalendarIds]);

  // Overrides de color elegidos por el usuario (calendarios y categorías), persistidos.
  const [calendarColors, setCalendarColors] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(window.localStorage.getItem("kawiil-cal-calendar-colors") || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("kawiil-cal-calendar-colors", JSON.stringify(calendarColors)); } catch { /* ignore */ }
  }, [calendarColors]);
  const [categoryColors, setCategoryColors] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(window.localStorage.getItem("kawiil-cal-category-colors") || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("kawiil-cal-category-colors", JSON.stringify(categoryColors)); } catch { /* ignore */ }
  }, [categoryColors]);
  const setCalendarColor = (id: string, color: string) => setCalendarColors((p) => ({ ...p, [id]: color }));
  const resetCalendarColor = (id: string) => setCalendarColors((p) => { const n = { ...p }; delete n[id]; return n; });
  const setCategoryColor = (name: string, color: string) => setCategoryColors((p) => ({ ...p, [name]: color }));
  const resetCategoryColor = (name: string) => setCategoryColors((p) => { const n = { ...p }; delete n[name]; return n; });

  // Color por cuenta (editable, incluye la principal de Microsoft) persistido.
  const [accountColors, setAccountColors] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try { return JSON.parse(window.localStorage.getItem("kawiil-cal-account-colors") || "{}"); } catch { return {}; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("kawiil-cal-account-colors", JSON.stringify(accountColors)); } catch { /* ignore */ }
  }, [accountColors]);
  const setAccountColor = (id: string, color: string) => setAccountColors((p) => ({ ...p, [id]: color }));
  const resetAccountColor = (id: string) => setAccountColors((p) => { const n = { ...p }; delete n[id]; return n; });
  // Nombre editable de la cuenta principal de Microsoft (las vinculadas usan display_name en BD).
  const [primaryName, setPrimaryName] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try { return window.localStorage.getItem("kawiil-cal-primary-name") || ""; } catch { return ""; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("kawiil-cal-primary-name", primaryName); } catch { /* ignore */ }
  }, [primaryName]);
  const primaryLabel = primaryName || "Microsoft 365 (Kawiil)";

  const [activeCategoryFilters, setActiveCategoryFilters] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = window.localStorage.getItem("kawiil-cal-cat-filters");
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { window.localStorage.setItem("kawiil-cal-cat-filters", JSON.stringify(activeCategoryFilters)); } catch { /* ignore */ }
  }, [activeCategoryFilters]);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const nowIndicatorRef = useRef<HTMLDivElement>(null);

  // Now indicator (línea roja con hora actual) — refresca cada 30s para precisión
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (isMobile) setViewMode("day");
  }, [isMobile]);

  // Al abrir / cambiar de vista: centrar en la hora actual si hoy está a la vista.
  // Así el usuario siempre aterriza en "ahora". Si hoy no está en la vista
  // (p. ej. navegó a otra semana), se restaura la última posición guardada.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const anchor = scrollAreaRef.current;
    if (!anchor) return;

    const key = `kawiil-cal-scroll-${viewMode}`;
    let cancelInitialScroll = false;
    const t = window.setTimeout(() => {
      if (cancelInitialScroll) return;
      const indicator = nowIndicatorRef.current;
      if (indicator) {
        // Centrar en la hora actual (indicador ~1/3 desde arriba).
        const containerRect = anchor.getBoundingClientRect();
        const indicatorRect = indicator.getBoundingClientRect();
        const top = anchor.scrollTop + (indicatorRect.top - containerRect.top) - anchor.clientHeight / 3;
        anchor.scrollTop = Math.max(0, top);
      } else {
        // Hoy no está en la vista: restaurar posición previa si existe.
        try {
          const saved = window.sessionStorage.getItem(key);
          if (saved) anchor.scrollTop = parseInt(saved, 10) || 0;
        } catch { /* ignore */ }
      }
    }, 120);
    const onUserScrollOnce = () => {
      cancelInitialScroll = true;
      window.clearTimeout(t);
    };
    anchor.addEventListener("scroll", onUserScrollOnce, { passive: true, once: true });

    const onScroll = () => {
      try { window.sessionStorage.setItem(key, String(anchor.scrollTop)); } catch { /* ignore */ }
    };
    anchor.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelInitialScroll = true;
      anchor.removeEventListener("scroll", onScroll);
      anchor.removeEventListener("scroll", onUserScrollOnce);
    };
  }, [viewMode]);

  const [newEvent, setNewEvent] = useState({
    subject: "", startTime: "09:00", endTime: "10:00", attendees: "",
    location: "", description: "", isOnlineMeeting: false, isAllDay: false, categories: [] as string[],
  });

  // Eventos de cuentas añadidas (Google/Outlook adicional) son de solo lectura en este panel.
  const isGoogleEvent = !!selectedEventId && (selectedEventId.startsWith("google:") || selectedEventId.startsWith("outlook:"));
  const {
    data: eventDetail,
    isLoading: eventDetailLoading,
    isError: eventDetailFailed,
    error: eventDetailError,
  } = useEventDetail(isGoogleEvent ? null : selectedEventId);
  const updateEvent = useUpdateCalendarEvent();
  const { data: outlookCategories = [] } = useOutlookCategories();
  const [draggedEvent, setDraggedEvent] = useState<any>(null);

  const handleDrop = useCallback(
    (day: Date, slotMinutes: number) => {
      if (!draggedEvent) return;
      const startDt = parseEventTime(draggedEvent.start?.dateTime || draggedEvent.start?.date, new Date());
      const endDt = parseEventTime(draggedEvent.end?.dateTime || draggedEvent.end?.date, new Date(startDt.getTime() + 60 * 60 * 1000));
      const durationMs = endDt.getTime() - startDt.getTime();
      const newStartDate = format(day, "yyyy-MM-dd");
      const newStartHour = Math.floor(slotMinutes / 60);
      const newStartMin = slotMinutes % 60;
      const newStartTime = `${newStartHour.toString().padStart(2, "0")}:${newStartMin.toString().padStart(2, "0")}`;
      const newEndMs = new Date(`${newStartDate}T${newStartTime}:00`).getTime() + durationMs;
      const newEnd = new Date(newEndMs);
      updateEvent.mutate({
        eventId: draggedEvent.id,
        payload: {
          start: { dateTime: `${newStartDate}T${newStartTime}:00`, timeZone: CDMX_TZ },
          end: { dateTime: `${format(newEnd, "yyyy-MM-dd")}T${format(newEnd, "HH:mm")}:00`, timeZone: CDMX_TZ },
        },
      });
      setDraggedEvent(null);
    },
    [draggedEvent, updateEvent]
  );

  const [editForm, setEditForm] = useState({
    subject: "", startDate: "", startTime: "09:00", endDate: "", endTime: "10:00",
    location: "", description: "", categories: [] as string[], attendees: "",
  });

  const viewDays = useMemo(() => {
    switch (viewMode) {
      case "day": return [currentDate];
      case "3days": return eachDayOfInterval({ start: currentDate, end: addDays(currentDate, 2) });
      case "week": return eachDayOfInterval({
        start: startOfWeek(currentDate, { weekStartsOn: 1 }),
        end: endOfWeek(currentDate, { weekStartsOn: 1 }),
      });
      case "month": return [];
      default: return [];
    }
  }, [viewMode, currentDate]);

  const monthDays = useMemo(() => {
    if (viewMode !== "month") return [];
    const start = startOfMonth(currentDate);
    const end = endOfMonth(currentDate);
    return eachDayOfInterval({ start: startOfWeek(start, { weekStartsOn: 1 }), end: endOfWeek(end, { weekStartsOn: 1 }) });
  }, [viewMode, currentDate]);

  const rangeStart = useMemo(() => {
    if (viewMode === "month") return format(startOfMonth(currentDate), "yyyy-MM-dd");
    if (viewMode === "day" || viewMode === "agenda" || viewMode === "equipo") return format(currentDate, "yyyy-MM-dd");
    return format(viewDays[0] || currentDate, "yyyy-MM-dd");
  }, [viewMode, currentDate, viewDays]);

  const rangeEnd = useMemo(() => {
    if (viewMode === "month") return format(endOfMonth(currentDate), "yyyy-MM-dd");
    if (viewMode === "agenda") return format(addDays(currentDate, 30), "yyyy-MM-dd");
    if (viewMode === "day" || viewMode === "equipo") return format(addDays(currentDate, 1), "yyyy-MM-dd");
    const last = viewDays[viewDays.length - 1] || currentDate;
    return format(addDays(last, 1), "yyyy-MM-dd");
  }, [viewMode, currentDate, viewDays]);

  const rangeStartISO = useMemo(() => `${rangeStart}T00:00:00.000Z`, [rangeStart]);
  const rangeEndISO = useMemo(() => `${rangeEnd}T23:59:59.999Z`, [rangeEnd]);

  const { data: calendars = [] } = useCalendars();
  const visibleCalendarIds = useMemo(
    () => calendars.filter((c) => !hiddenCalendarIds.includes(c.id)).map((c) => c.id),
    [calendars, hiddenCalendarIds],
  );
  // Solo pasamos IDs si el usuario ocultó alguno; con todos visibles usamos la
  // vista por defecto (más barata) salvo que haya varios calendarios.
  const calendarIdsForQuery = useMemo(() => {
    if (calendars.length <= 1) return undefined;
    return visibleCalendarIds;
  }, [calendars, visibleCalendarIds]);

  const { data: eventsData, isLoading } = useCalendarEvents(rangeStartISO, rangeEndISO, calendarIdsForQuery);

  // Cuentas vinculadas (Microsoft/Google/IMAP) y sus eventos.
  const { data: linkedAccounts = [] } = useLinkedAccounts();
  const { connect: connectGoogle, isConnecting: googleConnecting, disconnect: disconnectGoogle } = useGoogleConnection();
  const { connect: connectOutlook, isConnecting: outlookConnecting, disconnect: disconnectOutlook } = useOutlookConnection();
  const renameAccount = useRenameLinkedAccount();
  const hasGoogle = linkedAccounts.some((a) => a.provider === "google" && a.status === "connected" && a.calendar_enabled);
  const hasOutlookLinked = linkedAccounts.some((a) => a.provider === "microsoft" && a.status === "connected" && a.calendar_enabled);
  const { data: googleEventsData } = useGoogleCalendarEvents(rangeStartISO, rangeEndISO, hasGoogle);
  const { data: googleCalendars = [] } = useGoogleCalendars(hasGoogle);
  const { data: outlookEventsData } = useOutlookAccountEvents(rangeStartISO, rangeEndISO, hasOutlookLinked);
  const { data: outlookCalendars = [] } = useOutlookAccountCalendars(hasOutlookLinked);
  // Nombre que el usuario asignó a cada cuenta (display_name) o su email.
  const accountLabelById = useMemo(() => {
    const m = new Map<string, string>();
    m.set(PRIMARY_MS_ID, primaryLabel);
    linkedAccounts.forEach((a) => m.set(a.id, a.display_name || a.email || (a.provider === "microsoft" ? "Outlook" : "Google")));
    return m;
  }, [linkedAccounts, primaryLabel]);
  // Color de una cuenta: override del usuario → default (teal para principal, hash para el resto).
  const accountColorForId = (id: string) => accountColors[id] || (id === PRIMARY_MS_ID ? PRIMARY_MS_COLOR : accountColorFor(id));

  // Categorías Kawiil (compartidas por org, aplicables a eventos de cualquier cuenta) y sus etiquetas.
  const { data: kawiilCategories = [] } = useCalendarCategories();
  const { data: eventTags = {} } = useEventTags();
  const createCategory = useCreateCalendarCategory();
  const updateCategory = useUpdateCalendarCategory();
  const deleteCategory = useDeleteCalendarCategory();
  const toggleEventTag = useToggleEventTag();
  const [newCategoryName, setNewCategoryName] = useState("");
  const [activeKawiilCatIds, setActiveKawiilCatIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try { return JSON.parse(window.localStorage.getItem("kawiil-cal-kawiilcat-filters") || "[]"); } catch { return []; }
  });
  useEffect(() => {
    try { window.localStorage.setItem("kawiil-cal-kawiilcat-filters", JSON.stringify(activeKawiilCatIds)); } catch { /* ignore */ }
  }, [activeKawiilCatIds]);

  // #2 — Preferencias en Supabase (siguen al usuario entre dispositivos).
  // localStorage es caché inmediata; la BD es la fuente de verdad al cargar.
  const { data: dbPrefs } = useCalendarPrefs();
  const savePrefs = useSaveCalendarPrefs();
  const prefsHydratedRef = useRef(false);
  useEffect(() => {
    if (prefsHydratedRef.current || !dbPrefs) return;
    prefsHydratedRef.current = true;
    if (Array.isArray(dbPrefs.hiddenCalendarIds)) setHiddenCalendarIds(dbPrefs.hiddenCalendarIds);
    if (dbPrefs.calendarColors) setCalendarColors(dbPrefs.calendarColors);
    if (dbPrefs.categoryColors) setCategoryColors(dbPrefs.categoryColors);
    if (dbPrefs.accountColors) setAccountColors(dbPrefs.accountColors);
    if (typeof dbPrefs.primaryName === "string") setPrimaryName(dbPrefs.primaryName);
    if (Array.isArray(dbPrefs.activeCategoryFilters)) setActiveCategoryFilters(dbPrefs.activeCategoryFilters);
    if (Array.isArray(dbPrefs.activeKawiilCatIds)) setActiveKawiilCatIds(dbPrefs.activeKawiilCatIds);
  }, [dbPrefs]);
  useEffect(() => {
    if (!prefsHydratedRef.current) return;
    const t = setTimeout(() => {
      savePrefs.mutate({
        hiddenCalendarIds, calendarColors, categoryColors, accountColors,
        primaryName, activeCategoryFilters, activeKawiilCatIds,
      });
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenCalendarIds, calendarColors, categoryColors, accountColors, primaryName, activeCategoryFilters, activeKawiilCatIds]);

  const categoryById = useMemo(() => {
    const m = new Map<string, { name: string; color: string }>();
    kawiilCategories.forEach((c) => m.set(c.id, { name: c.name, color: c.color }));
    return m;
  }, [kawiilCategories]);
  const eventCategoryChips = (eventId?: string | null) =>
    ((eventId && eventTags[eventId]) || []).map((cid) => categoryById.get(cid)).filter(Boolean) as Array<{ name: string; color: string }>;

  const allEvents = useMemo(() => {
    const m365 = Array.isArray(eventsData) ? eventsData : [];
    const google = Array.isArray(googleEventsData) ? googleEventsData : [];
    const outlook = Array.isArray(outlookEventsData) ? outlookEventsData : [];
    return [...m365, ...google, ...outlook];
  }, [eventsData, googleEventsData, outlookEventsData]);

  const events = useMemo(() => {
    return allEvents.filter((e: any) => {
      // Ocultar por calendario (M365 se filtra en el servidor; Google, aquí por calendarId).
      if (e.calendarId && hiddenCalendarIds.includes(e.calendarId)) return false;
      // Filtro por etiquetas Kawiil (aplican a eventos de cualquier cuenta).
      if (activeKawiilCatIds.length > 0) {
        const tags = eventTags[e.id] || [];
        if (!tags.some((t) => activeKawiilCatIds.includes(t))) return false;
      }
      // Filtro por categorías nativas de Outlook.
      if (activeCategoryFilters.length > 0) {
        const cats: string[] = Array.isArray(e.categories) ? e.categories : [];
        if (cats.length === 0) return false;
        return cats.some((c) => activeCategoryFilters.includes(c));
      }
      return true;
    });
  }, [allEvents, activeCategoryFilters, hiddenCalendarIds, activeKawiilCatIds, eventTags]);
  const createEvent = useCreateCalendarEvent();
  const deleteEvent = useDeleteCalendarEvent();

  const { data: kawiilTasks = [] } = useTasksForCalendar(rangeStart, rangeEnd);

  // #3 — Ubicación/estatus de trabajo por día del usuario actual.
  const { user: authUser } = useAuth();
  const { data: workLocations = [] } = useWorkLocations(rangeStart, rangeEnd);
  const myWorkByDate = useMemo(() => {
    const m = new Map<string, (typeof workLocations)[number]>();
    workLocations.forEach((w) => { if (w.user_id === authUser?.id) m.set(w.date, w); });
    return m;
  }, [workLocations, authUser?.id]);

  // #4 — Disponibilidad del equipo para el día seleccionado (vista "Equipo").
  const teamDayYmd = useMemo(() => format(currentDate, "yyyy-MM-dd"), [currentDate]);
  const { data: teamAvailability = [], isLoading: teamLoading } = useTeamAvailability(
    `${teamDayYmd}T00:00:00`, `${teamDayYmd}T23:59:59`, viewMode === "equipo",
  );
  const workByUserForDay = useMemo(() => {
    const m = new Map<string, (typeof workLocations)[number]>();
    workLocations.forEach((w) => { if (w.date === teamDayYmd) m.set(w.user_id, w); });
    return m;
  }, [workLocations, teamDayYmd]);

  const calendarById = useMemo(() => {
    const m = new Map<string, { name: string; color: string; hexColor?: string }>();
    calendars.forEach((c, i) => m.set(c.id, { name: c.name, color: calendarAccentColor(c.id, i), hexColor: c.hexColor }));
    googleCalendars.forEach((c) => m.set(c.id, { name: c.name, color: accountColorForId(c._accountId), hexColor: c.hexColor }));
    outlookCalendars.forEach((c) => m.set(c.id, { name: c.name, color: accountColorForId(c._accountId), hexColor: c.hexColor }));
    return m;
  }, [calendars, googleCalendars, outlookCalendars, accountColors]);
  const showCalendarColors = calendars.length > 1 || hasGoogle || hasOutlookLinked;
  // Color de un calendario: 1) override del usuario, 2) color real (Outlook/Google), 3) hash de respaldo.
  const calendarColorFor = (id?: string | null) => {
    if (!id) return undefined;
    if (calendarColors[id]) return calendarColors[id];
    const cal = calendarById.get(id);
    const hx = cal?.hexColor;
    return (hx && /^#[0-9a-fA-F]{6}$/.test(hx) ? hx : undefined) || cal?.color || calendarAccentColor(id);
  };
  // Acento del evento = color de la CUENTA de origen (para identificar de dónde viene),
  // salvo que el usuario haya fijado un color específico para ese calendario.
  const eventAccentColor = (event: any): string | undefined => {
    if (event?.calendarId && calendarColors[event.calendarId]) return calendarColors[event.calendarId];
    const accId = linkedAccountIdFromCalendarId(event?.calendarId);
    return accId ? accountColorForId(accId) : accountColorForId(PRIMARY_MS_ID);
  };
  // Color de una categoría: override del usuario o color determinista de la paleta.
  const categoryColorFor = (name?: string | null) => categoryColors[name || ""] || paletteColorFor(name);
  const calendarNameFor = (event: any) =>
    (event?.calendarId ? calendarById.get(event.calendarId)?.name : null) || event?.calendarName || null;
  const toggleCalendar = (id: string) => {
    setHiddenCalendarIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  // Al quitar una cuenta añadida, limpiar sus calendarios ocultos para no dejar basura.
  const disconnectLinkedAccount = (accountId: string, provider: "google" | "microsoft") => {
    setHiddenCalendarIds((prev) => prev.filter((id) => linkedAccountIdFromCalendarId(id) !== accountId));
    if (provider === "google") disconnectGoogle(accountId);
    else disconnectOutlook(accountId);
  };

  // Calendarios agrupados por cuenta para el panel (Microsoft principal + cada cuenta añadida).
  const calendarGroups = useMemo(() => {
    const groups: Array<{ key: string; label: string; color?: string; items: Array<{ id: string; name: string; isDefaultCalendar?: boolean }> }> = [];
    if (calendars.length > 0) {
      groups.push({ key: "microsoft", label: primaryLabel, color: accountColorForId(PRIMARY_MS_ID), items: calendars.map((c) => ({ id: c.id, name: c.name, isDefaultCalendar: c.isDefaultCalendar })) });
    }
    linkedAccounts.filter((a) => a.provider === "google").forEach((acc) => {
      const items = googleCalendars.filter((c) => c._accountId === acc.id).map((c) => ({ id: c.id, name: c.name, isDefaultCalendar: c.isDefaultCalendar }));
      if (items.length > 0) groups.push({ key: acc.id, label: accountLabelById.get(acc.id) || "Google", color: accountColorForId(acc.id), items });
    });
    linkedAccounts.filter((a) => a.provider === "microsoft").forEach((acc) => {
      const items = outlookCalendars.filter((c) => c._accountId === acc.id).map((c) => ({ id: c.id, name: c.name, isDefaultCalendar: c.isDefaultCalendar }));
      if (items.length > 0) groups.push({ key: acc.id, label: accountLabelById.get(acc.id) || "Outlook", color: accountColorForId(acc.id), items });
    });
    return groups;
  }, [calendars, googleCalendars, outlookCalendars, linkedAccounts, accountLabelById, primaryLabel, accountColors]);

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
      const attendeesStr = (source.attendees || []).map((a: any) => a.emailAddress?.address).filter(Boolean).join(", ");
      setEditForm({
        subject: source.subject ?? "", startDate: formatMX(parsedStart, "yyyy-MM-dd"),
        startTime: formatMX(parsedStart, "HH:mm"), endDate: formatMX(parsedEnd, "yyyy-MM-dd"),
        endTime: formatMX(parsedEnd, "HH:mm"), location: source.location?.displayName ?? "",
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
  const goToday = () => {
    setCurrentDate(new Date());
    window.setTimeout(() => {
      const anchor = scrollAreaRef.current;
      const indicator = nowIndicatorRef.current;
      if (!anchor || !indicator) return;
      const containerRect = anchor.getBoundingClientRect();
      const indicatorRect = indicator.getBoundingClientRect();
      const top = Math.max(0, anchor.scrollTop + (indicatorRect.top - containerRect.top) - anchor.clientHeight / 3);
      anchor.scrollTo({ top, behavior: "smooth" });
    }, 80);
  };

  const eventsByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    (Array.isArray(events) ? events : []).forEach((e: any) => {
      try {
        const rawStart = e?.start?.dateTime || e?.start?.date;
        if (!rawStart) return;
        const parsedStart = parseEventTime(rawStart);
        if (isNaN(parsedStart.getTime())) return;
        const dateKey = formatMX(parsedStart, "yyyy-MM-dd");
        const isAllDay = e.isAllDay === true || (!!e.start?.date && !e.start?.dateTime);
        if (!map.has(dateKey)) map.set(dateKey, []);
        map.get(dateKey)!.push({ ...e, _parsedStart: parsedStart, _isAllDay: isAllDay, _type: "outlook" });
      } catch { /* skip invalid */ }
    });
    map.forEach((evts) => evts.sort((a: any, b: any) => (a._parsedStart?.getTime() ?? 0) - (b._parsedStart?.getTime() ?? 0)));
    return map;
  }, [events]);

  const tasksByDate = useMemo(() => {
    const map = new Map<string, any[]>();
    if (!showKawiilTasks) return map;
    kawiilTasks.forEach((task: any) => {
      const dateKey = taskDueDateKey(task.due_date);
      if (!dateKey) return;
      if (!map.has(dateKey)) map.set(dateKey, []);
      map.get(dateKey)!.push(task);
    });
    return map;
  }, [kawiilTasks, showKawiilTasks]);

  const getEventsForDay = (date: Date) => eventsByDate.get(format(date, "yyyy-MM-dd")) || [];
  const getAllDayEventsForDay = (date: Date) => getEventsForDay(date).filter((e: any) => e._isAllDay);
  const getTasksForDay = (date: Date) => tasksByDate.get(format(date, "yyyy-MM-dd")) || [];

  // Today's agenda for sidebar
  const todayEvents = getEventsForDay(new Date());
  const todayTasks = getTasksForDay(new Date());
  const upcomingTasks = kawiilTasks.filter((t: any) => {
    const dk = taskDueDateKey(t.due_date);
    if (!dk) return false;
    const d = differenceInDays(parseISO(dk), new Date());
    return d >= 0 && d <= 7;
  }).slice(0, 8);

  const handleCreateEvent = () => {
    if (!newEvent.subject) return;
    const dateStr = format(selectedDate, "yyyy-MM-dd");
    const attendees = newEvent.attendees.split(",").map((s) => s.trim()).filter(Boolean).map((address) => ({ emailAddress: { address }, type: "required" }));
    const nextDayStr = format(addDays(selectedDate, 1), "yyyy-MM-dd");

    const baseEvent: any = newEvent.isAllDay
      ? { subject: newEvent.subject, isAllDay: true, start: { dateTime: `${dateStr}T00:00:00`, timeZone: CDMX_TZ }, end: { dateTime: `${nextDayStr}T00:00:00`, timeZone: CDMX_TZ } }
      : { subject: newEvent.subject, start: { dateTime: `${dateStr}T${newEvent.startTime}:00`, timeZone: CDMX_TZ }, end: { dateTime: `${dateStr}T${newEvent.endTime}:00`, timeZone: CDMX_TZ } };

    if (newEvent.description.trim()) baseEvent.body = { contentType: "html", content: newEvent.description.trim() };
    if (newEvent.location.trim()) baseEvent.location = { displayName: newEvent.location.trim() };
    if (attendees.length > 0) baseEvent.attendees = attendees;
    if (newEvent.isOnlineMeeting) { baseEvent.isOnlineMeeting = true; baseEvent.onlineMeetingProvider = "teamsForBusiness"; }
    if (newEvent.categories.length > 0) baseEvent.categories = newEvent.categories;

    createEvent.mutate(baseEvent, {
      onSuccess: () => {
        setShowCreate(false);
        setNewEvent({ subject: "", startTime: "09:00", endTime: "10:00", attendees: "", location: "", description: "", isOnlineMeeting: false, isAllDay: false, categories: [] });
      },
    });
  };

  const handleUpdateEvent = () => {
    if (!selectedEventId) return;
    const attendees = editForm.attendees.split(",").map((s) => s.trim()).filter(Boolean).map((address) => ({ emailAddress: { address }, type: "required" }));
    const payload: any = {
      subject: editForm.subject,
      start: { dateTime: `${editForm.startDate}T${editForm.startTime}:00`, timeZone: CDMX_TZ },
      end: { dateTime: `${editForm.endDate}T${editForm.endTime}:00`, timeZone: CDMX_TZ },
      location: editForm.location.trim() ? { displayName: editForm.location.trim() } : undefined,
      body: editForm.description.trim() ? { contentType: "html", content: editForm.description.trim() } : undefined,
      categories: editForm.categories,
      attendees: attendees.length > 0 ? attendees : undefined,
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
    updateEvent.mutate({ eventId: selectedEventId, payload }, { onSuccess: () => setSelectedEventId(null) });
  };

  const toggleEditCategory = (name: string) => {
    setEditForm((prev) => ({ ...prev, categories: prev.categories.includes(name) ? prev.categories.filter((c) => c !== name) : [...prev.categories, name] }));
  };
  const toggleNewEventCategory = (name: string) => {
    setNewEvent((prev) => ({ ...prev, categories: prev.categories.includes(name) ? prev.categories.filter((c) => c !== name) : [...prev.categories, name] }));
  };

  const headerLabel = useMemo(() => {
    switch (viewMode) {
      case "day": return format(currentDate, "EEEE d 'de' MMMM, yyyy", { locale: es });
      case "3days": return `${format(currentDate, "d MMM", { locale: es })} – ${format(addDays(currentDate, 2), "d MMM yyyy", { locale: es })}`;
      case "week": {
        const ws = startOfWeek(currentDate, { weekStartsOn: 1 });
        const we = endOfWeek(currentDate, { weekStartsOn: 1 });
        return `${format(ws, "d MMM", { locale: es })} – ${format(we, "d MMM yyyy", { locale: es })}`;
      }
      case "month": return format(currentDate, "MMMM yyyy", { locale: es });
      case "agenda": return `Agenda · desde ${format(currentDate, "d MMM", { locale: es })}`;
      case "equipo": return `Equipo · ${format(currentDate, "EEEE d 'de' MMMM", { locale: es })}`;
    }
  }, [viewMode, currentDate]);

  const headerLabelShort = useMemo(() => {
    switch (viewMode) {
      case "day": return format(currentDate, "EEE d MMM", { locale: es });
      case "3days": return `${format(currentDate, "d")} – ${format(addDays(currentDate, 2), "d MMM", { locale: es })}`;
      case "week": {
        const ws = startOfWeek(currentDate, { weekStartsOn: 1 });
        const we = endOfWeek(currentDate, { weekStartsOn: 1 });
        return `${format(ws, "d")} – ${format(we, "d MMM", { locale: es })}`;
      }
      case "month": return format(currentDate, "MMM yyyy", { locale: es });
      case "agenda": return `Agenda · ${format(currentDate, "d MMM", { locale: es })}`;
      case "equipo": return `Equipo · ${format(currentDate, "EEE d MMM", { locale: es })}`;
    }
  }, [viewMode, currentDate]);

  const colCount = viewMode === "month" ? 7 : viewDays.length;

  const getMinWidth = () => {
    switch (viewMode) {
      case "day": return "w-full";
      case "3days": return "min-w-[420px]";
      case "week": return "min-w-[560px]";
      default: return "";
    }
  };

  const todayAgendaCard = (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Hoy · {format(new Date(), "d MMM", { locale: es })}</p>
      {todayEvents.length === 0 && todayTasks.length === 0 ? (
        <p className="text-xs text-muted-foreground py-1">Sin eventos ni tareas para hoy</p>
      ) : (
        <div className="space-y-1">
          {todayEvents.filter((e: any) => !e._isAllDay).slice(0, 5).map((event: any) => {
            const time = formatMX(event._parsedStart, "HH:mm");
            return (
              <button key={event.id} className="w-full flex items-start gap-2 p-1.5 rounded-md hover:bg-accent/50 text-left transition-colors"
                onClick={() => setSelectedEventId(event.id)}>
                <div className="h-1.5 w-1.5 rounded-full bg-primary mt-1.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate">{event.subject}</p>
                  <p className="text-[11px] text-muted-foreground">{time}</p>
                </div>
              </button>
            );
          })}
          {todayTasks.slice(0, 5).map((task: any) => (
            <Link
              key={task.id}
              to={taskDetailHref(task.id)}
              className="flex items-start gap-2 p-1.5 rounded-md bg-amber-50/50 dark:bg-amber-900/10 hover:bg-amber-100/70 dark:hover:bg-amber-900/25 transition-colors text-left w-full"
            >
              <div className={cn("h-1.5 w-1.5 rounded-full mt-1.5 shrink-0", PRIORITY_COLORS[task.priority] || "bg-amber-400")} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate underline-offset-2 hover:underline">{task.title}</p>
                {task.clients?.name && <p className="text-[11px] text-muted-foreground">{task.clients.name}</p>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );

  const upcomingTasksCard =
    showKawiilTasks && upcomingTasks.length > 0 ? (
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Próximos vencimientos</p>
        <div className="space-y-1">
          {upcomingTasks.map((task: any) => {
            const daysLeft = differenceInDays(parseISO(task.due_date), new Date());
            const urgencyColor = daysLeft === 0 ? "text-red-600" : daysLeft <= 2 ? "text-amber-600" : "text-muted-foreground";
            return (
              <Link key={task.id} to={taskDetailHref(task.id)} className="flex items-start gap-2 py-1.5 rounded-md hover:bg-accent/40 transition-colors -mx-1 px-1 text-left">
                <div className={cn("h-1.5 w-1.5 rounded-full mt-1.5 shrink-0", PRIORITY_COLORS[task.priority] || "bg-amber-400")} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground truncate underline-offset-2 hover:underline">{task.title}</p>
                  <div className="flex items-center gap-2">
                    {task.clients?.name && <span className="text-[11px] text-muted-foreground truncate">{task.clients.name}</span>}
                    <span className={cn("text-[11px] shrink-0", urgencyColor)}>
                      {daysLeft === 0 ? "Hoy" : daysLeft === 1 ? "Mañana" : `${daysLeft}d`}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    ) : null;

  return (
    <div className="flex flex-col h-full min-h-0 bg-card animate-fade-in">
      {/* TOP BAR */}
      <div className="shrink-0 flex items-center border-b border-border/50 bg-card/80 backdrop-blur-sm min-h-[44px] px-1 gap-0 overflow-x-auto">
        {/* Navigation: prev, today, next */}
        <button onClick={goPrev} className="h-[30px] w-[30px] rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground shrink-0 ml-1">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button onClick={goToday} className="h-[30px] px-2.5 rounded-md text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground shrink-0">
          Hoy
        </button>
        <button onClick={goNext} className="h-[30px] w-[30px] rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground shrink-0">
          <ChevronRight className="h-4 w-4" />
        </button>

        {/* Title */}
        <span className="ml-2 text-[13px] font-semibold text-foreground capitalize shrink-0 mr-1">
          <span className="hidden sm:inline">{headerLabel}</span>
          <span className="sm:hidden">{headerLabelShort}</span>
        </span>
        {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}

        {/* View mode tabs */}
        {!isMobile && (
          <div className="flex items-center ml-2 shrink-0">
            {(["day", "3days", "week", "month", "agenda", "equipo"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setViewMode(v)}
                className={cn(
                  "h-11 flex items-center px-3 text-[12.5px] font-medium border-b-2 transition-colors whitespace-nowrap",
                  viewMode === v
                    ? "text-foreground border-b-foreground font-semibold"
                    : "text-muted-foreground border-b-transparent hover:text-foreground"
                )}
              >
                {v === "day" ? "Día" : v === "3days" ? "3 Días" : v === "week" ? "Semana" : v === "month" ? "Mes" : v === "agenda" ? "Agenda" : "Equipo"}
              </button>
            ))}
          </div>
        )}

        {/* Right actions */}
        <div className="ml-auto flex items-center gap-0.5 pr-2 shrink-0">
          <label className="hidden md:flex items-center gap-1.5 text-[12px] cursor-pointer mr-1.5 text-muted-foreground">
            <Switch checked={showKawiilTasks} onCheckedChange={setShowKawiilTasks} className="scale-75 origin-right" />
            <span>Tareas</span>
          </label>
          <button
            onClick={() => { setSelectedDate(new Date()); setShowCreate(true); }}
            className="h-[30px] flex items-center gap-1.5 px-3 rounded-md bg-primary text-primary-foreground text-[12px] font-semibold hover:bg-primary/90 transition-colors shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Evento</span>
          </button>
          <button
            onClick={() => setRightPanelOpen((v) => !v)}
            className="h-[30px] w-[30px] rounded-md flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
            title={rightPanelOpen ? "Ocultar panel" : "Mostrar panel"}
          >
            {rightPanelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* BODY: calendar grid + right panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Calendar area */}
        <div ref={scrollAreaRef} className="flex-1 min-w-0 overflow-y-auto overflow-x-auto">
          {isMobile && (
            <div className="p-3 space-y-3">
              {todayAgendaCard}
              {upcomingTasksCard}
            </div>
          )}

          {/* Day/3days/Week grid */}
          {viewMode !== "month" && viewMode !== "agenda" && viewMode !== "equipo" && (
            <div className={getMinWidth()}>
                {/* Cabecera fija: fechas + "Todo el día" quedan visibles al hacer scroll */}
                <div className="sticky top-0 z-20 bg-card shadow-sm">
                {/* Day headers */}
                <div className="grid border-b border-border"
                  style={{ gridTemplateColumns: `56px repeat(${colCount}, 1fr)` }}>
                  <div className="p-2 text-[10px] text-muted-foreground text-center border-r border-border flex items-center justify-center">
                    CDMX
                  </div>
                  {viewDays.map((day) => {
                    const dayTaskCount = getTasksForDay(day).length;
                    const heat: "free" | "light" | "med" | "heavy" =
                      dayTaskCount === 0
                        ? "free"
                        : dayTaskCount <= 2
                          ? "light"
                          : dayTaskCount <= 4
                            ? "med"
                            : "heavy";
                    const heatClasses: Record<typeof heat, string> = {
                      free: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
                      light: "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300",
                      med: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
                      heavy: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
                    };
                    return (
                      <div key={day.toISOString()} className={cn("p-2 text-center border-r border-border last:border-r-0 cursor-pointer hover:bg-muted/50 transition-colors", isToday(day) && "bg-primary/10")}
                        onClick={() => { setSelectedDate(day); setShowCreate(true); }}>
                        <div className="text-xs text-muted-foreground capitalize">{format(day, "EEE", { locale: es })}</div>
                        <div className={cn("text-sm font-medium", isToday(day) ? "text-primary" : "")}>{format(day, "d")}</div>
                        {showKawiilTasks && (
                          <Badge variant="secondary" className={cn("h-4 px-1.5 text-[9px] mt-0.5 border-0", heatClasses[heat])}>
                            {dayTaskCount === 0
                              ? "libre"
                              : `${dayTaskCount} tarea${dayTaskCount > 1 ? "s" : ""}`}
                          </Badge>
                        )}
                        <div className="mt-1 flex justify-center" onClick={(e) => e.stopPropagation()}>
                          <WorkLocationChip date={format(day, "yyyy-MM-dd")} entry={myWorkByDate.get(format(day, "yyyy-MM-dd"))} compact />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* All-day events + tasks */}
                <div className="grid border-b border-border bg-muted/20"
                  style={{ gridTemplateColumns: `56px repeat(${colCount}, 1fr)` }}>
                  <div className="text-[11px] text-muted-foreground text-right pr-2 border-r border-border py-1.5 leading-none">
                    Todo el día
                  </div>
                  {viewDays.map((day) => {
                    const allDayEvents = getAllDayEventsForDay(day);
                    const dayTasks = showKawiilTasks ? getTasksForDay(day) : [];
                    return (
                      <div key={day.toISOString() + "-allday"} className="border-r border-border last:border-r-0 px-1 py-1 space-y-0.5 overflow-hidden">
                        {allDayEvents.map((event: any) => (
                          <div key={event.id}
                            className="bg-primary/20 text-primary rounded px-1.5 py-0.5 text-[11px] truncate group relative cursor-pointer hover:bg-primary/30 transition-colors"
                            title={event.subject} onClick={() => setSelectedEventId(event.id)}>
                            <span className="font-medium">{event.subject}</span>
                          </div>
                        ))}
                        {dayTasks.map((task: any) => (
                          <Link
                            key={task.id}
                            to={taskDetailHref(task.id)}
                            className="flex items-center gap-1 bg-amber-500/15 text-amber-700 dark:text-amber-300 rounded px-1.5 py-0.5 text-[11px] truncate cursor-pointer hover:bg-amber-500/25 dark:hover:bg-amber-500/25 transition-colors underline-offset-1 hover:underline"
                            title={`Tarea: ${task.title}${task.clients?.name ? ` — ${task.clients.name}` : ""}`}
                          >
                            <CheckSquare className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{task.title}</span>
                          </Link>
                        ))}
                      </div>
                    );
                  })}
                </div>
                </div>

                {/* Time grid */}
                {(() => {
                  const nowMinutes = now.getHours() * 60 + now.getMinutes();
                  const dayStartMin = START_HOUR * 60;
                  const dayEndMin = END_HOUR * 60;
                  const showNow = viewDays.some((d) => isToday(d));
                  const clampedMinutes = Math.max(dayStartMin, Math.min(nowMinutes, dayEndMin));
                  const nowTop = ((clampedMinutes - dayStartMin) / SLOT_MINUTES) * SLOT_HEIGHT;
                  const nowLabel = `${now.getHours().toString().padStart(2, "0")}:${now
                    .getMinutes()
                    .toString()
                    .padStart(2, "0")}`;
                  return (
                    <div className="grid border-t border-border relative" style={{ gridTemplateColumns: `56px repeat(${colCount}, 1fr)` }}>
                      {showNow && (
                        <div
                          ref={nowIndicatorRef}
                          className="pointer-events-none absolute z-10 flex items-center"
                          style={{ top: nowTop - 10, left: 48, right: 0, height: 20 }}
                          aria-label={`Hora actual: ${nowLabel}`}
                        >
                          <span className="relative inline-flex items-center justify-center shrink-0">
                            <span className="absolute inline-flex h-4 w-4 rounded-full bg-red-500/25 motion-safe:animate-ping" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500 ring-2 ring-card shadow-sm" />
                          </span>
                          <span className="ml-1 inline-flex items-center rounded-full bg-card border border-red-500 text-red-600 dark:text-red-400 px-1.5 py-[1px] text-[10px] font-semibold shadow-sm leading-none shrink-0">
                            {nowLabel}
                          </span>
                          <span className="flex-1 h-[2px] bg-red-500/70 ml-1 shadow-[0_0_4px_rgba(239,68,68,0.35)]" />
                        </div>
                      )}
                      <div className="border-r border-border">
                        {TIME_SLOTS.map((slotMinutes) => (
                          <div key={slotMinutes} className="text-[11px] text-muted-foreground text-right pr-2 border-b border-border pt-1 leading-none"
                            style={{ height: `${SLOT_HEIGHT}px` }}>{minutesToLabel(slotMinutes)}</div>
                        ))}
                      </div>

                      {viewDays.map((day) => {
                        const dayEvents = getEventsForDay(day).filter((e: any) => !e._isAllDay);
                        const dayIsToday = isToday(day);
                        const pastHeight = dayIsToday
                          ? Math.max(0, Math.min(nowTop, (END_HOUR - START_HOUR) * (60 / SLOT_MINUTES) * SLOT_HEIGHT))
                          : 0;
                        return (
                          <div key={day.toISOString() + "-column"} className={cn(
                            "relative border-r border-border last:border-r-0 cursor-pointer hover:bg-muted/10",
                            dayIsToday && "bg-primary/[0.03]"
                          )}
                            onClick={() => { setSelectedDate(day); setShowCreate(true); }}>
                            {dayIsToday && pastHeight > 0 && (
                              <div
                                aria-hidden
                                className="pointer-events-none absolute inset-x-0 top-0 bg-muted/40 dark:bg-muted/15"
                                style={{ height: pastHeight }}
                              />
                            )}
                            {TIME_SLOTS.map((slotMinutes) => (
                              <div key={slotMinutes} className="border-b border-border/60 last:border-b-0 transition-colors duration-100 relative"
                                style={{ height: `${SLOT_HEIGHT}px` }}
                                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; e.currentTarget.classList.add("bg-primary/20"); }}
                                onDragLeave={(e) => e.currentTarget.classList.remove("bg-primary/20")}
                                onDrop={(e) => { e.preventDefault(); e.currentTarget.classList.remove("bg-primary/20"); handleDrop(day, slotMinutes); }}
                              />
                            ))}

                            {layoutDayEvents(dayEvents).map(({ event, startMin, endMin, col, cols }) => {
                              const endDt = event.end?.dateTime ? parseEventTime(event.end.dateTime) : null;
                              const dayStart = START_HOUR * 60;
                              const dayEnd = END_HOUR * 60;
                              const clampedStart = Math.max(startMin, dayStart);
                              const clampedEnd = Math.min(endMin, dayEnd);
                              if (clampedEnd <= clampedStart) return null;

                              const top = ((clampedStart - dayStart) / SLOT_MINUTES) * SLOT_HEIGHT + 2;
                              const height = Math.max(SLOT_HEIGHT, ((clampedEnd - clampedStart) / SLOT_MINUTES) * SLOT_HEIGHT - 4);
                              const widthPct = 100 / cols;
                              const leftPct = col * widthPct;
                              const startStr = formatMX(event._parsedStart, "HH:mm");
                              const endStr = endDt ? formatMX(endDt, "HH:mm") : "";
                              const primaryCategory: string | undefined = event.categories?.[0];
                              const catHex = primaryCategory ? categoryColorFor(primaryCategory) : undefined;
                              const meetingUrl = event.onlineMeeting?.joinUrl || event.onlineMeetingUrl;
                              const accent = showCalendarColors ? eventAccentColor(event) : undefined;
                              // Contenido adaptativo según la altura del evento (evita recortes ilegibles):
                              // compacto = eventos cortos (~30 min) → solo el título.
                              const compact = height < 46;
                              const showLocation = height >= 64 && !!event.location?.displayName;
                              const innerStyle: Record<string, string | number> = {};
                              if (catHex) { innerStyle.backgroundColor = hexAlpha(catHex, 0.15); innerStyle.borderColor = hexAlpha(catHex, 0.45); }
                              if (accent) { innerStyle.borderLeftWidth = 3; innerStyle.borderLeftColor = accent; }
                              const catChips = eventCategoryChips(event.id);

                              return (
                                <div key={event.id} className={cn("absolute px-0.5", draggedEvent?.id === event.id && "opacity-40")}
                                  style={{ top, height, left: `${leftPct}%`, width: `${widthPct}%` }} draggable
                                  onDragStart={(e) => { e.stopPropagation(); setDraggedEvent(event); e.dataTransfer.effectAllowed = "move"; }}
                                  onDragEnd={() => setDraggedEvent(null)}>
                                  <div style={innerStyle}
                                    className={cn("h-full rounded-md px-1.5 py-0.5 text-xs overflow-hidden group relative shadow-sm cursor-grab active:cursor-grabbing transition-all duration-150 hover:shadow-md border",
                                    catHex ? "text-foreground" : "bg-primary/15 text-primary border-primary/20")}
                                    title={`${startStr}${endStr ? " - " + endStr : ""} ${event.subject}`}
                                    onClick={(e) => { e.stopPropagation(); setSelectedEventId(event.id); }}>
                                    <div className="flex items-start gap-1 h-full pr-3">
                                      <div className="flex-1 min-w-0">
                                        {compact ? (
                                          <div className="font-semibold leading-[1.15] break-words line-clamp-2">
                                            <span className="font-normal opacity-70 mr-1">{startStr}</span>{event.subject}
                                            {catChips.map((c, i) => (
                                              <span key={i} className="ml-1 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: c.color }} title={c.name} />
                                            ))}
                                          </div>
                                        ) : (
                                          <>
                                            <div className="text-[10px] opacity-70 leading-tight">{endStr ? `${startStr}–${endStr}` : startStr}</div>
                                            <div className="font-semibold leading-[1.15] break-words line-clamp-3">{event.subject}</div>
                                            {showLocation && <div className="text-[9px] opacity-70 truncate mt-0.5">{event.location.displayName}</div>}
                                            {catChips.length > 0 && (
                                              <div className="flex items-center gap-0.5 mt-0.5 flex-wrap">
                                                {catChips.map((c, i) => (
                                                  <span key={i} className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} title={c.name} />
                                                ))}
                                              </div>
                                            )}
                                          </>
                                        )}
                                      </div>
                                      {meetingUrl && (
                                        <button type="button" className="ml-auto p-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                                          onClick={(e) => { e.stopPropagation(); window.open(meetingUrl, "_blank"); }} title="Unirse a reunión">
                                          <Video className="h-3 w-3" />
                                        </button>
                                      )}
                                    </div>
                                    <button className="absolute right-0.5 top-0.5 opacity-0 group-hover:opacity-100 transition-opacity p-0.5"
                                      onClick={(e) => { e.stopPropagation(); deleteEvent.mutate(event.id); }}>
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
                  );
                })()}
            </div>
          )}

          {/* Monthly view */}
          {viewMode === "month" && (
            <div>
              <div className="grid grid-cols-7 border-b border-border">
                {[
                  { short: "Lun", letter: "L" },
                  { short: "Mar", letter: "M" },
                  { short: "Mié", letter: "X" },
                  { short: "Jue", letter: "J" },
                  { short: "Vie", letter: "V" },
                  { short: "Sáb", letter: "S" },
                  { short: "Dom", letter: "D" },
                ].map(({ short, letter }) => (
                  <div key={short} className="py-1.5 px-0.5 text-xs text-muted-foreground text-center font-medium">
                    <span className="hidden sm:inline">{short}</span>
                    <span className="sm:hidden">{letter}</span>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {monthDays.map((day) => {
                  const dayEvents = getEventsForDay(day);
                  const dayTasks = showKawiilTasks ? getTasksForDay(day) : [];
                  const inMonth = isSameMonth(day, currentDate);
                  const allItems = [...dayEvents.slice(0, 2), ...dayTasks.slice(0, 2)];
                  const totalExtra = dayEvents.length + dayTasks.length - allItems.length;
                  return (
                    <div key={day.toISOString()} className={cn("h-[75px] sm:h-[95px] md:h-[110px] border-b border-r border-border p-0.5 sm:p-1 cursor-pointer hover:bg-muted/30 transition-colors overflow-hidden",
                      !inMonth && "bg-muted/15", isToday(day) && "bg-primary/5")}
                      onClick={() => { setSelectedDate(day); setShowCreate(true); }}>
                      <div className={cn("text-[10px] sm:text-xs mb-0.5 sm:mb-1", isToday(day) ? "text-primary font-bold" : inMonth ? "text-foreground" : "text-muted-foreground")}>
                        {format(day, "d")}
                      </div>
                      <div className="space-y-0.5">
                        {dayEvents.slice(0, isMobile ? 1 : 2).map((event: any) => {
                          const time = event._parsedStart ? formatMX(event._parsedStart, "HH:mm") : "";
                          return (
                            <div key={event.id} className="bg-primary/15 text-primary rounded px-1 py-0.5 text-[9px] sm:text-[10px] truncate cursor-pointer hover:bg-primary/25 transition-colors"
                              onClick={(e) => { e.stopPropagation(); setSelectedEventId(event.id); }}>
                              <span className="hidden sm:inline">{time && <span className="font-medium mr-1">{time}</span>}</span>{event.subject}
                            </div>
                          );
                        })}
                        {!isMobile && dayTasks.slice(0, 2).map((task: any) => (
                          <Link
                            key={task.id}
                            to={taskDetailHref(task.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-0.5 bg-amber-500/15 text-amber-700 dark:text-amber-300 rounded px-1 py-0.5 text-[9px] sm:text-[10px] truncate hover:bg-amber-500/25 transition-colors underline-offset-1 hover:underline"
                          >
                            <CheckSquare className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate">{task.title}</span>
                          </Link>
                        ))}
                        {totalExtra > 0 && <div className="text-[9px] sm:text-[10px] text-muted-foreground pl-0.5 sm:pl-1">+{totalExtra}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Agenda (lista cronológica) */}
          {viewMode === "agenda" && (
            <div className="max-w-3xl mx-auto p-3 sm:p-4">
              {(() => {
                const days = eachDayOfInterval({ start: currentDate, end: addDays(currentDate, 30) });
                const rows = days
                  .map((day) => ({
                    day,
                    events: getEventsForDay(day),
                    tasks: showKawiilTasks ? getTasksForDay(day) : [],
                  }))
                  .filter((r) => r.events.length > 0 || r.tasks.length > 0);

                if (rows.length === 0) {
                  return (
                    <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                      <CalendarDays className="h-8 w-8 text-muted-foreground/50" />
                      <p className="text-sm text-muted-foreground">Sin eventos ni actividades en los próximos 30 días.</p>
                    </div>
                  );
                }

                return (
                  <div className="space-y-4">
                    {rows.map(({ day, events: dayEvts, tasks: dayTasks }) => (
                      <div key={day.toISOString()} className="flex gap-3">
                        <div className={cn(
                          "w-14 shrink-0 text-right pt-1",
                          isToday(day) ? "text-primary" : "text-muted-foreground"
                        )}>
                          <div className="text-[10px] uppercase font-semibold tracking-wide">{format(day, "EEE", { locale: es })}</div>
                          <div className={cn("text-xl leading-none font-bold", isToday(day) && "text-primary")}>{format(day, "d")}</div>
                          <div className="text-[10px]">{format(day, "MMM", { locale: es })}</div>
                        </div>
                        <div className="flex-1 min-w-0 space-y-1.5 border-l border-border pl-3">
                          {dayEvts.map((event: any) => {
                            const time = event._isAllDay ? "Todo el día" : formatMX(event._parsedStart, "HH:mm");
                            const endDt = event.end?.dateTime ? parseEventTime(event.end.dateTime) : null;
                            const endStr = !event._isAllDay && endDt ? `–${formatMX(endDt, "HH:mm")}` : "";
                            const accent = showCalendarColors ? eventAccentColor(event) : undefined;
                            const calName = calendarNameFor(event);
                            return (
                              <button key={event.id} type="button"
                                onClick={() => setSelectedEventId(event.id)}
                                style={accent ? { borderLeftWidth: 3, borderLeftColor: accent } : undefined}
                                className="w-full text-left flex items-start gap-3 rounded-lg border border-border bg-card hover:bg-accent/40 transition-colors p-2.5">
                                <div className="text-[11px] font-medium text-muted-foreground w-20 shrink-0 tabular-nums pt-0.5">
                                  {time}{endStr}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-foreground truncate">{event.subject || "(sin título)"}</p>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    {event.location?.displayName && (
                                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                                        <MapPin className="h-3 w-3 shrink-0" />{event.location.displayName}
                                      </span>
                                    )}
                                    {showCalendarColors && calName && (
                                      <span className="text-[10px] text-muted-foreground">{calName}</span>
                                    )}
                                  </div>
                                </div>
                                {(event.onlineMeeting?.joinUrl || event.onlineMeetingUrl) && (
                                  <Video className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                                )}
                              </button>
                            );
                          })}
                          {dayTasks.map((task: any) => (
                            <Link key={task.id} to={taskDetailHref(task.id)}
                              className="flex items-start gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-colors p-2.5">
                              <div className="w-20 shrink-0 pt-0.5"><CheckSquare className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" /></div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-foreground truncate">{task.title}</p>
                                {task.clients?.name && <p className="text-[11px] text-muted-foreground truncate">{task.clients.name}</p>}
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Vista Equipo — disponibilidad de los usuarios de la organización */}
          {viewMode === "equipo" && (
            <div className="p-3 sm:p-4 overflow-x-auto">
              {teamLoading ? (
                <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : teamAvailability.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
                  <Users className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">Sin disponibilidad para mostrar. Los compañeros deben tener una cuenta de calendario conectada.</p>
                </div>
              ) : (
                <div className="min-w-[720px] space-y-1.5">
                  <p className="text-[11px] text-muted-foreground mb-1">Ocupado = con título; “Bloqueado” = evento privado. Los espacios en blanco son huecos libres para proponer reuniones.</p>
                  {/* Regla de horas */}
                  <div className="flex items-center">
                    <div className="w-44 shrink-0" />
                    <div className="relative flex-1 h-4">
                      {Array.from({ length: Math.floor((END_HOUR - START_HOUR) / 2) + 1 }, (_, i) => START_HOUR + i * 2).map((h) => (
                        <span key={h} className="absolute text-[9px] text-muted-foreground -translate-x-1/2"
                          style={{ left: `${((h - START_HOUR) / (END_HOUR - START_HOUR)) * 100}%` }}>{h}:00</span>
                      ))}
                    </div>
                  </div>
                  {teamAvailability.map((member) => {
                    const work = workByUserForDay.get(member.userId);
                    const wm = work ? WORK_STATUS_META[work.status] : null;
                    const dayStartMin = START_HOUR * 60, dayEndMin = END_HOUR * 60, span = dayEndMin - dayStartMin;
                    return (
                      <div key={member.userId} className="flex items-center gap-2">
                        <div className="w-44 shrink-0 flex items-center gap-2">
                          <UserAvatar name={member.name} avatarUrl={member.avatarUrl} userId={member.userId} size="sm" />
                          <div className="min-w-0">
                            <p className="text-xs text-foreground truncate leading-tight">{member.name}</p>
                            {wm && <p className="text-[10px] text-muted-foreground truncate leading-tight">{wm.icon} {work?.place || wm.short}</p>}
                          </div>
                        </div>
                        <div className="relative flex-1 h-8 rounded-md bg-muted/30 border border-border/50 overflow-hidden">
                          {member.blocks.map((b, i) => {
                            const s = parseEventTime(b.start), e = parseEventTime(b.end);
                            const sMin = Math.max(s.getHours() * 60 + s.getMinutes(), dayStartMin);
                            const eMin = Math.min(e.getHours() * 60 + e.getMinutes(), dayEndMin);
                            if (eMin <= sMin) return null;
                            const left = ((sMin - dayStartMin) / span) * 100;
                            const width = ((eMin - sMin) / span) * 100;
                            return (
                              <div key={i} title={`${b.title} (${formatMX(s, "HH:mm")}–${formatMX(e, "HH:mm")})`}
                                className={cn("absolute top-1 bottom-1 rounded px-1 text-[9px] text-white truncate flex items-center",
                                  b.private ? "bg-slate-400 dark:bg-slate-600" : "bg-primary/80")}
                                style={{ left: `${left}%`, width: `${Math.max(width, 1.5)}%` }}>
                                {width > 8 ? b.title : ""}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right panel — collapsible */}
        <div className={cn(
          "shrink-0 border-l border-border/30 flex flex-col overflow-hidden transition-all duration-200",
          rightPanelOpen && !isMobile ? "w-[260px]" : "w-0"
        )}>
          <div className="w-[260px] flex-1 overflow-y-auto">
            <div className="p-3 pb-24 flex flex-col gap-4">
              {/* Mini calendar */}
              <div className="order-2 border-t border-border/30 pt-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground capitalize">
                    {format(currentDate, "MMMM yyyy", { locale: es })}
                  </p>
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-accent text-muted-foreground"
                      onClick={() => setCurrentDate(subMonths(currentDate, 1))}
                      aria-label="Mes anterior"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded hover:bg-accent text-muted-foreground"
                      onClick={() => setCurrentDate(addMonths(currentDate, 1))}
                      aria-label="Mes siguiente"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-0.5 text-center">
                  {["L", "M", "X", "J", "V", "S", "D"].map((d) => (
                    <span key={d} className="text-[10px] font-semibold text-muted-foreground py-1">
                      {d}
                    </span>
                  ))}
                  {eachDayOfInterval({
                    start: startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 }),
                    end: endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 }),
                  }).map((d) => {
                    const inMonth = isSameMonth(d, currentDate);
                    const today = isToday(d);
                    const selected = isSameDay(d, currentDate);
                    const hasEvents = (allEvents as any[]).some((e: any) =>
                      isSameDay(parseEventTime(e.start?.dateTime || e.start?.date), d),
                    );
                    return (
                      <button
                        key={d.toISOString()}
                        type="button"
                        onClick={() => setCurrentDate(d)}
                        className={cn(
                          "relative h-7 text-[11px] rounded-md transition-colors",
                          !inMonth && "text-muted-foreground/40",
                          inMonth && !today && !selected && "hover:bg-accent text-foreground",
                          today && "ring-1 ring-primary/40 text-primary font-semibold",
                          selected && "bg-primary text-primary-foreground font-semibold",
                        )}
                      >
                        {format(d, "d")}
                        {hasEvents && !selected && (
                          <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-primary" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Cuentas conectadas (multi-proveedor) */}
              <div className="order-5 border-t border-border/30 pt-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Cuentas</p>
                <div className="space-y-1">
                  {/* Cuenta principal de Microsoft (Kawiil): editable nombre + color, no se puede quitar */}
                  {calendars.length > 0 && (
                    <div className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent">
                      <ColorPickerPopover
                        value={accountColorForId(PRIMARY_MS_ID)}
                        onChange={(c) => setAccountColor(PRIMARY_MS_ID, c)}
                        onReset={accountColors[PRIMARY_MS_ID] ? () => resetAccountColor(PRIMARY_MS_ID) : undefined}
                        ariaLabel="Color de la cuenta principal"
                      />
                      <div className="min-w-0 flex-1">
                        {renamingId === PRIMARY_MS_ID ? (
                          <Input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => { setPrimaryName(renameValue.trim()); setRenamingId(null); }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { setPrimaryName(renameValue.trim()); setRenamingId(null); }
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            className="h-6 text-xs px-1.5 py-0"
                            placeholder="Nombre de la cuenta"
                          />
                        ) : (
                          <>
                            <p className="text-xs text-foreground truncate">{primaryLabel}</p>
                            <p className="text-[9px] text-muted-foreground truncate">Microsoft 365 · principal</p>
                          </>
                        )}
                      </div>
                      {renamingId !== PRIMARY_MS_ID && (
                        <button
                          type="button"
                          onClick={() => { setRenamingId(PRIMARY_MS_ID); setRenameValue(primaryName); }}
                          className="p-0.5 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          title="Renombrar"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  )}
                  {linkedAccounts.filter((a) => a.provider === "google" || a.provider === "microsoft").map((acc) => {
                    const provider: "google" | "microsoft" = acc.provider === "microsoft" ? "microsoft" : "google";
                    const providerLabel = provider === "microsoft" ? "Outlook" : "Google Calendar";
                    const editing = renamingId === acc.id;
                    return (
                      <div key={acc.id} className="group flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent">
                        <ColorPickerPopover
                          value={accountColorForId(acc.id)}
                          onChange={(c) => setAccountColor(acc.id, c)}
                          onReset={accountColors[acc.id] ? () => resetAccountColor(acc.id) : undefined}
                          ariaLabel={`Color de ${accountLabelById.get(acc.id)}`}
                        />
                        <div className="min-w-0 flex-1">
                          {editing ? (
                            <Input
                              autoFocus
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onBlur={() => { renameAccount.mutate({ id: acc.id, name: renameValue }); setRenamingId(null); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { renameAccount.mutate({ id: acc.id, name: renameValue }); setRenamingId(null); }
                                if (e.key === "Escape") setRenamingId(null);
                              }}
                              className="h-6 text-xs px-1.5 py-0"
                              placeholder="Nombre de la cuenta"
                            />
                          ) : (
                            <>
                              <p className="text-xs text-foreground truncate">{accountLabelById.get(acc.id)}</p>
                              <p className="text-[9px] text-muted-foreground truncate">
                                {providerLabel}{acc.display_name && acc.email ? ` · ${acc.email}` : ""}{acc.status !== "connected" ? " · error" : ""}
                              </p>
                            </>
                          )}
                        </div>
                        {!editing && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button
                              type="button"
                              onClick={() => { setRenamingId(acc.id); setRenameValue(acc.display_name || ""); }}
                              className="p-0.5 text-muted-foreground hover:text-foreground"
                              title="Renombrar"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => disconnectLinkedAccount(acc.id, provider)}
                              className="text-[10px] text-muted-foreground hover:text-destructive px-0.5"
                              title="Desconectar"
                            >
                              Quitar
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => connectGoogle()}
                    disabled={googleConnecting}
                    className="w-full flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    {googleConnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    <span>Conectar cuenta de Google</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => connectOutlook()}
                    disabled={outlookConnecting}
                    className="w-full flex items-center gap-2 rounded-md border border-dashed border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                  >
                    {outlookConnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    <span>Conectar cuenta de Outlook</span>
                  </button>
                </div>
              </div>

              {/* Calendarios agrupados por cuenta (Microsoft + cada cuenta añadida) */}
              {(calendars.length > 1 || googleCalendars.length > 0 || outlookCalendars.length > 0) && (
                <div className="order-4 border-t border-border/30 pt-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Calendarios</p>
                  <div className="space-y-2">
                    {calendarGroups.map((group) => (
                      <div key={group.key} className="space-y-0.5">
                        {calendarGroups.length > 1 && (
                          <div className="flex items-center gap-1.5 px-2 pb-0.5">
                            {group.color && <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: group.color }} />}
                            <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground truncate">{group.label}</span>
                          </div>
                        )}
                        {group.items.map((cal) => {
                          const visible = !hiddenCalendarIds.includes(cal.id);
                          const color = calendarColorFor(cal.id) || "#3b82f6";
                          return (
                            <div
                              key={cal.id}
                              className={cn(
                                "w-full flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent",
                                !visible && "opacity-40",
                              )}
                            >
                              <ColorPickerPopover
                                value={color}
                                onChange={(c) => setCalendarColor(cal.id, c)}
                                onReset={calendarColors[cal.id] ? () => resetCalendarColor(cal.id) : undefined}
                                ariaLabel={`Color de ${cal.name}`}
                              />
                              <button
                                type="button"
                                onClick={() => toggleCalendar(cal.id)}
                                className="flex-1 min-w-0 flex items-center gap-2 text-left"
                                title={visible ? "Ocultar calendario" : "Mostrar calendario"}
                              >
                                <span className="text-xs text-foreground truncate">{cal.name}</span>
                                {cal.isDefaultCalendar && (
                                  <span className="ml-auto text-[9px] text-muted-foreground shrink-0">principal</span>
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Category filters */}
              {outlookCategories.length > 0 && (
                <div className="order-3 border-t border-border/30 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Categorías</p>
                    {activeCategoryFilters.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveCategoryFilters([])}
                        className="text-[10px] text-primary hover:underline"
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                  <div className="space-y-0.5">
                    {(outlookCategories as any[]).map((cat: any) => {
                      const name: string = cat.displayName;
                      const active = activeCategoryFilters.includes(name);
                      const color = categoryColorFor(name);
                      return (
                        <div
                          key={name}
                          className={cn(
                            "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] transition-colors",
                            active ? "bg-primary/10 text-foreground" : "hover:bg-accent/50 text-muted-foreground",
                          )}
                        >
                          <ColorPickerPopover
                            value={color}
                            onChange={(c) => setCategoryColor(name, c)}
                            onReset={categoryColors[name] ? () => resetCategoryColor(name) : undefined}
                            ariaLabel={`Color de ${name}`}
                            size={11}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setActiveCategoryFilters((prev) =>
                                prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
                              )
                            }
                            className="flex-1 min-w-0 flex items-center gap-2 text-left"
                            title="Filtrar por esta categoría"
                          >
                            <span className="truncate flex-1">{name}</span>
                            {active && <span className="text-primary text-[10px]">●</span>}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                  {activeCategoryFilters.length > 0 && (
                    <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/40 mt-1">
                      Mostrando {events.length} de {allEvents.length} eventos
                    </p>
                  )}
                </div>
              )}

              {/* Etiquetas Kawiil (categorías propias, aplican a eventos de cualquier cuenta) */}
              <div className="order-3 border-t border-border/30 pt-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">Etiquetas Kawiil</p>
                <div className="space-y-0.5">
                  {kawiilCategories.map((cat) => {
                    const active = activeKawiilCatIds.includes(cat.id);
                    const editing = renamingId === `cat:${cat.id}`;
                    return (
                      <div key={cat.id} className={cn("group w-full flex items-center gap-2 rounded-md px-2 py-1 text-[11px] transition-colors", active ? "bg-primary/10 text-foreground" : "hover:bg-accent/50 text-muted-foreground")}>
                        <ColorPickerPopover
                          value={cat.color}
                          onChange={(c) => updateCategory.mutate({ id: cat.id, color: c })}
                          ariaLabel={`Color de ${cat.name}`}
                          size={11}
                        />
                        {editing ? (
                          <Input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => { if (renameValue.trim()) updateCategory.mutate({ id: cat.id, name: renameValue }); setRenamingId(null); }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { if (renameValue.trim()) updateCategory.mutate({ id: cat.id, name: renameValue }); setRenamingId(null); }
                              if (e.key === "Escape") setRenamingId(null);
                            }}
                            className="h-6 text-xs px-1.5 py-0 flex-1"
                          />
                        ) : (
                          <button type="button" onClick={() => setActiveKawiilCatIds((p) => p.includes(cat.id) ? p.filter((x) => x !== cat.id) : [...p, cat.id])} className="flex-1 min-w-0 text-left truncate" title="Filtrar por esta etiqueta">
                            {cat.name}{active && <span className="text-primary text-[10px] ml-1">●</span>}
                          </button>
                        )}
                        {!editing && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            <button type="button" onClick={() => { setRenamingId(`cat:${cat.id}`); setRenameValue(cat.name); }} className="p-0.5 hover:text-foreground" title="Renombrar"><Pencil className="h-3 w-3" /></button>
                            <button type="button" onClick={() => deleteCategory.mutate(cat.id)} className="p-0.5 hover:text-destructive" title="Eliminar"><Trash2 className="h-3 w-3" /></button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-1 pt-1">
                    <Input
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && newCategoryName.trim()) {
                          createCategory.mutate({ name: newCategoryName, color: paletteColorFor(newCategoryName) });
                          setNewCategoryName("");
                        }
                      }}
                      placeholder="Nueva etiqueta (ej. Cliente)"
                      className="h-7 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() => { if (newCategoryName.trim()) { createCategory.mutate({ name: newCategoryName, color: paletteColorFor(newCategoryName) }); setNewCategoryName(""); } }}
                      disabled={!newCategoryName.trim() || createCategory.isPending}
                      className="shrink-0 p-1.5 rounded-md border border-dashed border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                      title="Agregar etiqueta"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* AI analysis card */}
              {aiEvents && aiEvents.length > 0 && (
                <div className="order-1">
                  <CalendarKawiilCard
                    scope="week"
                    periodLabel={aiPeriodLabel || ""}
                    events={aiEvents}
                    tasksDue={aiTasksDue || []}
                    cacheKey={aiPeriodLabel || ""}
                  />
                </div>
              )}

              {/* Today agenda */}
              <div className="order-6 border-t border-border/30 pt-3">
                {todayAgendaCard}
              </div>

              {/* Upcoming tasks */}
              {upcomingTasksCard && (
                <div className="order-7 border-t border-border/30 pt-3">
                  {upcomingTasksCard}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Create event dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nuevo evento – {format(selectedDate, "EEEE d 'de' MMMM, yyyy", { locale: es })}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Asunto</Label>
              <Input value={newEvent.subject} onChange={(e) => setNewEvent({ ...newEvent, subject: e.target.value })} placeholder="Nombre del evento..." />
            </div>
            <div className="flex items-center justify-between gap-2">
              <Label className="text-sm">Día completo</Label>
              <Switch checked={newEvent.isAllDay} onCheckedChange={(checked) => setNewEvent({ ...newEvent, isAllDay: checked })} />
            </div>
            {!newEvent.isAllDay && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Hora inicio (CDMX)</Label>
                  <Input type="time" value={newEvent.startTime} onChange={(e) => setNewEvent({ ...newEvent, startTime: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Hora fin (CDMX)</Label>
                  <Input type="time" value={newEvent.endTime} onChange={(e) => setNewEvent({ ...newEvent, endTime: e.target.value })} />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label>Invitados (correos separados por coma)</Label>
              <Input placeholder="persona1@ejemplo.com, persona2@ejemplo.com" value={newEvent.attendees} onChange={(e) => setNewEvent({ ...newEvent, attendees: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Ubicación / dirección</Label>
              <PlaceAutocompleteInput
                placeholder="Oficina, sala, dirección física, etc."
                value={newEvent.location}
                onChange={(v) => setNewEvent({ ...newEvent, location: v })}
              />
            </div>
            {newEvent.location.trim() && !/^https?:\/\//i.test(newEvent.location.trim()) && (
              <EventTravelSection
                destination={newEvent.location.trim()}
                departureISO={!newEvent.isAllDay && newEvent.startTime ? `${format(selectedDate, "yyyy-MM-dd")}T${newEvent.startTime}:00` : null}
              />
            )}
            <div className="flex items-center justify-between gap-2">
              <div>
                <Label className="text-sm">Reunión de Teams</Label>
                <p className="text-xs text-muted-foreground">Outlook generará enlace automáticamente.</p>
              </div>
              <Switch checked={newEvent.isOnlineMeeting} onCheckedChange={(checked) => setNewEvent({ ...newEvent, isOnlineMeeting: checked })} />
            </div>
            <div className="space-y-2">
              <Label>Descripción / notas</Label>
              <Textarea placeholder="Agenda, notas, instrucciones..." value={newEvent.description} onChange={(e) => setNewEvent({ ...newEvent, description: e.target.value })} rows={3} />
            </div>
            <div className="space-y-2">
              <Label>Etiquetas</Label>
              {outlookCategories.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {outlookCategories.map((cat: any) => (
                    <label key={cat.displayName || cat.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Checkbox checked={newEvent.categories.includes(cat.displayName)} onCheckedChange={() => toggleNewEventCategory(cat.displayName)} />
                      <span>{cat.displayName}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <Input placeholder="Ej: Personal, Trabajo" value={newEvent.categories.join(", ")} onChange={(e) => setNewEvent({ ...newEvent, categories: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancelar</Button>
            <Button onClick={handleCreateEvent} disabled={createEvent.isPending || !newEvent.subject}>
              {createEvent.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Crear evento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit event dialog */}
      <Dialog open={!!selectedEventId} onOpenChange={(open) => !open && setSelectedEventId(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-4 w-4" /> Ver y editar evento</DialogTitle>
          </DialogHeader>
          {eventDetailLoading && !cachedEvent ? (
            <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
          ) : eventDetailFailed && !cachedEvent ? (
            <div className="flex flex-col items-center gap-4 py-8 px-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted/50">
                <AlertCircle className="h-7 w-7 text-muted-foreground" aria-hidden />
              </div>
              <p className="text-sm text-muted-foreground max-w-sm">
                {eventDetailError instanceof Error && eventDetailError.message
                  ? eventDetailError.message
                  : "No se pudo cargar este evento. Puede haberse eliminado en Outlook o ser una instancia de serie desactualizada."}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSelectedEventId(null);
                  void queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
                }}
              >
                Cerrar y actualizar calendario
              </Button>
            </div>
          ) : (cachedEvent || eventDetail) ? (
            <div className="space-y-4 py-2">
              {(() => {
                const ev = cachedEvent || eventDetail;
                const accId = linkedAccountIdFromCalendarId(ev?.calendarId);
                const acc = accId ? linkedAccounts.find((a) => a.id === accId) : null;
                const provider = acc ? (acc.provider === "microsoft" ? "Outlook" : "Google Calendar") : "Microsoft 365";
                const accountLabel = accId ? (accountLabelById.get(accId) || acc?.email || "Cuenta") : "Microsoft 365";
                const calName = calendarNameFor(ev);
                const dotColor = accId ? accountColorForId(accId) : accountColorForId(PRIMARY_MS_ID);
                return (
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} />
                    <div className="min-w-0 text-xs leading-tight">
                      <p className="font-medium text-foreground truncate">{accountLabel}</p>
                      <p className="text-muted-foreground truncate">{provider}{calName ? ` · ${calName}` : ""}</p>
                    </div>
                  </div>
                );
              })()}
              {(eventDetail?.onlineMeeting?.joinUrl || cachedEvent?.onlineMeeting?.joinUrl || cachedEvent?.onlineMeetingUrl) && (
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={() => window.open(eventDetail?.onlineMeeting?.joinUrl || cachedEvent?.onlineMeeting?.joinUrl || cachedEvent?.onlineMeetingUrl, "_blank")}>
                    <Video className="mr-1 h-4 w-4" /> Unirse (Teams)
                  </Button>
                </div>
              )}
              <div className="space-y-2">
                <Label>Asunto</Label>
                <Input value={editForm.subject} onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Fecha inicio</Label><Input type="date" value={editForm.startDate} onChange={(e) => setEditForm({ ...editForm, startDate: e.target.value })} /></div>
                <div className="space-y-1"><Label>Hora inicio</Label><Input type="time" value={editForm.startTime} onChange={(e) => setEditForm({ ...editForm, startTime: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Fecha fin</Label><Input type="date" value={editForm.endDate} onChange={(e) => setEditForm({ ...editForm, endDate: e.target.value })} /></div>
                <div className="space-y-1"><Label>Hora fin</Label><Input type="time" value={editForm.endTime} onChange={(e) => setEditForm({ ...editForm, endTime: e.target.value })} /></div>
              </div>
              <div className="space-y-2">
                <Label>Ubicación</Label>
                <PlaceAutocompleteInput
                  value={editForm.location}
                  onChange={(v) => setEditForm({ ...editForm, location: v })}
                  placeholder="Lugar o dirección"
                />
              </div>
              {editForm.location.trim() && !/^https?:\/\//i.test(editForm.location.trim()) && (
                <EventTravelSection
                  destination={editForm.location.trim()}
                  departureISO={editForm.startDate && editForm.startTime ? `${editForm.startDate}T${editForm.startTime}:00` : null}
                />
              )}
              <div className="space-y-2">
                <Label>Invitados</Label>
                <Input value={editForm.attendees} onChange={(e) => setEditForm({ ...editForm, attendees: e.target.value })} placeholder="email@ejemplo.com" />
              </div>
              <div className="space-y-2">
                <Label>Descripción</Label>
                <Textarea value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} rows={3} />
              </div>
              <div className="space-y-2">
                <Label>Etiquetas</Label>
                {outlookCategories.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {outlookCategories.map((cat: any) => (
                      <label key={cat.displayName || cat.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                        <Checkbox checked={editForm.categories.includes(cat.displayName)} onCheckedChange={() => toggleEditCategory(cat.displayName)} />
                        <span>{cat.displayName}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <Input placeholder="Ej: Personal, Trabajo" value={editForm.categories.join(", ")} onChange={(e) => setEditForm({ ...editForm, categories: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                )}
              </div>
              {/* Etiquetas Kawiil: aplican a eventos de cualquier cuenta (Google/Outlook/M365) */}
              {selectedEventId && (
                <div className="space-y-2">
                  <Label>Etiquetas Kawiil <span className="text-[10px] font-normal text-muted-foreground">· aplican a cualquier cuenta</span></Label>
                  {kawiilCategories.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {kawiilCategories.map((cat) => {
                        const checked = (eventTags[selectedEventId] || []).includes(cat.id);
                        return (
                          <label key={cat.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                            <Checkbox checked={checked} onCheckedChange={() => toggleEventTag.mutate({ eventId: selectedEventId, categoryId: cat.id, active: !checked })} />
                            <span className="inline-flex items-center gap-1">
                              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cat.color }} />{cat.name}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Crea categorías en el panel derecho (sección “Etiquetas Kawiil”) para aplicarlas aquí.</p>
                  )}
                </div>
              )}
            </div>
          ) : null}
          {isGoogleEvent && (cachedEvent || eventDetail) && (
            <p className="text-[11px] text-muted-foreground -mt-1">
              Evento de una cuenta añadida (solo lectura desde Kawiil). Puedes crear una tarea a partir de él.
            </p>
          )}
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center">
            {!isGoogleEvent && (
              <Button variant="destructive" onClick={() => { if (selectedEventId) deleteEvent.mutate(selectedEventId, { onSuccess: () => setSelectedEventId(null) }); }} disabled={deleteEvent.isPending}>
                {deleteEvent.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Eliminar
              </Button>
            )}
            <div className="hidden sm:block sm:flex-1" />
            <Button variant="outline" onClick={() => setShowTaskFromEvent(true)} disabled={!cachedEvent && !eventDetail}>
              <CheckSquare className="mr-1.5 h-4 w-4" /> Crear tarea
            </Button>
            <Button variant="outline" onClick={() => setSelectedEventId(null)}>Cerrar</Button>
            {!isGoogleEvent && (
              <Button onClick={handleUpdateEvent} disabled={updateEvent.isPending || !editForm.subject}>
                {updateEvent.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Crear tarea/actividad desde el evento seleccionado */}
      <CreateTaskFromEventDialog
        open={showTaskFromEvent}
        onOpenChange={setShowTaskFromEvent}
        event={(eventDetail || cachedEvent) ?? null}
      />
    </div>
  );
}
