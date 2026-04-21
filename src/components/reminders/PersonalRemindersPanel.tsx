import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useReminders, type ReminderCreateInput } from "@/hooks/useReminders";
import { ReminderCreateDialog } from "@/components/reminders/ReminderCreateDialog";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import { formatDateMX } from "@/lib/dateUtils";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";

type Props = {
  /** En la página Notificaciones oculta el botón que lleva a la misma ruta. */
  showConfigureNotificationsButton?: boolean;
  configureNotificationsHref?: string;
};

function repeatShortLabel(rk: string | undefined) {
  const m: Record<string, string> = {
    none: "Solo lista",
    hourly_digest: "Cada hora",
    daily_digest: "Diario",
  };
  return m[rk ?? "hourly_digest"] ?? "Cada hora";
}

function formatReminderDueTime(t: string | null | undefined) {
  if (!t) return null;
  return t.slice(0, 5);
}

export function PersonalRemindersPanel({
  showConfigureNotificationsButton = true,
  configureNotificationsHref = "/notificaciones?tab=recordatorios",
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const today = useMexicoToday();

  const { data: profile } = useQuery({
    queryKey: ["dashboard-profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("reminders_hourly_digest")
        .eq("user_id", user!.id)
        .single();
      return data;
    },
    enabled: !!user,
  });

  const { reminders, addReminder, toggleReminder, deleteReminder } = useReminders();
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [reminderToDelete, setReminderToDelete] = useState<string | null>(null);

  const confirmDeleteReminder = () => {
    if (!reminderToDelete) return;
    deleteReminder.mutate(reminderToDelete, {
      onSettled: () => setReminderToDelete(null),
    });
  };

  const pendingReminders = reminders.filter((r) => !r.is_completed);
  const completedReminders = reminders.filter((r) => r.is_completed);

  const handleCreateReminder = (input: ReminderCreateInput) => {
    addReminder.mutate(input, { onSuccess: () => setReminderDialogOpen(false) });
  };

  const updateRemindersDigest = useMutation({
    mutationFn: async (reminders_hourly_digest: boolean) => {
      const { error } = await supabase
        .from("profiles")
        .update({ reminders_hourly_digest })
        .eq("user_id", user!.id);
      if (error) throw error;
    },
    onSuccess: (_, reminders_hourly_digest) => {
      qc.invalidateQueries({ queryKey: ["dashboard-profile", user?.id] });
      toast({
        title: reminders_hourly_digest ? "Avisos cada hora activados" : "Avisos cada hora desactivados",
      });
    },
    onError: () => {
      toast({ title: "No se pudo guardar la preferencia", variant: "destructive" });
    },
  });

  return (
    <div className="animate-fade-in">
      <Alert className="mb-4 border-border/80 bg-muted/30">
        <Bell className="h-4 w-4" />
        <AlertTitle>Tus recordatorios se guardan en tu cuenta</AlertTitle>
        <AlertDescription className="space-y-3 text-muted-foreground">
          <p>
            No se pierden al cerrar el navegador. Al crear uno puedes poner fecha límite, hora y si quieres avisos solo en
            lista, cada hora (resumen) o una vez al día. El aviso cada hora requiere el interruptor de abajo; el diario va
            con el digest matutino del sistema. Para notificaciones del SO y push, revisa Notificaciones.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Switch
                id="reminders-hourly-digest-panel"
                checked={profile?.reminders_hourly_digest ?? false}
                disabled={updateRemindersDigest.isPending}
                onCheckedChange={(v) => updateRemindersDigest.mutate(v)}
              />
              <Label htmlFor="reminders-hourly-digest-panel" className="text-sm font-normal cursor-pointer leading-snug">
                Avisarme cada hora si tengo recordatorios pendientes
              </Label>
            </div>
            {showConfigureNotificationsButton ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 w-full sm:w-auto"
                onClick={() => navigate(configureNotificationsHref)}
              >
                Configurar notificaciones
              </Button>
            ) : null}
          </div>
        </AlertDescription>
      </Alert>
      <div className="flex items-center justify-between gap-2 mb-4">
        <Button type="button" size="sm" variant="secondary" className="gap-1.5" onClick={() => setReminderDialogOpen(true)}>
          <Plus className="h-4 w-4" />
          Nuevo recordatorio
        </Button>
      </div>

      <ReminderCreateDialog
        open={reminderDialogOpen}
        onOpenChange={setReminderDialogOpen}
        onSubmit={handleCreateReminder}
        isPending={addReminder.isPending}
      />

      <DeleteConfirmDialog
        open={!!reminderToDelete}
        onOpenChange={(open) => {
          if (!open) setReminderToDelete(null);
        }}
        title="¿Eliminar este recordatorio?"
        description="El recordatorio se borrará y no recibirás más avisos sobre él."
        onConfirm={confirmDeleteReminder}
        isPending={deleteReminder.isPending}
      />

      {pendingReminders.length === 0 && completedReminders.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">Sin recordatorios</p>
      ) : (
        <div className="space-y-0.5">
          {pendingReminders.map((r) => (
            <div
              key={r.id}
              className="flex flex-col gap-2 py-3 group row-hover px-2 rounded-lg border-b border-border/40 last:border-0 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
            >
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <Checkbox
                  checked={false}
                  onCheckedChange={() => toggleReminder.mutate({ id: r.id, is_completed: true })}
                  className="h-4 w-4 mt-0.5 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground leading-snug">{r.title}</p>
                  {r.description?.trim() ? (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-3 whitespace-pre-wrap">{r.description.trim()}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal tabular-nums">
                      {repeatShortLabel(r.repeat_kind)}
                    </Badge>
                    {r.due_date ? (
                      <span
                        className={`text-[10px] px-1.5 py-0 rounded-md border border-border/60 ${
                          new Date(r.due_date) < today ? "text-destructive border-destructive/30" : "text-muted-foreground"
                        }`}
                      >
                        {formatDateMX(r.due_date)}
                        {formatReminderDueTime(r.due_time) ? ` · ${formatReminderDueTime(r.due_time)}` : ""}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReminderToDelete(r.id)}
                className="self-end text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-destructive transition-colors sm:self-start shrink-0 p-1"
                aria-label="Eliminar recordatorio"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {completedReminders.length > 0 && (
            <div className="pt-3 border-t border-border/50 mt-3">
              <p className="text-xs text-muted-foreground mb-2">Completados</p>
              {completedReminders.slice(0, 5).map((r) => (
                <div key={r.id} className="flex items-center gap-3 py-1.5 opacity-40 group">
                  <Checkbox
                    checked={true}
                    onCheckedChange={() => toggleReminder.mutate({ id: r.id, is_completed: false })}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-muted-foreground line-through flex-1 truncate">{r.title}</span>
                  <button
                    type="button"
                    onClick={() => setReminderToDelete(r.id)}
                    className="text-muted-foreground/0 group-hover:text-muted-foreground hover:!text-destructive transition-colors"
                    aria-label="Eliminar recordatorio"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
