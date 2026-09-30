/**
 * Alta/edición de una serie de juntas (Múuch').
 *
 * Desde la ficha del cliente el ancla es siempre el cliente
 * (anchor_type='client', anchor_id=client.id). Los bloques de agenda se
 * precargan con DEFAULT_AGENDA_TEMPLATE y son editables.
 *
 * La casilla "El cliente fue informado de que la sesión se transcribe" sella
 * transcript_notice_confirmed_at/_by al guardar y habilita auto_transcript
 * (la base exige la constancia vía CHECK).
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
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { useProfiles } from "@/hooks/useTasks";
import {
  useCreateMtgSeries,
  useUpdateMtgSeries,
  type MtgSeries,
  type MtgSeriesFormValues,
} from "@/hooks/useMtgSeries";
import { CADENCE, DEFAULT_AGENDA_TEMPLATE } from "@/lib/mtg/constants";
import type { MtgAgendaBlock, MtgAttendeeClient, MtgEntity } from "@/lib/mtg/db";

const seriesSchema = z.object({
  title: z.string().trim().min(1, "Captura el título de la serie."),
  cadence: z.enum(["weekly", "biweekly", "monthly", "adhoc"]),
  default_duration_min: z.coerce
    .number()
    .int("La duración es en minutos enteros.")
    .min(5, "Mínimo 5 minutos."),
  starts_at: z.string().optional(),
  owner_user_id: z.string().nullable().optional(),
  send_minutes_to_client: z.boolean(),
  slack_channel_id: z.string().optional(),
  transcript_notice_confirmed: z.boolean(),
  auto_transcript: z.boolean(),
});

type SeriesSchemaValues = z.infer<typeof seriesSchema>;

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

interface MtgSeriesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  client: Tables<"clients">;
  /** Si viene, es edición. */
  series?: MtgSeries | null;
}

export function MtgSeriesDialog({ open, onOpenChange, client, series }: MtgSeriesDialogProps) {
  const { data: profiles = [] } = useProfiles();
  const createSeries = useCreateMtgSeries(client.id);
  const updateSeries = useUpdateMtgSeries(client.id);

  const [attendeesInternal, setAttendeesInternal] = useState<string[]>([]);
  const [attendeesClient, setAttendeesClient] = useState<MtgAttendeeClient[]>([]);
  const [entities, setEntities] = useState<MtgEntity[]>([]);
  const [agendaBlocks, setAgendaBlocks] = useState<MtgAgendaBlock[]>(DEFAULT_AGENDA_TEMPLATE);

  const isGroupSeries = series?.anchor_type === "group";

  const form = useForm<SeriesSchemaValues>({
    resolver: zodResolver(seriesSchema),
    defaultValues: {
      title: "",
      cadence: "weekly",
      default_duration_min: 60,
      starts_at: "",
      owner_user_id: client.responsible_user_id ?? null,
      send_minutes_to_client: false,
      slack_channel_id: "",
      transcript_notice_confirmed: false,
      auto_transcript: false,
    },
  });

  const cadence = form.watch("cadence");
  const noticeConfirmed = form.watch("transcript_notice_confirmed");

  useEffect(() => {
    if (!open) return;
    if (series) {
      form.reset({
        title: series.title,
        cadence: series.cadence,
        default_duration_min: series.default_duration_min,
        starts_at: toDatetimeLocal(series.starts_at),
        owner_user_id: series.owner_user_id,
        send_minutes_to_client: series.send_minutes_to_client,
        slack_channel_id: series.slack_channel_id ?? "",
        transcript_notice_confirmed: !!series.transcript_notice_confirmed_at,
        auto_transcript: series.auto_transcript,
      });
      setAttendeesInternal(series.attendees_internal ?? []);
      setAttendeesClient(series.attendees_client ?? []);
      setEntities(series.entities ?? []);
      setAgendaBlocks(
        (series.agenda_template ?? []).length > 0
          ? series.agenda_template
          : DEFAULT_AGENDA_TEMPLATE
      );
    } else {
      form.reset({
        title: "",
        cadence: "weekly",
        default_duration_min: 60,
        starts_at: "",
        owner_user_id: client.responsible_user_id ?? null,
        send_minutes_to_client: false,
        slack_channel_id: "",
        transcript_notice_confirmed: false,
        auto_transcript: false,
      });
      setAttendeesInternal([]);
      setAttendeesClient([]);
      setEntities([]);
      setAgendaBlocks(DEFAULT_AGENDA_TEMPLATE);
    }
  }, [open, series, client.responsible_user_id, form]);

  const onSubmit = async (v: SeriesSchemaValues) => {
    if (v.cadence !== "adhoc" && !v.starts_at) {
      form.setError("starts_at", { message: "Captura fecha y hora de la primera junta." });
      return;
    }
    const values: MtgSeriesFormValues = {
      title: v.title,
      cadence: v.cadence,
      default_duration_min: v.default_duration_min,
      starts_at: v.starts_at ? new Date(v.starts_at).toISOString() : null,
      owner_user_id: v.owner_user_id || null,
      attendees_internal: attendeesInternal,
      attendees_client: attendeesClient.filter((a) => a.name.trim()),
      entities,
      agenda_template: agendaBlocks.filter((b) => b.title.trim()),
      send_minutes_to_client: v.send_minutes_to_client,
      slack_channel_id: v.slack_channel_id?.trim() || null,
      transcript_notice_confirmed: v.transcript_notice_confirmed,
      auto_transcript: v.auto_transcript,
    };
    try {
      if (series) {
        await updateSeries.mutateAsync({ series, values });
        toast.success("Serie actualizada");
      } else {
        await createSeries.mutateAsync({ values });
        toast.success("Serie creada");
      }
      onOpenChange(false);
    } catch (e) {
      toast.error("Error: " + (e as Error).message);
    }
  };

  const pending = createSeries.isPending || updateSeries.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{series ? "Editar serie" : "Nueva serie de juntas"}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título *</FormLabel>
                  <FormControl>
                    <Input placeholder={`Junta semanal - ${client.name}`} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="cadence"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Cadencia</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {Object.entries(CADENCE).map(([k, v]) => (
                          <SelectItem key={k} value={k}>
                            {v.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="default_duration_min"
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
            </div>

            {cadence !== "adhoc" && (
              <FormField
                control={form.control}
                name="starts_at"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Primera junta *</FormLabel>
                    <FormControl>
                      <Input type="datetime-local" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="owner_user_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Quien la lleva</FormLabel>
                  <Select
                    value={field.value ?? ""}
                    onValueChange={(v) => field.onChange(v || null)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Elige un responsable" />
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

            {/* Asistentes internos */}
            <div className="space-y-2">
              <Label>Asistentes internos</Label>
              <div className="grid grid-cols-2 gap-2">
                {profiles.map((p) => (
                  <label
                    key={p.user_id}
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <Checkbox
                      checked={attendeesInternal.includes(p.user_id)}
                      onCheckedChange={(checked) =>
                        setAttendeesInternal((prev) =>
                          checked
                            ? [...prev, p.user_id]
                            : prev.filter((id) => id !== p.user_id)
                        )
                      }
                    />
                    {p.full_name ?? p.email}
                  </label>
                ))}
              </div>
            </div>

            {/* Asistentes del cliente */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Asistentes del cliente</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setAttendeesClient((prev) => [...prev, { name: "", email: "" }])}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Agregar
                </Button>
              </div>
              {attendeesClient.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder="Nombre"
                    value={a.name}
                    onChange={(e) =>
                      setAttendeesClient((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))
                      )
                    }
                  />
                  <Input
                    placeholder="Correo"
                    type="email"
                    value={a.email ?? ""}
                    onChange={(e) =>
                      setAttendeesClient((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, email: e.target.value } : x))
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setAttendeesClient((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Entidades del grupo (solo series de grupo) */}
            {isGroupSeries && (
              <div className="space-y-2">
                <Label>Entidades del grupo</Label>
                {entities.map((e, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder="key"
                      value={e.key}
                      onChange={(ev) =>
                        setEntities((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, key: ev.target.value } : x))
                        )
                      }
                    />
                    <Input
                      placeholder="Nombre"
                      value={e.label}
                      onChange={(ev) =>
                        setEntities((prev) =>
                          prev.map((x, j) => (j === i ? { ...x, label: ev.target.value } : x))
                        )
                      }
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Agenda base */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Bloques de agenda</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setAgendaBlocks((prev) => [
                      ...prev,
                      { key: `custom_${prev.length}`, title: "" },
                    ])
                  }
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Agregar bloque
                </Button>
              </div>
              {agendaBlocks.map((b, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    placeholder="Título del bloque"
                    value={b.title}
                    onChange={(e) =>
                      setAgendaBlocks((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, title: e.target.value } : x))
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setAgendaBlocks((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <FormField
              control={form.control}
              name="send_minutes_to_client"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border p-3">
                  <FormLabel className="text-sm">Enviar minuta al cliente</FormLabel>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="slack_channel_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Canal Slack (aviso al aprobar minuta)</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="C0123456789 o #canal"
                      {...field}
                      value={field.value ?? ""}
                    />
                  </FormControl>
                  <p className="text-xs text-muted-foreground">
                    Opcional. Nunca se publica la minuta completa ni la transcripción.
                  </p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="transcript_notice_confirmed"
              render={({ field }) => (
                <FormItem className="flex items-center gap-2 rounded-md border p-3">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={(v) => field.onChange(!!v)}
                      disabled={!!series?.transcript_notice_confirmed_at}
                    />
                  </FormControl>
                  <FormLabel className="text-sm font-normal">
                    El cliente fue informado de que la sesión se transcribe
                    {series?.transcript_notice_confirmed_at && " (confirmado)"}
                  </FormLabel>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="auto_transcript"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border p-3">
                  <FormLabel className="text-sm">Transcribir automáticamente</FormLabel>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!noticeConfirmed}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Guardando..." : series ? "Guardar" : "Crear serie"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
