import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * useAgentTaskProgress
 * --------------------
 * Stream en vivo de eventos emitidos por la VM kawiil-agents durante la
 * ejecución de una tarea (Bloque B1 del plan v6). Sigue el patrón canónico
 * de Realtime del repo (`useNotificationDelivery`):
 *   - Canal dedicado por `taskId` (`ai-task-progress-${taskId}`).
 *   - Fetch inicial con catch-up completo, suscripción postgres_changes
 *     sólo a INSERTs filtrando por `task_id=eq.${taskId}`.
 *   - Reconexión con backoff exponencial ante CHANNEL_ERROR/TIMED_OUT/CLOSED.
 *   - Fallback polling cada 22 s con cursor por `sequence` + dedupe por `id`.
 *   - Cleanup disciplinado: canales duplicados (StrictMode) via
 *     `supabase.getChannels()` + `removeChannel`.
 */

export type AgentTaskEvent = {
  id: string;
  task_id: string;
  agent_id: string | null;
  user_id: string | null;
  organization_id: string;
  event_type: string;
  sequence: number;
  progress: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: Record<string, any>;
  created_at: string;
};

export type AgentTaskStatus =
  | "idle"
  | "connecting"
  | "running"
  | "completed"
  | "failed";

export interface UseAgentTaskProgressReturn {
  events: AgentTaskEvent[];
  status: AgentTaskStatus;
  isConnected: boolean;
  reconnect: () => void;
}

const POLL_INTERVAL_MS = 22_000;
const BACKOFF_SCHEDULE_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

export function useAgentTaskProgress(
  taskId: string | null,
): UseAgentTaskProgressReturn {
  const [events, setEvents] = useState<AgentTaskEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  /** Cuenta manual de reconexiones; bumpearla re-ejecuta el efecto sin resetear eventos. */
  const [reconnectNonce, setReconnectNonce] = useState(0);

  /** Dedupe O(1) por id; persiste entre renders. */
  const seenIdsRef = useRef<Set<string>>(new Set());
  /** Cursor del polling; se avanza conforme llegan eventos (realtime o poll). */
  const lastSequenceRef = useRef<number>(-1);
  /** taskId procesado en el último run del efecto, para distinguir cambio-de-task vs reconnect. */
  const lastTaskIdRef = useRef<string | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptRef = useRef<number>(0);

  const status: AgentTaskStatus = useMemo(() => {
    if (!taskId) return "idle";
    if (events.some((e) => e.event_type === "completed")) return "completed";
    if (events.some((e) => e.event_type === "failed")) return "failed";
    if (events.length > 0) return "running";
    return "connecting";
  }, [taskId, events]);

  const reconnect = useCallback(() => {
    attemptRef.current = 0;
    setReconnectNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!taskId) {
      seenIdsRef.current = new Set();
      lastSequenceRef.current = -1;
      lastTaskIdRef.current = null;
      setEvents([]);
      setIsConnected(false);
      return;
    }

    const taskIdChanged = lastTaskIdRef.current !== taskId;
    lastTaskIdRef.current = taskId;

    // Cambio de task → reset completo. Reconnect puro (mismo taskId) preserva los eventos
    // ya recibidos y solo reinicia la conexión; el polling + dedupe rellenan huecos.
    if (taskIdChanged) {
      seenIdsRef.current = new Set();
      lastSequenceRef.current = -1;
      setEvents([]);
    }
    setIsConnected(false);

    let cancelled = false;

    /**
     * Aplica eventos nuevos al estado. Dedupe + avance de cursor se hacen sobre refs
     * (fuera del updater de setState) para ser idempotente bajo StrictMode y evitar
     * re-sorts innecesarios cuando ningún evento pasa el filtro.
     */
    const applyNewEvents = (incoming: AgentTaskEvent[]) => {
      if (cancelled || incoming.length === 0) return;
      const trulyNew: AgentTaskEvent[] = [];
      for (const ev of incoming) {
        if (!ev?.id) continue;
        if (seenIdsRef.current.has(ev.id)) continue;
        seenIdsRef.current.add(ev.id);
        trulyNew.push(ev);
        if (typeof ev.sequence === "number" && ev.sequence > lastSequenceRef.current) {
          lastSequenceRef.current = ev.sequence;
        }
      }
      if (trulyNew.length === 0) return;
      setEvents((prev) => {
        const merged = prev.concat(trulyNew);
        merged.sort((a, b) => a.sequence - b.sequence);
        return merged;
      });
    };

    const fetchInitial = async () => {
      const { data, error } = await supabase
        .from("ai_task_events")
        .select("*")
        .eq("task_id", taskId)
        .order("sequence", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.error("[agent-task-progress] initial fetch failed", error.message);
        return;
      }
      if (data && data.length > 0) {
        applyNewEvents(data as AgentTaskEvent[]);
      }
    };

    const pollOnce = async () => {
      if (cancelled) return;
      const { data, error } = await supabase
        .from("ai_task_events")
        .select("*")
        .eq("task_id", taskId)
        .gt("sequence", lastSequenceRef.current)
        .order("sequence", { ascending: true });
      if (cancelled) return;
      if (error) {
        console.warn("[agent-task-progress] poll failed", error.message);
        return;
      }
      if (data && data.length > 0) {
        applyNewEvents(data as AgentTaskEvent[]);
      }
    };

    const channelTopic = `ai-task-progress-${taskId}`;

    const scheduleReconnect = (reason: string) => {
      if (cancelled) return;
      const delay =
        BACKOFF_SCHEDULE_MS[
          Math.min(attemptRef.current, BACKOFF_SCHEDULE_MS.length - 1)
        ];
      attemptRef.current += 1;
      console.warn("[agent-task-progress] reconnect scheduled", {
        reason,
        delayMs: delay,
        attempt: attemptRef.current,
      });
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (cancelled) return;

      // Evita colisiones "already joined" si el componente remonta en StrictMode
      // o si reconectamos antes de que el canal previo haya cerrado.
      for (const existing of supabase.getChannels()) {
        if (existing.topic === channelTopic) {
          supabase.removeChannel(existing);
        }
      }

      const channel = supabase
        .channel(channelTopic)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "ai_task_events",
            filter: `task_id=eq.${taskId}`,
          },
          (payload) => {
            const row = payload.new as AgentTaskEvent;
            applyNewEvents([row]);
          },
        )
        .subscribe((subStatus, err) => {
          if (cancelled) return;
          if (subStatus === "SUBSCRIBED") {
            console.debug("[agent-task-progress] SUBSCRIBED", channelTopic);
            setIsConnected(true);
            attemptRef.current = 0;
            // Justo después de subscribir hacemos un poll para cubrir la ventana
            // entre el fetchInitial y el momento en que Realtime empezó a entregar.
            void pollOnce();
            return;
          }
          if (
            subStatus === "CHANNEL_ERROR" ||
            subStatus === "TIMED_OUT" ||
            subStatus === "CLOSED"
          ) {
            console.error("[agent-task-progress] channel error", subStatus, err);
            setIsConnected(false);
            try {
              supabase.removeChannel(channel);
            } catch {
              /* ignore */
            }
            if (channelRef.current === channel) channelRef.current = null;
            scheduleReconnect(subStatus);
          }
        });

      channelRef.current = channel;
    };

    void fetchInitial();
    connect();

    pollingIntervalRef.current = window.setInterval(
      () => void pollOnce(),
      POLL_INTERVAL_MS,
    );

    return () => {
      cancelled = true;
      if (pollingIntervalRef.current !== null) {
        window.clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      if (reconnectTimerRef.current !== null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [taskId, reconnectNonce]);

  return { events, status, isConnected, reconnect };
}
