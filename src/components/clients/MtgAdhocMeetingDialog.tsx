/**
 * Junta ad hoc (Múuch'): sin serie, status 'planned'.
 * Puede crearse con cliente o sin él (prospecto / interna).
 */

import { useEffect } from "react";
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
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { useProfiles } from "@/hooks/useTasks";
import { useCreateAdhocMeeting } from "@/hooks/useMtgMeetings";

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
    }
  }, [open, client?.responsible_user_id, form]);

  const onSubmit = async (v: AdhocSchemaValues) => {
    try {
      const meeting = await createMeeting.mutateAsync({
        title: v.title?.trim() || (client ? `Junta · ${client.name}` : "Junta"),
        scheduled_at: new Date(v.scheduled_at).toISOString(),
        duration_min: v.duration_min,
        facilitator_user_id: v.facilitator_user_id || null,
      });
      toast.success(client ? "Junta creada" : "Junta creada (sin cliente; puedes asignarlo después)");
      onOpenChange(false);
      onCreated?.(meeting.id);
    } catch (e) {
      toast.error("Error: " + (e as Error).message);
    }
  };

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
                    onValueChange={(v) => field.onChange(v || null)}
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
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={createMeeting.isPending}>
                {createMeeting.isPending ? "Creando..." : "Crear junta"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
