import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { useDueDateAlerts } from "@/hooks/useNotifications";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  useMentionNotifications,
  useMarkAsRead,
  useMarkAllAsRead,
} from "@/hooks/useMentionNotifications";
import { formatMX } from "@/lib/dateUtils";
import {
  AlertTriangle, CalendarClock, ArrowRight,
  AtSign, CheckCheck, MessageSquare, ClipboardList, DollarSign, Activity,
  Bot, BrainCircuit, Settings, Sparkles, Lightbulb, Bell,
} from "lucide-react";
import { PageHeader, type PageHeaderStat } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  registerWebPushSubscription,
  unregisterWebPushSubscription,
  formatPushRegistrationUserMessage,
} from "@/lib/registerWebPush";
import { playNotificationBeep } from "@/lib/notificationBeep";
import { asistenteChatDeepLinkFromNotification } from "@/lib/asistenteNotificationLink";
import { slackDeepLinkFromNotification } from "@/lib/slackDeepLink";
import { useSlackQuickReply } from "@/contexts/SlackQuickReplyContext";
import { cn } from "@/lib/utils";
import { renderTextWithMentionHighlights } from "@/lib/renderMentionHighlights";
import { Badge } from "@/components/ui/badge";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";
import { NotificationsKawiilCard } from "@/components/notifications/NotificationsKawiilCard";
import { PersonalRemindersPanel } from "@/components/reminders/PersonalRemindersPanel";
import { useReminders } from "@/hooks/useReminders";

type Tab = "menciones" | "actividad" | "sistema" | "vencimientos" | "recordatorios";

const MENTION_TYPES = ["mention", "slack_mention"];
const ACTIVITY_TYPES = [
  "task_assigned",
  "task_reassigned",
  "expense_created",
  "expense_status_changed",
  "slack_message",
];
const KNOWN_TYPES = [...MENTION_TYPES, ...ACTIVITY_TYPES];

/**
 * Devuelve la lista de CTAs explícitas para una notificación según su tipo/entidad.
 * Se renderizan debajo del body (estilo mock v2.4) sin desactivar el clic global de la card.
 */
function getNotificationCtas(
  m: { type: string; entity_type: string | null; entity_id: string | null; entity_ref?: string | null },
): Array<{ key: string; label: string; primary?: boolean }> {
  const ctas: Array<{ key: string; label: string; primary?: boolean }> = [];

  if (m.type === "task_assigned" || m.type === "task_reassigned" || m.entity_type === "task") {
    ctas.push({ key: "open_task", label: "Abrir tarea", primary: true });
  }
  if (m.type === "deadline_overdue_task" || m.type === "deadline_due_tomorrow_task") {
    ctas.push({ key: "open_task", label: "Abrir tarea", primary: true });
  }
  if (m.type === "mention") {
    ctas.push({ key: "reply", label: "Responder", primary: true });
  }
  if (m.type === "slack_message" || m.type === "slack_mention") {
    ctas.push({ key: "quick_slack", label: "Respuesta rápida", primary: true });
    ctas.push({ key: "open_comunicacion", label: "Abrir en Comunicación" });
  }
  if (m.type === "expense_created" || m.type === "expense_status_changed" || m.entity_type === "expense") {
    ctas.push({ key: "open_expense", label: "Ver gasto", primary: true });
  }
  if (m.type === "ai_proactive_tip") {
    ctas.push({ key: "open_assistant", label: "Abrir asistente", primary: true });
  }
  if (m.type === "knowledge_sync" || m.type.startsWith("knowledge")) {
    ctas.push({ key: "open_knowledge", label: "Ver agente", primary: true });
  }
  if (m.type === "improvement_suggestion") {
    ctas.push({ key: "open_suggestion", label: "Ver sugerencia", primary: true });
  }
  if (m.type === "agent_task_completed" || m.type === "agent_task_failed") {
    ctas.push({ key: "open_asistente_conv", label: "Abrir conversación", primary: true });
  }

  return ctas;
}

function getNotificationIcon(type: string) {
  if (type === "task_assigned" || type === "task_reassigned") return <ClipboardList className="h-3.5 w-3.5 text-primary" />;
  if (type === "expense_created" || type === "expense_status_changed") return <DollarSign className="h-3.5 w-3.5 text-emerald-500" />;
  if (type === "knowledge_sync") return <BrainCircuit className="h-3.5 w-3.5 text-sky-500" />;
  if (type.startsWith("knowledge")) return <Bot className="h-3.5 w-3.5 text-sky-500" />;
  if (type === "deadline_overdue_task") return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  if (type === "deadline_due_tomorrow_task") return <CalendarClock className="h-3.5 w-3.5 text-amber-600" />;
  if (type === "improvement_suggestion") return <Lightbulb className="h-3.5 w-3.5 text-amber-500" />;
  if (type === "ai_proactive_tip") return <Sparkles className="h-3.5 w-3.5 text-sky-500" />;
  if (type === "agent_task_completed" || type === "agent_task_failed")
    return <MessageSquare className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" />;
  if (type === "slack_mention") return <AtSign className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" />;
  if (type === "slack_message") return <MessageSquare className="h-3.5 w-3.5 text-sky-600 dark:text-sky-300" />;
  return <Settings className="h-3.5 w-3.5 text-muted-foreground" />;
}

function NotificationAiPreferences() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const profileAiQuery = useQuery({
    queryKey: ["profile-proactive-ai", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("proactive_ai_notifications")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    retry: 2,
  });
  const profile = profileAiQuery.data;

  const updatePref = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from("profiles")
        .update({ proactive_ai_notifications: enabled })
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile-proactive-ai", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo guardar"),
  });

  if (!user) return null;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> IA proactiva
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">Resumen diario en notificaciones</Label>
          <p className="text-xs text-muted-foreground max-w-md">
            Cuando tengas tareas próximas a vencer o atrasadas, podemos enviarte una sugerencia breve por la mañana (zona Ciudad de México).
          </p>
        </div>
        <Switch
          checked={profile?.proactive_ai_notifications !== false}
          disabled={updatePref.isPending || profileAiQuery.isLoading}
          onCheckedChange={(v) => updatePref.mutate(v)}
        />
      </CardContent>
    </Card>
  );
}

function NotificationDeliveryPreferences() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );

  useEffect(() => {
    const sync = () => {
      if (typeof Notification === "undefined") setNotifPerm("unsupported");
      else setNotifPerm(Notification.permission);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  const profileQuery = useQuery({
    queryKey: ["profile-notification-prefs", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "desktop_browser_notifications, desktop_push_notifications, in_app_toast_notifications, notification_sound_enabled, slack_message_sound_enabled, notify_slack_mentions, notify_slack_channel_watch, notify_slack_vip, notify_slack_dm, notify_slack_all_channels",
        )
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    refetchOnWindowFocus: true,
    retry: 2,
  });
  const profile = profileQuery.data;

  /** Solo durante la primera carga con fetch activo. Si la consulta falla, NO bloquear (antes `!profile` dejaba todo gris para siempre). */
  const prefsLocked = profileQuery.isLoading;

  const updateFields = useMutation({
    mutationFn: async (patch: Record<string, boolean>) => {
      const { error } = await supabase.from("profiles").update(patch).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile-notification-prefs", user?.id] });
      qc.invalidateQueries({ queryKey: ["notification-delivery-prefs", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo guardar la configuración"),
  });

  const requestBrowserPermission = useCallback(async () => {
    if (!("Notification" in window)) {
      toast.error("Tu navegador no soporta notificaciones del sistema");
      return;
    }
    const r = await Notification.requestPermission();
    setNotifPerm(Notification.permission);
    if (r === "granted") toast.success("Avisos del sistema activados");
    else
      toast.message("Permiso no concedido", {
        description:
          "Chrome/Edge: candado → Notificaciones → Permitir. Safari (Mac/iPhone): ajustes del sitio o Ajustes → Safari → Notificaciones. Si la app está en un iframe o vista previa, abre Kawiil en una pestaña directa con HTTPS.",
      });
  }, []);

  const registerPush = useMutation({
    mutationFn: async () => {
      if (!vapid?.trim()) {
        throw new Error("VAPID no configurado (VITE_VAPID_PUBLIC_KEY). Configura la variable en el build.");
      }
      if (typeof window !== "undefined" && !window.isSecureContext) {
        throw new Error(
          "Push solo funciona en HTTPS. Abre Kawiil desde la URL publicada (no desde una vista previa insegura).",
        );
      }
      if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        setNotifPerm(Notification.permission);
        if (p !== "granted") {
          throw new Error(
            "Sin permiso de notificaciones no se puede registrar el push. Pulsa «Pedir permiso del navegador» y elige Permitir, o actívalo desde el candado del sitio.",
          );
        }
      }
      await registerWebPushSubscription();
      const { error: uerr } = await supabase
        .from("profiles")
        .update({ desktop_push_notifications: true })
        .eq("user_id", user!.id);
      if (uerr) throw uerr;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile-notification-prefs", user?.id] });
      qc.invalidateQueries({ queryKey: ["comunicacion-push-setup", user?.id] });
      qc.invalidateQueries({ queryKey: ["notification-delivery-prefs", user?.id] });
      toast.success("Avisos con la app cerrada activados");
    },
    onError: (e: Error) => toast.error(formatPushRegistrationUserMessage(e)),
  });

  type PushTestReportItem = {
    subId: string;
    endpointPrefix: string;
    userAgent: string | null;
    statusCode: number | null;
    status: "ok" | "stale_removed" | "error" | "skipped_no_subs" | "skipped_toggle_off";
    errorMessage: string | null;
  };
  type PushTestResponse = {
    ok: boolean;
    reason?: string;
    subsCount?: number;
    okCount?: number;
    staleCount?: number;
    errorCount?: number;
    report?: PushTestReportItem[];
    message?: string;
  };
  const sendTestPush = useMutation<PushTestResponse>({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<PushTestResponse>("push-test", { body: {} });
      if (error) throw error;
      if (!data) throw new Error("Sin respuesta de push-test");
      return data;
    },
    onSuccess: (data) => {
      if (data.ok) {
        toast.success(data.message || "Push de prueba enviado", {
          description:
            data.report && data.report.length
              ? data.report
                  .map(
                    (r) =>
                      `• ${r.status.toUpperCase()} ${r.statusCode ?? "-"} · ${
                        r.userAgent?.includes("Chrome")
                          ? `Chrome${(/Chrome\/(\d+)/.exec(r.userAgent)?.[1]) || ""}`
                          : "desconocido"
                      }`,
                  )
                  .join("\n")
              : undefined,
          duration: 15000,
        });
      } else if (data.reason === "no_subscriptions") {
        toast.message("No hay suscripciones push", {
          description:
            data.message ||
            "Activa «Push con la pestaña cerrada» en este navegador antes de probar.",
        });
      } else if (data.reason === "vapid_not_configured") {
        toast.error(data.message || "VAPID no configurado en Supabase");
      } else {
        toast.message(data.message || "Push de prueba: resultado inesperado");
      }
      qc.invalidateQueries({ queryKey: ["profile-notification-prefs", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message || "No se pudo enviar el push de prueba"),
  });

  const cleanAndReregister = useMutation({
    mutationFn: async () => {
      if (!vapid?.trim()) throw new Error("VAPID no configurado (VITE_VAPID_PUBLIC_KEY).");
      if (typeof window !== "undefined" && !window.isSecureContext) {
        throw new Error("Push solo funciona en HTTPS. Abre Kawiil desde la URL publicada.");
      }
      if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        setNotifPerm(Notification.permission);
        if (p !== "granted") {
          throw new Error(
            "Permiso de notificaciones denegado. Concédelo en el candado del sitio y vuelve a intentarlo.",
          );
        }
      }
      try {
        await unregisterWebPushSubscription();
      } catch (e) {
        console.warn("unregister previo fallo, continuamos:", e);
      }
      await registerWebPushSubscription();
      const { error } = await supabase
        .from("profiles")
        .update({ desktop_push_notifications: true })
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile-notification-prefs", user?.id] });
      qc.invalidateQueries({ queryKey: ["comunicacion-push-setup", user?.id] });
      toast.success(
        "Push re-registrado. Ahora deberías tener solo la suscripción de este navegador. Pulsa «Enviar push de prueba».",
      );
    },
    onError: (e: Error) => toast.error(formatPushRegistrationUserMessage(e)),
  });

  const toggleDesktopPush = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!enabled) {
        try {
          await unregisterWebPushSubscription();
        } catch (cleanupErr) {
          console.warn("push cleanup warning:", cleanupErr);
        }
        const { error } = await supabase
          .from("profiles")
          .update({ desktop_push_notifications: false })
          .eq("user_id", user!.id);
        if (error) throw error;
        return;
      }
      if (!vapid?.trim()) {
        throw new Error("VAPID no configurado (VITE_VAPID_PUBLIC_KEY). Configura la variable en el build.");
      }
      if (typeof window !== "undefined" && !window.isSecureContext) {
        throw new Error(
          "Push solo funciona en HTTPS. Abre Kawiil desde la URL publicada (no desde una vista previa insegura).",
        );
      }
      if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        setNotifPerm(Notification.permission);
        if (p !== "granted") {
          throw new Error(
            "Permiso de notificaciones denegado. Actívalo en el candado del sitio o con «Pedir permiso del navegador».",
          );
        }
      }
      await registerWebPushSubscription();
      const { error } = await supabase
        .from("profiles")
        .update({ desktop_push_notifications: true })
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: (_, enabled) => {
      qc.invalidateQueries({ queryKey: ["profile-notification-prefs", user?.id] });
      qc.invalidateQueries({ queryKey: ["comunicacion-push-setup", user?.id] });
      if (typeof Notification !== "undefined") setNotifPerm(Notification.permission);
      if (enabled) toast.success("Push activado: recibirás avisos aunque cierres la pestaña");
    },
    onError: (e: Error) => toast.error(formatPushRegistrationUserMessage(e)),
  });

  const notifPermLabel =
    notifPerm === "unsupported"
      ? "No disponible en este navegador"
      : notifPerm === "granted"
        ? "Concedido"
        : notifPerm === "denied"
          ? "Denegado (revisa candado del sitio)"
          : "Pendiente — usa «Pedir permiso del navegador»";

  const prefsSaving = updateFields.isPending;
  const vapidReady = !!vapid?.trim();
  /** Sin VAPID solo se puede apagar push si ya estaba activo; encender siempre requiere clave pública en el build. */
  const pushSwitchDisabled =
    prefsLocked ||
    toggleDesktopPush.isPending ||
    (!vapidReady && profile?.desktop_push_notifications !== true);

  if (!user) return null;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bell className="h-4 w-4" /> Avisos en el equipo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {profileQuery.isError && (
          <Alert variant="destructive" className="py-3">
            <AlertTitle className="text-sm">No se pudo cargar la configuración de avisos</AlertTitle>
            <AlertDescription className="text-xs mt-1 space-y-2">
              <p>{(profileQuery.error as Error)?.message || "Error desconocido"}</p>
              <p className="text-muted-foreground">
                Si el mensaje menciona una columna o esquema, ejecuta las migraciones recientes de{" "}
                <code className="rounded bg-background/80 px-1">profiles</code> en Supabase (p. ej.{" "}
                <code className="rounded bg-background/80 px-1">notification_sound_enabled</code>, push).
              </p>
              <Button type="button" size="sm" variant="secondary" onClick={() => profileQuery.refetch()}>
                Reintentar
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {prefsLocked && (
          <p className="text-xs text-muted-foreground">Cargando preferencias…</p>
        )}
        {profileQuery.isError && (
          <p className="text-xs text-muted-foreground">
            Mientras tanto puedes cambiar las opciones; si al guardar aparece error, revisa el mensaje de arriba o las migraciones de{" "}
            <code className="rounded bg-muted px-1">profiles</code>.
          </p>
        )}
        {!vapidReady && (
          <Alert className="border-amber-600/50 bg-amber-950/25 py-3">
            <AlertTitle className="text-sm text-amber-100">Push con la pestaña cerrada no disponible en este entorno</AlertTitle>
            <AlertDescription className="text-xs text-amber-50/90 mt-1">
              Falta la variable{" "}
              <code className="rounded bg-black/30 px-1">VITE_VAPID_PUBLIC_KEY</code> en el build (p. ej. Lovable →
              Variables de entorno) y los secretos VAPID en Supabase Edge. Mientras tanto puedes usar avisos en la app,
              notificación del navegador y pitido en esta pestaña.
            </AlertDescription>
          </Alert>
        )}
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Ventana emergente en la app (Sonner)</Label>
            <p className="text-xs text-muted-foreground max-w-md">
              Popup dentro de Kawiil al llegar una notificación nueva. Puedes desactivarlo si prefieres solo aviso del
              sistema o silencio.
            </p>
          </div>
          <Switch
            checked={profile?.in_app_toast_notifications !== false}
            disabled={prefsLocked || prefsSaving}
            onCheckedChange={(v) => updateFields.mutate({ in_app_toast_notifications: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Aviso del navegador / escritorio</Label>
            <p className="text-xs text-muted-foreground max-w-md">
              Notificación del sistema mientras Kawiil está abierto (requiere permiso del navegador). El sonido del
              sistema lo controla tu equipo (volumen, Focus en macOS, etc.).
            </p>
            <p className="text-[11px] text-muted-foreground/90">Permiso actual: {notifPermLabel}</p>
          </div>
          <Switch
            checked={profile?.desktop_browser_notifications !== false}
            disabled={prefsLocked || prefsSaving}
            onCheckedChange={(v) => updateFields.mutate({ desktop_browser_notifications: v })}
          />
        </div>
        {notifPerm === "default" && profile?.desktop_browser_notifications !== false && (
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2.5 space-y-2">
            <p className="text-xs text-foreground/90">
              El navegador aún no ha concedido permiso para notificaciones del escritorio. Sin él solo verás el
              popup dentro de Kawiil, no el aviso del sistema junto al reloj.
            </p>
            <Button type="button" size="sm" variant="secondary" onClick={requestBrowserPermission}>
              Conceder permiso ahora
            </Button>
          </div>
        )}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5 min-w-0">
            <Label className="text-sm font-medium">Pitido breve al avisar</Label>
            <p className="text-xs text-muted-foreground max-w-md">
              Beep suave en esta pestaña cuando se muestra un aviso (toast o notificación del sistema). Algunos
              navegadores bloquean audio hasta que hagas clic en la página; usa «Probar» tras interactuar.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 h-7 text-xs"
              onClick={() => {
                playNotificationBeep();
                toast.success("Pitido de prueba");
              }}
            >
              Probar pitido
            </Button>
          </div>
          <Switch
            checked={profile?.notification_sound_enabled === true}
            disabled={prefsLocked || prefsSaving}
            onCheckedChange={(v) => updateFields.mutate({ notification_sound_enabled: v })}
            className="shrink-0"
          />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-0.5 min-w-0">
            <Label className="text-sm font-medium">Sonido al avisar mensajes de Slack</Label>
            <p className="text-xs text-muted-foreground max-w-md">
              Pitido en esta pestaña cuando llega un mensaje o mención de Slack (si se muestra toast o notificación del
              sistema). Independiente del pitido global de arriba.
            </p>
          </div>
          <Switch
            checked={profile?.slack_message_sound_enabled !== false}
            disabled={prefsLocked || prefsSaving}
            onCheckedChange={(v) => updateFields.mutate({ slack_message_sound_enabled: v })}
            className="shrink-0"
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Push con la pestaña cerrada</Label>
            <p className="text-xs text-muted-foreground max-w-md">
              Recibe avisos aunque no tengas Kawiil abierto (Slack y otras notificaciones que envíen push).
            </p>
          </div>
          <Switch
            checked={profile?.desktop_push_notifications === true}
            disabled={pushSwitchDisabled}
            onCheckedChange={(v) => toggleDesktopPush.mutate(v)}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Slack: todos los chats donde participas</Label>
            <p className="text-xs text-muted-foreground max-w-md">
              Aviso por cada mensaje en canales y grupos privados en los que estás (como tener el canal activo en Slack).
              Puedes silenciar conversaciones puntuales con la campana en Comunicación; las @menciones siguen llegando.
            </p>
          </div>
          <Switch
            checked={profile?.notify_slack_all_channels !== false}
            disabled={prefsLocked || prefsSaving}
            onCheckedChange={(v) => updateFields.mutate({ notify_slack_all_channels: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Slack: conversaciones destacadas</Label>
            <p className="text-xs text-muted-foreground max-w-md">
              Avisos para los chats que marques con la estrella en Comunicación (lista «Destacados»). Si lo desactivas
              aquí, no recibirás esos avisos aunque sigan en la lista.
            </p>
          </div>
          <Switch
            checked={profile?.notify_slack_vip !== false}
            disabled={prefsLocked || prefsSaving}
            onCheckedChange={(v) => updateFields.mutate({ notify_slack_vip: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Slack: avisarme si me @mencionan</Label>
            <p className="text-xs text-muted-foreground max-w-md">
              Esta categoría es obligatoria por seguridad operativa: las menciones siempre notifican en app y sistema.
            </p>
          </div>
          <Switch
            checked={true}
            disabled={true}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Slack: canales que sigo en Comunicación</Label>
          </div>
          <Switch
            checked={profile?.notify_slack_channel_watch !== false}
            disabled={prefsLocked || prefsSaving}
            onCheckedChange={(v) => updateFields.mutate({ notify_slack_channel_watch: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Slack: MD y grupos privados</Label>
            <p className="text-xs text-muted-foreground max-w-md">
              Avisos cuando te escriben por mensaje directo o grupo privado (sin @mención).
            </p>
          </div>
          <Switch
            checked={profile?.notify_slack_dm !== false}
            disabled={prefsLocked || prefsSaving}
            onCheckedChange={(v) => updateFields.mutate({ notify_slack_dm: v })}
          />
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button type="button" variant="outline" size="sm" onClick={requestBrowserPermission}>
            Pedir permiso del navegador
          </Button>
          {vapid?.trim() ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => registerPush.mutate()}
              disabled={registerPush.isPending}
            >
              Registrar push (app cerrada)
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => sendTestPush.mutate()}
            disabled={sendTestPush.isPending}
            title="Envía un push de prueba a tus suscripciones actuales para diagnosticar el banner del sistema."
          >
            Enviar push de prueba
          </Button>
          {vapid?.trim() ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => cleanAndReregister.mutate()}
              disabled={cleanAndReregister.isPending}
              title="Elimina todas tus suscripciones push (incluidas pestañas/equipos viejos) y registra solo este navegador."
            >
              Limpiar y re-registrar push
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Por defecto recibes avisos de los canales en los que participas; usa la campana en la lista de Comunicación
          para silenciar uno concreto. La opción &quot;canales que sigo&quot; añade avisos extra si marcas seguimiento en
          un canal. En Slack usa la misma URL de eventos que slash commands (<code className="text-[11px]">slack-events</code>).
        </p>
      </CardContent>
    </Card>
  );
}

export default function Notificaciones() {
  const navigate = useNavigate();
  const { openSlackQuickReply } = useSlackQuickReply();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: alerts, isLoading: loadingAlerts } = useDueDateAlerts();
  const { data: allNotifications = [], isLoading: loadingMentions } = useMentionNotifications();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const [tab, setTab] = useState<Tab>("menciones");
  const { reminders } = useReminders();
  const pendingRemindersCount = reminders.filter((r) => !r.is_completed).length;

  useEffect(() => {
    const t = searchParams.get("tab");
    if (
      t === "sistema" ||
      t === "actividad" ||
      t === "menciones" ||
      t === "vencimientos" ||
      t === "recordatorios"
    ) {
      setTab(t as Tab);
    }
  }, [searchParams]);

  const setTabAndUrl = useCallback(
    (next: Tab) => {
      setTab(next);
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === "menciones") p.delete("tab");
          else p.set("tab", next);
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const mentions = allNotifications.filter((n) => MENTION_TYPES.includes(n.type));
  const activityItems = allNotifications.filter((n) => ACTIVITY_TYPES.includes(n.type));
  const sistemaItems = allNotifications.filter((n) => !KNOWN_TYPES.includes(n.type));
  const unreadMentions = mentions.filter((m) => !m.is_read);
  const unreadActivity = activityItems.filter((a) => !a.is_read);
  const unreadSistema = sistemaItems.filter((s) => !s.is_read);

  const hasOverdue =
    (alerts?.overdue?.length ?? 0) > 0 || (alerts?.stepsOverdue?.length ?? 0) > 0;
  const hasDueSoon =
    (alerts?.dueSoon?.length ?? 0) > 0 || (alerts?.stepsDueSoon?.length ?? 0) > 0;

  const handleNotificationClick = (m: typeof allNotifications[0], ctaKey?: string) => {
    if (!m.is_read) markAsRead.mutate(m.id);

    if (
      (m.type === "slack_message" || m.type === "slack_mention") &&
      m.entity_type === "slack" &&
      ctaKey === "quick_slack"
    ) {
      openSlackQuickReply({
        entity_ref: m.entity_ref ?? null,
        entity_id: m.entity_id,
        entity_type: m.entity_type,
        notificationTitle: m.title,
      });
      return;
    }

    if (m.entity_type === "project" && m.entity_id) {
      navigate(`/proyectos/${m.entity_id}?tab=comentarios`);
    } else if (m.entity_type === "task" && m.entity_id) {
      navigate(`/tareas?taskId=${m.entity_id}`);
    } else if (m.entity_type === "expense") {
      navigate("/finanzas");
    } else if (m.type === "knowledge_sync") {
      navigate("/conocimiento?tab=agentes");
    } else if (m.entity_type === "knowledge") {
      navigate("/conocimiento?tab=clientes");
    } else if (m.type === "task_assigned" || m.type === "task_reassigned") {
      navigate("/tareas");
    } else if (m.type === "expense_created" || m.type === "expense_status_changed") {
      navigate("/finanzas");
    } else if (m.type === "deadline_overdue_task" || m.type === "deadline_due_tomorrow_task") {
      if (m.entity_id) navigate(`/tareas?taskId=${m.entity_id}`);
      else navigate("/tareas");
    } else if (m.type === "improvement_suggestion") {
      navigate("/conocimiento?tab=sugerencias");
    } else if (m.type === "ai_proactive_tip") {
      navigate("/");
    } else {
      const asistenteUrl = asistenteChatDeepLinkFromNotification(m);
      if (asistenteUrl) {
        navigate(asistenteUrl);
        return;
      }
      const slackUrl = slackDeepLinkFromNotification({
        entity_type: m.entity_type,
        entity_ref: m.entity_ref,
        entity_id: m.entity_id,
        type: m.type,
      });
      if (slackUrl) {
        navigate(slackUrl);
      } else if (
        m.entity_type === "slack" ||
        m.type === "slack_message" ||
        m.type === "slack_mention"
      ) {
        navigate("/comunicacion");
      }
    }
  };

  const handleTaskAlertClick = (t: { id: string; project_id?: string | null }) => {
    if (t.project_id) {
      navigate(`/proyectos/${t.project_id}?tab=tareas&taskId=${t.id}`);
    } else {
      navigate(`/tareas?taskId=${t.id}`);
    }
  };

  const handleStepAlertClick = (s: { project_id: string; step_key: string }) => {
    navigate(`/proyectos/${s.project_id}?tab=contabilidad&step=${s.step_key}`);
  };

  const isLoading = loadingAlerts || loadingMentions;

  const currentList = tab === "menciones" ? mentions : tab === "actividad" ? activityItems : tab === "sistema" ? sistemaItems : [];
  const currentUnread = tab === "menciones" ? unreadMentions : tab === "actividad" ? unreadActivity : unreadSistema;

  const tabs: { key: Tab; label: string; icon: React.ReactNode; badge?: number }[] = [
    { key: "menciones", label: "Menciones", icon: <AtSign className="h-3 w-3" />, badge: unreadMentions.length },
    { key: "recordatorios", label: "Recordatorios", icon: <Bell className="h-3 w-3" />, badge: pendingRemindersCount },
    { key: "actividad", label: "Actividad", icon: <Activity className="h-3 w-3" />, badge: unreadActivity.length },
    { key: "sistema", label: "Sistema", icon: <BrainCircuit className="h-3 w-3" />, badge: unreadSistema.length },
    { key: "vencimientos", label: "Vencimientos", icon: <CalendarClock className="h-3 w-3" /> },
  ];

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          variant="hero"
          breadcrumb={["Kawiil OS", "Avisos", "Notificaciones"]}
          icon={<Bell />}
          iconAccent={KAWIIL_AI_GRADIENT}
          title="Notificaciones"
          description="Menciones, actividad del equipo, alertas de vencimiento y tus recordatorios personales"
          actions={
            <Badge
              variant="outline"
              className="hidden sm:inline-flex border-sky-300/70 bg-sky-50/70 text-sky-700 dark:border-sky-400/40 dark:bg-sky-400/10 dark:text-sky-300"
            >
              v2.4
            </Badge>
          }
          stats={[
            {
              label: "Sin leer",
              value: unreadMentions.length + unreadActivity.length + unreadSistema.length,
              tone: (unreadMentions.length + unreadActivity.length + unreadSistema.length) > 0 ? "primary" : "default",
              sub: "Total en bandeja",
            },
            {
              label: "Menciones",
              value: unreadMentions.length,
              tone: unreadMentions.length > 0 ? "warning" : "default",
              sub: `${mentions.length} totales`,
            },
            {
              label: "Actividad",
              value: unreadActivity.length,
              tone: unreadActivity.length > 0 ? "primary" : "default",
              sub: "Equipo · últimas 24h",
            },
            {
              label: "Vencimientos",
              value:
                (alerts?.overdue?.length ?? 0) +
                (alerts?.stepsOverdue?.length ?? 0) +
                (alerts?.dueSoon?.length ?? 0) +
                (alerts?.stepsDueSoon?.length ?? 0),
              tone: hasOverdue ? "warning" : hasDueSoon ? "primary" : "default",
              sub: hasOverdue ? "Atender hoy" : "Próximos 14 días",
            },
            {
              label: "Sistema",
              value: unreadSistema.length,
              tone: unreadSistema.length > 0 ? "primary" : "default",
              sub: "IA · agentes · push",
            },
          ] satisfies PageHeaderStat[]}
        />

        {!isLoading && (
          <NotificationsKawiilCard
            unreadMentions={unreadMentions.length}
            totalMentions={mentions.length}
            unreadActivity={unreadActivity.length}
            totalActivity={activityItems.length}
            unreadSistema={unreadSistema.length}
            alertCounts={{
              overdueTasks: alerts?.overdue?.length ?? 0,
              overdueSteps: alerts?.stepsOverdue?.length ?? 0,
              dueSoonTasks: alerts?.dueSoon?.length ?? 0,
              dueSoonSteps: alerts?.stepsDueSoon?.length ?? 0,
            }}
            topMentionTitle={unreadMentions[0]?.title ?? null}
            topMentionBody={unreadMentions[0]?.body ?? null}
            topMentionAuthor={unreadMentions[0]?.source_profile?.full_name ?? null}
            onGoToTab={(t) => setTabAndUrl(t as Tab)}
            onMarkAllRead={() => markAllAsRead.mutate()}
            markAllPending={markAllAsRead.isPending}
          />
        )}

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 rounded-2xl bg-secondary/30 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {/* Tab pills */}
            <div className="surface-toolbar -mx-1 flex flex-nowrap gap-1.5 overflow-x-auto px-3 py-2 scrollbar-hide sm:mx-0 sm:px-4">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTabAndUrl(t.key)}
                  className={`tab-pill inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap ${
                    tab === t.key ? "tab-pill-active" : "tab-pill-inactive"
                  }`}
                >
                  {t.icon}
                  {t.label}
                  {(t.badge ?? 0) > 0 && (
                    <span className="bg-primary-foreground/20 text-[10px] rounded-full px-1.5 font-bold animate-pulse-soft">
                      {t.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Mentions, Activity & Sistema lists */}
            {(tab === "menciones" || tab === "actividad" || tab === "sistema") && (
              <div className="space-y-4">
                {tab === "menciones" &&
                  mentions.some((m) => m.type === "slack_mention" && !m.is_read) && (
                    <div className="flex justify-start">
                      <button
                        type="button"
                        onClick={() => navigate("/comunicacion?activity=mentions")}
                        className="inline-flex items-center gap-1.5 rounded-full border border-sky-200/70 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100 transition-colors dark:border-sky-800/40 dark:bg-sky-950/30 dark:text-sky-300"
                      >
                        <MessageSquare className="h-3 w-3" />
                        Abrir en Slack · Actividad
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                {currentUnread.length > 0 && (
                  <div className="flex justify-end">
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                      onClick={() => markAllAsRead.mutate()}
                      disabled={markAllAsRead.isPending}
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      Marcar todas como leídas
                    </button>
                  </div>
                )}

                {currentList.length === 0 ? (
                  <div className="text-center py-16">
                    {tab === "menciones" ? (
                      <>
                        <MessageSquare className="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <p className="mt-3 text-sm text-muted-foreground">
                          Sin menciones aún. Cuando alguien te @mencione aparecerá aquí.
                        </p>
                      </>
                    ) : tab === "actividad" ? (
                      <>
                        <Activity className="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <p className="mt-3 text-sm text-muted-foreground">
                          Sin actividad reciente. Asignaciones, gastos y mensajes de Slack (@mención o canal en seguimiento) aparecerán aquí.
                        </p>
                      </>
                    ) : (
                      <>
                        <BrainCircuit className="mx-auto h-10 w-10 text-muted-foreground/40" />
                        <p className="mt-3 text-sm text-muted-foreground">
                          Sin notificaciones de sistema. Los agentes de conocimiento y otros procesos aparecerán aquí.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {currentList.map((m, i) => (
                      <div
                        key={m.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-3 shadow-sm transition-shadow duration-200 animate-fade-in hover:shadow-md",
                          m.is_read
                            ? "border-border/60 bg-card hover:border-border/80"
                            : "border-primary/25 bg-primary/[0.05] hover:border-primary/35",
                        )}
                        style={{ animationDelay: `${Math.min(i, 8) * 30}ms`, animationFillMode: "both" }}
                        onClick={() => handleNotificationClick(m)}
                      >
                        {tab === "menciones" ? (
                          <UserAvatar
                            name={m.source_profile?.full_name}
                            avatarUrl={m.source_profile?.avatar_url}
                            userId={m.source_user_id}
                            size="md"
                            className="h-7 w-7 shrink-0 mt-0.5"
                          />
                        ) : (
                          <div className="h-7 w-7 shrink-0 mt-0.5 rounded-full bg-secondary flex items-center justify-center">
                            {getNotificationIcon(m.type)}
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-foreground">
                              {m.title}
                            </span>
                            {!m.is_read && (
                              <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                            )}
                          </div>
                          {m.body && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {renderTextWithMentionHighlights(m.body, `notif-${m.id}`)}
                            </p>
                          )}
                          {(() => {
                            const ctas = getNotificationCtas({
                              type: m.type,
                              entity_type: m.entity_type,
                              entity_id: m.entity_id,
                              entity_ref: m.entity_ref,
                            });
                            if (ctas.length === 0) return null;
                            return (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {ctas.map((c) => (
                                  <Button
                                    key={c.key}
                                    type="button"
                                    size="sm"
                                    variant={c.primary ? "default" : "outline"}
                                    className="h-7 px-2.5 text-[11px]"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleNotificationClick(m, c.key);
                                    }}
                                  >
                                    {c.label}
                                  </Button>
                                ))}
                              </div>
                            );
                          })()}
                          <span className="text-[11px] text-muted-foreground mt-1.5 block">
                            {formatMX(m.created_at, "dd MMM yyyy HH:mm")}
                          </span>
                        </div>
                        <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0 mt-2" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {tab === "recordatorios" && (
              <div className="space-y-4 animate-fade-in">
                <PersonalRemindersPanel showConfigureNotificationsButton={false} />
              </div>
            )}

            {/* Due dates */}
            {tab === "vencimientos" && (
              <div className="space-y-8 animate-fade-in">
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    <h2 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide">Vencidas</h2>
                  </div>
                  {hasOverdue ? (
                    <div className="divide-y divide-border/40">
                      {(alerts?.overdue ?? []).map((t) => (
                        <div
                          key={t.id}
                          className="py-3 px-2 -mx-2 cursor-pointer hover:bg-secondary/30 rounded-lg transition-colors"
                          onClick={() => handleTaskAlertClick(t)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-medium text-foreground">{t.title}</span>
                            <span className="text-[11px] text-destructive shrink-0">
                              Venció {formatMX(t.due_date, "dd MMM yyyy")}
                            </span>
                          </div>
                          {(t.client_name || t.project_name) && (
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {[t.client_name, t.project_name].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </div>
                      ))}
                      {(alerts?.stepsOverdue ?? []).map((s) => (
                        <div
                          key={s.id}
                          className="py-3 px-2 -mx-2 cursor-pointer hover:bg-secondary/30 rounded-lg transition-colors"
                          onClick={() => handleStepAlertClick(s)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[13px] font-medium text-foreground">{s.label}</span>
                            <span className="text-[11px] text-destructive shrink-0">
                              Venció {formatMX(s.due_date, "dd MMM yyyy")}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {s.project_name} — {s.period_label}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-4">No hay tareas vencidas.</p>
                  )}
                </section>

                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <CalendarClock className="h-3.5 w-3.5 text-warning" />
                    <h2 className="text-[13px] font-medium text-muted-foreground uppercase tracking-wide">Por vencer (14 días)</h2>
                  </div>
                  {hasDueSoon ? (
                    <div className="divide-y divide-border/40">
                      {(alerts?.dueSoon ?? []).map((t) => (
                        <div
                          key={t.id}
                          className="py-3 px-2 -mx-2 cursor-pointer hover:bg-secondary/30 rounded-lg transition-colors"
                          onClick={() => handleTaskAlertClick(t)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[13px] font-medium text-foreground">{t.title}</p>
                              {(t.client_name || t.project_name) && (
                                <p className="text-[11px] text-muted-foreground mt-0.5">
                                  {[t.client_name, t.project_name].filter(Boolean).join(" · ")}
                                </p>
                              )}
                            </div>
                            <span className="text-[11px] text-warning shrink-0">
                              Vence {formatMX(t.due_date, "dd MMM yyyy")}
                            </span>
                          </div>
                        </div>
                      ))}
                      {(alerts?.stepsDueSoon ?? []).map((s) => (
                        <div
                          key={s.id}
                          className="py-3 px-2 -mx-2 cursor-pointer hover:bg-secondary/30 rounded-lg transition-colors"
                          onClick={() => handleStepAlertClick(s)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <p className="text-[13px] font-medium text-foreground">{s.label}</p>
                              <p className="text-[11px] text-muted-foreground">{s.project_name} — {s.period_label}</p>
                            </div>
                            <span className="text-[11px] text-warning shrink-0">
                              Vence {formatMX(s.due_date, "dd MMM yyyy")}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground py-4">No hay tareas por vencer en los próximos 14 días.</p>
                  )}
                </section>
              </div>
            )}

          </>
        )}

        {/* Preferencias al final, separadas por un divider sutil */}
        <div className="space-y-4 pt-4 border-t border-border/40">
          <div>
            <h2 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Preferencias de notificaciones
            </h2>
            <p className="text-xs text-muted-foreground/80">
              Cómo y dónde quieres recibir cada tipo de aviso.
            </p>
          </div>
          <NotificationDeliveryPreferences />
          <NotificationAiPreferences />
        </div>
      </div>
    </AppLayout>
  );
}
