/**
 * Junta ad hoc (Múuch'): sin serie, status 'planned'.
 * Puede crearse con cliente o sin él (prospecto / interna).
 * Por defecto crea también el evento en Outlook + reunión Teams.
 */

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { useProfiles } from "@/hooks/useTasks";
import { useCreateAdhocMeeting } from "@/hooks/useMtgMeetings";
import { useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { createOutlookTeamsEventForMeeting } from "@/lib/mtg/createOutlookEventForMeeting";
import { useQueryClient } from "@tanstack/react-query";

const adhocSchema = z.object({
  title: z.string().optional(),
  scheduled_at: z.string().min(1, "Captura fecha y hora de la junta."),
  duration_min: z.coerce.number().int().min(5, "Mínimo 5 minutos."),
  facilitator_user_id: z.string().nullable().optional(),
});

type AdhocSchemaValues = z.infer<typeof adhocSchema>;

interface MtgAdhocMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null = junta sin cliente (se asigna después). */
  client: Tables<"clients"> | null;
  /** Si se define, se llama tras crear (p. ej. navegar al tablero). */
  onCreated?: (meetingId: string) => void;
}

export function MtgAdhocMeetingDialog({
  open,
  onOpenChange,
  client,
  onCreated,
}: MtgAdhocMeetingDialogProps) {
  const { data: profiles = [] } = useProfiles();
  const createMeeting = useCreateAdhocMeeting(client?.id ?? null);
  const { isConnected, isLoading: msLoading } = useMicrosoftConnection();
  const queryClient = useQueryClient();
  const [createOutlookTeams, setCreateOutlookTeams] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<AdhocSchemaValues>({
    resolver: zodResolver(adhocSchema),
    defaultValues: {
      title: "",
      scheduled_at: "",
      duration_min: 60,
      facilitator_user_id: client?.responsible_user_id ?? null,
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        title: "",
        scheduled_at: "",
        duration_min: 60,
        facilitator_user_id: client?.responsible_user_id ?? null,
      });
      setCreateOutlookTeams(true);
    }
  }, [open, client?.responsible_user_id, form]);

  const onSubmit = async (v: AdhocSchemaValues) => {
    const title =
      v.title?.trim() || (client ? `Junta · ${client.name}` : "Junta");
    setSubmitting(true);
    try {
      let outlook_event_id: string | null = null;
      let teams_join_url: string | null = null;
      let teams_online_meeting_id: string | null = null;

      if (createOutlookTeams) {
        if (msLoading) {
          toast.error("Espera un momento: comprobando la conexión con Microsoft…");
          return;
        }
        if (!isConnected) {
          toast.error(
            "Conecta Microsoft 365 en Calendario para crear el evento y la reunión de Teams.",
            { duration: 9000 },
          );
          return;
        }
        const link = await createOutlookTeamsEventForMeeting({
          subject: title,
          scheduledLocal: v.scheduled_at,
          durationMin: v.duration_min,
          bodyText: client
            ? `Junta Múuch' · ${client.name}`
            : "Junta Múuch' (prospecto / interna). Cliente por asignar.",
        });
        outlook_event_id = link.outlook_event_id;
        teams_join_url = link.teams_join_url;
        teams_online_meeting_id = link.teams_online_meeting_id;
        queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
        if (link.onlineMeetingFallback) {
          toast.warning(
            "Evento creado en Outlook, pero sin enlace de Teams (licencia o tenant). La junta se guardó igual.",
            { duration: 9000 },
          );
        }
      }

      const meeting = await createMeeting.mutateAsync({
        title,
        scheduled_at: new Date(v.scheduled_at).toISOString(),
        duration_min: v.duration_min,
        facilitator_user_id: v.facilitator_user_id || null,
        outlook_event_id,
        teams_join_url,
        teams_online_meeting_id,
      });

      if (createOutlookTeams && teams_join_url) {
        toast.success(
          client
            ? "Junta creada en calendario + Teams"
            : "Junta creada (sin cliente) en calendario + Teams",
        );
      } else if (createOutlookTeams && outlook_event_id) {
        toast.success(
          client
            ? "Junta creada y evento en Outlook"
            : "Junta creada (sin cliente) y evento en Outlook",
        );
      } else {
        toast.success(
          client
            ? "Junta creada"
            : "Junta creada (sin cliente; puedes asignarlo después)",
        );
      }
      onOpenChange(false);
      onCreated?.(meeting.id);
    } catch (e) {
      toast.error("Error: " + (e as Error).message, { duration: 10000 });
    } finally {
      setSubmitting(false);
    }
  };

  const busy = submitting || createMeeting.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva junta</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {client ? (
            <>
              Junta ad hoc de <strong>{client.name}</strong>, sin serie.
            </>
          ) : (
            <>
              Junta sin cliente (prospecto o interna). Luego puedes asignar el cliente y migrar
              la reunión o solo las tareas.
            </>
          )}
        </p>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título {client ? "(opcional)" : "*"}</FormLabel>
                  <FormControl>
                    <Input
                      placeholder={client ? `Junta · ${client.name}` : "Ej. Llamada prospecto 9:00"}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="scheduled_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Fecha y hora *</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="duration_min"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Duración (min)</FormLabel>
                  <FormControl>
                    <Input type="number" min={5} step={5} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="facilitator_user_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Facilitador</FormLabel>
                  <Select
                    value={field.value ?? ""}
                    onValueChange={(val) => field.onChange(val || null)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Elige un facilitador" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {profiles.map((p) => (
                        <SelectItem key={p.user_id} value={p.user_id}>
                          {p.full_name ?? p.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2.5">
              <div className="space-y-0.5 min-w-0">
                <Label htmlFor="mtg-outlook-teams" className="text-sm font-medium">
                  Crear en Outlook + Teams
                </Label>
                <p className="text-xs text-muted-foreground">
                  Deja el evento en tu calendario y genera el enlace para entrar a la reunión.
                  {!isConnected && !msLoading && (
                    <span className="block text-amber-700 dark:text-amber-400 mt-0.5">
                      Microsoft no está conectado: conéctalo en Calendario antes de crear.
                    </span>
                  )}
                </p>
              </div>
              <Switch
                id="mtg-outlook-teams"
                checked={createOutlookTeams}
                onCheckedChange={setCreateOutlookTeams}
                disabled={busy}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={busy}>
                {busy
                  ? createOutlookTeams
                    ? "Creando evento…"
                    : "Creando..."
                  : "Crear junta"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
