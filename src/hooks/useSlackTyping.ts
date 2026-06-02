import { useEffect, useRef, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Tiempo en ms sin teclas antes de dejar de "escribir"
const TYPING_DEBOUNCE_MS = 3000;
// Tiempo máximo que mostramos a alguien escribiendo sin actualización
const TYPING_EXPIRE_MS = 5000;

export type TypingUser = {
  userId: string;
  userName: string;
  avatarUrl?: string;
  expiresAt: number;
};

interface BroadcastPayload {
  user_id: string;
  user_name: string;
  avatar_url?: string;
  channel_id: string;
  is_typing: boolean;
}

/**
 * Hook para indicadores de escritura en tiempo real.
 *
 * - Broadcast vía Supabase Realtime channel `slack-typing:{channelId}`
 * - Emite start/stop automáticamente al escribir
 * - Limpia entradas expiradas cada segundo
 *
 * Para integración futura con Slack RTM (bot socket mode):
 * el edge function `slack-events` puede recibir `user_typing` events
 * desde Slack Socket Mode y hacer broadcast al mismo canal de Supabase.
 */
export function useSlackTyping(
  channelId: string | null | undefined,
  userName: string,
  avatarUrl?: string,
) {
  const { user } = useAuth();
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isTypingRef = useRef(false);

  // Suscripción al canal de Supabase Realtime
  useEffect(() => {
    if (!channelId || !user?.id) return;

    const ch = supabase.channel(`slack-typing:${channelId}`, {
      config: { broadcast: { self: false } },
    });

    ch.on("broadcast", { event: "typing" }, (payload: { payload: BroadcastPayload }) => {
      const p = payload.payload;
      if (!p?.user_id || p.user_id === user.id) return;

      setTypingUsers((prev) => {
        const filtered = prev.filter((u) => u.userId !== p.user_id);
        if (!p.is_typing) return filtered;
        return [
          ...filtered,
          {
            userId: p.user_id,
            userName: p.user_name,
            avatarUrl: p.avatar_url,
            expiresAt: Date.now() + TYPING_EXPIRE_MS,
          },
        ];
      });
    });

    ch.subscribe();
    channelRef.current = ch;

    return () => {
      void supabase.removeChannel(ch);
      channelRef.current = null;
      setTypingUsers([]);
    };
  }, [channelId, user?.id]);

  // Limpiar entradas expiradas cada segundo
  useEffect(() => {
    const iv = setInterval(() => {
      setTypingUsers((prev) => {
        const now = Date.now();
        const next = prev.filter((u) => u.expiresAt > now);
        return next.length === prev.length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  // Limpiar al cambiar de canal
  useEffect(() => {
    setTypingUsers([]);
    isTypingRef.current = false;
  }, [channelId]);

  const broadcastTyping = useCallback(
    (isTyping: boolean) => {
      if (!channelRef.current || !user?.id || !channelId) return;
      void channelRef.current.send({
        type: "broadcast",
        event: "typing",
        payload: {
          user_id: user.id,
          user_name: userName,
          avatar_url: avatarUrl,
          channel_id: channelId,
          is_typing: isTyping,
        } satisfies BroadcastPayload,
      });
    },
    [user?.id, channelId, userName, avatarUrl],
  );

  // Llamar al escribir: inicia o reinicia el debounce de "dejó de escribir"
  const onTyping = useCallback(() => {
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      broadcastTyping(true);
    }
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      isTypingRef.current = false;
      broadcastTyping(false);
    }, TYPING_DEBOUNCE_MS);
  }, [broadcastTyping]);

  // Llamar al enviar el mensaje para parar inmediatamente
  const onStopTyping = useCallback(() => {
    if (stopTimerRef.current) clearTimeout(stopTimerRef.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      broadcastTyping(false);
    }
  }, [broadcastTyping]);

  return { typingUsers, onTyping, onStopTyping };
}
