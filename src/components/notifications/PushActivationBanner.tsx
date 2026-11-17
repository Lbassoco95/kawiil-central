import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Share, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { Button } from "@/components/ui/button";
import { formatPushRegistrationUserMessage, registerWebPushSubscription } from "@/lib/registerWebPush";
import {
  PUSH_BANNER_DISMISS_KEY,
  dismissStillActive,
  isIosDevice,
  pushBannerMode,
} from "@/lib/pwaPush";

function readDismissedAt(): number | null {
  try {
    const raw = localStorage.getItem(PUSH_BANNER_DISMISS_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.("(display-mode: standalone)").matches === true || nav.standalone === true;
}

/**
 * Invitación amable para (1) instalar Kawiil en el iPhone y (2) activar los avisos con la app cerrada.
 * Se oculta sola cuando todo está listo; «Ahora no» la silencia 7 días. Estilo Zen + Glass.
 */
export function PushActivationBanner() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(() => dismissStillActive(readDismissedAt(), Date.now()));
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null);

  const refreshSubscription = useCallback(async () => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setHasSubscription(false);
        return;
      }
      const reg = (await navigator.serviceWorker.getRegistration("/sw.js")) || (await navigator.serviceWorker.getRegistration());
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setHasSubscription(!!sub);
    } catch {
      setHasSubscription(false);
    }
  }, []);

  useEffect(() => {
    if (user) void refreshSubscription();
  }, [user, refreshSubscription]);

  const { data: toggleOn } = useQuery({
    queryKey: ["push-banner-prefs", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("desktop_push_notifications")
        .eq("user_id", user!.id)
        .maybeSingle();
      return data?.desktop_push_notifications === true;
    },
  });

  const activar = useMutation({
    mutationFn: async () => {
      // El permiso se pide dentro del toque del usuario (requisito de iOS y Chrome).
      if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        if (p !== "granted") {
          throw new Error("Sin permiso de notificaciones no podemos avisarte. Puedes activarlo desde los ajustes del dispositivo.");
        }
      }
      await registerWebPushSubscription();
      const { error } = await supabase
        .from("profiles")
        .update({ desktop_push_notifications: true })
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: async () => {
      await refreshSubscription();
      qc.invalidateQueries({ queryKey: ["push-banner-prefs", user?.id] });
      qc.invalidateQueries({ queryKey: ["profile-notification-prefs", user?.id] });
      qc.invalidateQueries({ queryKey: ["notification-delivery-prefs", user?.id] });
      toast.success("Listo, te avisaremos con calma");
    },
    onError: (e: Error) => toast.error(formatPushRegistrationUserMessage(e)),
  });

  if (!user || dismissed || hasSubscription === null || toggleOn === undefined) return null;

  const mode = pushBannerMode({
    ios: isIosDevice(navigator.userAgent, navigator.maxTouchPoints ?? 0),
    standalone: isStandalone(),
    pushSupported: "serviceWorker" in navigator && "PushManager" in window,
    permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission,
    hasSubscription,
    toggleOn,
  });
  if (!mode) return null;

  const cerrar = () => {
    try {
      localStorage.setItem(PUSH_BANNER_DISMISS_KEY, String(Date.now()));
    } catch {
      /* sin almacenamiento: solo se oculta en esta sesión */
    }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className={`fixed z-[70] max-w-sm rounded-2xl border border-[hsl(var(--zen-border))] bg-[hsl(var(--zen-bg)/0.85)] p-4 text-[hsl(var(--zen-fg))] shadow-[0_18px_40px_-18px_hsl(var(--zen-info)/0.35)] backdrop-blur-xl animate-fade-in ${
        isMobile ? "bottom-24 left-4 right-4 max-w-none" : "bottom-6 right-6"
      }`}
    >
      <button
        type="button"
        onClick={cerrar}
        aria-label="Cerrar"
        className="absolute right-2 top-2 rounded-full p-1 text-[hsl(var(--zen-fg)/0.55)] transition-colors hover:text-[hsl(var(--zen-fg))]"
      >
        <X className="h-4 w-4" />
      </button>

      {mode === "install-ios" ? (
        <div className="flex gap-3 pr-5">
          <Share className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--zen-info))]" aria-hidden />
          <div className="space-y-2">
            <p className="text-sm font-medium">Instala Kawiil en tu iPhone</p>
            <p className="text-sm text-[hsl(var(--zen-fg)/0.75)]">
              Para recibir avisos, toca <strong>Compartir</strong> y luego <strong>«Añadir a pantalla de inicio»</strong>. Después ábrela desde su ícono.
            </p>
            <Button size="sm" variant="secondary" onClick={cerrar}>
              Entendido
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3 pr-5">
          <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--zen-info))]" aria-hidden />
          <div className="space-y-2">
            <p className="text-sm font-medium">¿Quieres que Kawiil te avise?</p>
            <p className="text-sm text-[hsl(var(--zen-fg)/0.75)]">
              Te avisamos de solicitudes por aprobar, candidatos nuevos, avisos del equipo y correos, incluso con la app cerrada.
            </p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => activar.mutate()} disabled={activar.isPending}>
                {activar.isPending ? "Activando…" : "Activar avisos"}
              </Button>
              <Button size="sm" variant="ghost" onClick={cerrar}>
                Ahora no
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
