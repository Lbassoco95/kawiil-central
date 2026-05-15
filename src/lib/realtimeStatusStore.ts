import { useSyncExternalStore } from "react";

/**
 * Estado de salud de la suscripción Realtime de notificaciones (`notifications-rt-{user.id}`).
 * Permite que el topbar muestre un indicador persistente cuando se cae, en lugar del toast
 * efímero que el usuario podía perderse fácilmente.
 *
 * Diseño: store global con `useSyncExternalStore`. Sin React-context para que pueda actualizarse
 * desde fuera del árbol React (callbacks de `supabase.channel.subscribe`).
 */
export type RealtimeStatus = "idle" | "subscribed" | "reconnecting" | "down";

export type RealtimeStatusState = {
  status: RealtimeStatus;
  /** Cambia con cada actualización; usado por el suscriptor del store. */
  changedAt: number;
  /** Última vez que la suscripción reportó SUBSCRIBED (épocas en ms). */
  lastSubscribedAt: number | null;
  /** Última vez que llegó algún evento Realtime (INSERT/UPDATE/PRESENCE/etc.). */
  lastEventAt: number | null;
  /** Último motivo conocido de fallo (`CHANNEL_ERROR`, `TIMED_OUT`, `CLOSED`, etc.). */
  lastErrorReason: string | null;
};

const initial: RealtimeStatusState = {
  status: "idle",
  changedAt: Date.now(),
  lastSubscribedAt: null,
  lastEventAt: null,
  lastErrorReason: null,
};

let state: RealtimeStatusState = initial;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getRealtimeStatusSnapshot(): RealtimeStatusState {
  return state;
}

export function subscribeRealtimeStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setRealtimeStatusSubscribed(): void {
  state = {
    ...state,
    status: "subscribed",
    changedAt: Date.now(),
    lastSubscribedAt: Date.now(),
    lastErrorReason: null,
  };
  emit();
}

export function setRealtimeStatusReconnecting(reason: string): void {
  state = {
    ...state,
    status: "reconnecting",
    changedAt: Date.now(),
    lastErrorReason: reason || state.lastErrorReason,
  };
  emit();
}

export function setRealtimeStatusDown(reason: string): void {
  state = {
    ...state,
    status: "down",
    changedAt: Date.now(),
    lastErrorReason: reason || state.lastErrorReason,
  };
  emit();
}

export function markRealtimeEventReceived(): void {
  state = { ...state, lastEventAt: Date.now() };
  // Sin emit: cambio de salud (status) emite; lastEventAt no necesita re-render por ahora.
}

export function useRealtimeStatus(): RealtimeStatusState {
  return useSyncExternalStore(subscribeRealtimeStatus, getRealtimeStatusSnapshot, getRealtimeStatusSnapshot);
}

export function realtimeStatusLabel(s: RealtimeStatus): string {
  switch (s) {
    case "subscribed":
      return "Avisos en vivo conectados";
    case "reconnecting":
      return "Reconectando avisos en vivo…";
    case "down":
      return "Avisos en vivo desconectados";
    case "idle":
    default:
      return "Sin sesión Realtime";
  }
}
