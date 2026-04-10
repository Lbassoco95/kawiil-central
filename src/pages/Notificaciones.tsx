import { useState, useEffect, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/AppLayout";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { registerWebPushSubscription } from "@/lib/registerWebPush";

type Tab = "menciones" | "actividad" | "sistema" | "vencimientos";

const MENTION_TYPES = ["mention"];
const ACTIVITY_TYPES = [
  "task_assigned",
  "task_reassigned",
  "expense_created",
  "expense_status_changed",
  "slack_message",
];
const KNOWN_TYPES = [...MENTION_TYPES, ...ACTIVITY_TYPES];

function getNotificationIcon(type: string) {
  if (type === "task_assigned" || type === "task_reassigned") return <ClipboardList className="h-3.5 w-3.5 text-primary" />;
  if (type === "expense_created" || type === "expense_status_changed") return <DollarSign className="h-3.5 w-3.5 text-emerald-500" />;
  if (type === "knowledge_sync") return <BrainCircuit className="h-3.5 w-3.5 text-violet-500" />;
  if (type.startsWith("knowledge")) return <Bot className="h-3.5 w-3.5 text-violet-500" />;
  if (type === "deadline_overdue_task") return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  if (type === "deadline_due_tomorrow_task") return <CalendarClock className="h-3.5 w-3.5 text-amber-600" />;
  if (type === "improvement_suggestion") return <Lightbulb className="h-3.5 w-3.5 text-amber-500" />;
  if (type === "ai_proactive_tip") return <Sparkles className="h-3.5 w-3.5 text-primary" />;
  if (type === "slack_message") return <MessageSquare className="h-3.5 w-3.5 text-[#611f69]" />;
  return <Settings className="h-3.5 w-3.5 text-muted-foreground" />;
}

function NotificationAiPreferences() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: profile } = useQuery({
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
  });

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
          disabled={updatePref.isPending || !profile}
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

  const { data: profile } = useQuery({
    queryKey: ["profile-notification-prefs", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "desktop_browser_notifications, desktop_push_notifications, notify_slack_mentions, notify_slack_channel_watch, notify_slack_vip",
        )
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const updateFields = useMutation({
    mutationFn: async (patch: Record<string, boolean>) => {
      const { error } = await supabase.from("profiles").update(patch).eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile-notification-prefs", user?.id] });
      qc.invalidateQueries({ queryKey: ["notification-delivery-prefs", user?.id] });
    },
  });

  const requestBrowserPermission = useCallback(async () => {
    if (!("Notification" in window)) {
      toast.error("Tu navegador no soporta notificaciones del sistema");
      return;
    }
    const r = await Notification.requestPermission();
    if (r === "granted") toast.success("Avisos del sistema activados");
    else
      toast.message("Permiso no concedido", {
        description: "Actívalo en la configuración del sitio (candado en la barra de direcciones).",
      });
  }, []);

  const registerPush = useMutation({
    mutationFn: async () => {
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
      toast.success("Avisos con la app cerrada activados");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleDesktopPush = useMutation({
    mutationFn: async (enabled: boolean) => {
      if (!enabled) {
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
      if (typeof Notification !== "undefined" && Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        if (p !== "granted") {
          throw new Error("Permiso de notificaciones denegado. Actívalo en el candado del sitio.");
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
      if (enabled) toast.success("Push activado: recibirás avisos aunque cierres la pestaña");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!user) return null;

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Bell className="h-4 w-4" /> Avisos en el equipo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Ventana emergente en la app (Sonner)</Label>
            <p className="text-xs text-muted-foreground">Siempre activo al recibir notificaciones.</p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Aviso del navegador / escritorio</Label>
            <p className="text-xs text-muted-foreground max-w-md">
              Notificación del sistema mientras Kawiil está abierto (requiere permiso del navegador).
            </p>
          </div>
          <Switch
            checked={profile?.desktop_browser_notifications !== false}
            disabled={updateFields.isPending || !profile}
            onCheckedChange={(v) => updateFields.mutate({ desktop_browser_notifications: v })}
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
            disabled={toggleDesktopPush.isPending || updateFields.isPending || !profile}
            onCheckedChange={(v) => toggleDesktopPush.mutate(v)}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Slack: conversaciones VIP (siempre notificar)</Label>
            <p className="text-xs text-muted-foreground max-w-md">
              Marca canales o DMs como VIP en Comunicación. Si lo desactivas, conservas la lista pero no recibes avisos.
            </p>
          </div>
          <Switch
            checked={profile?.notify_slack_vip !== false}
            disabled={updateFields.isPending || !profile}
            onCheckedChange={(v) => updateFields.mutate({ notify_slack_vip: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Slack: avisarme si me @mencionan</Label>
          </div>
          <Switch
            checked={profile?.notify_slack_mentions !== false}
            disabled={updateFields.isPending || !profile}
            onCheckedChange={(v) => updateFields.mutate({ notify_slack_mentions: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">Slack: canales que sigo en Comunicación</Label>
          </div>
          <Switch
            checked={profile?.notify_slack_channel_watch !== false}
            disabled={updateFields.isPending || !profile}
            onCheckedChange={(v) => updateFields.mutate({ notify_slack_channel_watch: v })}
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
        </div>
        <p className="text-xs text-muted-foreground">
          En Comunicación activa &quot;Avisos de mensajes&quot; en un canal para enterarte sin @mención. En Slack
          configura la misma URL de eventos que slash commands (<code className="text-[11px]">slack-events</code>).
        </p>
      </CardContent>
    </Card>
  );
}

export default function Notificaciones() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { data: alerts, isLoading: loadingAlerts } = useDueDateAlerts();
  const { data: allNotifications = [], isLoading: loadingMentions } = useMentionNotifications();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const [tab, setTab] = useState<Tab>("menciones");

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "sistema" || t === "actividad" || t === "menciones" || t === "vencimientos") {
      setTab(t as Tab);
    }
  }, [searchParams]);

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

  const handleNotificationClick = (m: typeof allNotifications[0]) => {
    if (!m.is_read) markAsRead.mutate(m.id);

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
    } else if (m.entity_type === "slack" && m.entity_id) {
      const pipe = m.entity_id.indexOf("|");
      if (pipe > 0) {
        const ch = m.entity_id.slice(0, pipe);
        const ts = m.entity_id.slice(pipe + 1);
        navigate(`/comunicacion?channel=${encodeURIComponent(ch)}&ts=${encodeURIComponent(ts)}`);
      } else {
        navigate("/comunicacion");
      }
    } else if (m.type === "slack_message") {
      navigate("/comunicacion");
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
    { key: "actividad", label: "Actividad", icon: <Activity className="h-3 w-3" />, badge: unreadActivity.length },
    { key: "sistema", label: "Sistema", icon: <BrainCircuit className="h-3 w-3" />, badge: unreadSistema.length },
    { key: "vencimientos", label: "Vencimientos", icon: <CalendarClock className="h-3 w-3" /> },
  ];

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          title="Notificaciones"
          description="Menciones, actividad del equipo y alertas de vencimiento"
        />

        {isLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 rounded-2xl bg-secondary/30 animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {/* Tab pills */}
            <div className="flex gap-1.5 overflow-x-auto flex-nowrap pb-1 -mx-1 px-1 scrollbar-hide">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
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
                        className={`flex items-start gap-3 py-3 px-3 rounded-2xl cursor-pointer transition-all duration-300 border border-border/40 backdrop-blur-sm animate-fade-in hover:shadow-md hover:-translate-y-0.5 ${
                          m.is_read
                            ? "bg-card/60 hover:bg-card/80"
                            : "bg-primary/[0.04] border-primary/15 hover:bg-primary/[0.07]"
                        }`}
                        style={{ animationDelay: `${Math.min(i, 8) * 30}ms`, animationFillMode: "both" }}
                        onClick={() => handleNotificationClick(m)}
                      >
                        {tab === "menciones" ? (
                          <Avatar className="h-7 w-7 shrink-0 mt-0.5">
                            <AvatarFallback className="text-[10px] bg-secondary">
                              {m.source_profile?.full_name?.charAt(0) || "?"}
                            </AvatarFallback>
                          </Avatar>
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
                              {m.body}
                            </p>
                          )}
                          <span className="text-[11px] text-muted-foreground mt-1 block">
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

            <NotificationDeliveryPreferences />
            <NotificationAiPreferences />
          </>
        )}
      </div>
    </AppLayout>
  );
}
