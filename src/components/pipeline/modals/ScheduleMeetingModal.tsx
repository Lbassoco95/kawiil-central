import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { pipelineQueryKeys } from "@/hooks/usePipeline";

const meetingSchema = z.object({
  title: z.string().min(1, "El t\u00edtulo es requerido"),
  scheduled_date: z.string().min(1, "La fecha es requerida"),
  duration_minutes: z.coerce.number().default(30),
  meeting_link: z.string().optional(),
  notes: z.string().optional(),
});

type MeetingForm = z.infer<typeof meetingSchema>;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId: string;
  leadName: string;
}

export function ScheduleMeetingModal({ open, onOpenChange, leadId, leadName }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const form = useForm<MeetingForm>({
    resolver: zodResolver(meetingSchema),
    defaultValues: {
      title: `Reuni\u00f3n con ${leadName}`,
      duration_minutes: 30,
    },
  });

  const onSubmit = form.handleSubmit(async (data) => {
    if (!user) return;
    setSaving(true);
    try {
      // Create task
      await supabase.from("lead_tasks" as never).insert({
        lead_id: leadId,
        assigned_to: user.id,
        created_by: user.id,
        title: data.title,
        task_type: "meeting",
        due_date: data.scheduled_date,
        notes: `Duraci\u00f3n: ${data.duration_minutes}min\nEnlace: ${data.meeting_link || "Pendiente"}\n${data.notes || ""}`,
        priority: "high",
      } as never);

      // Log activity
      await supabase.from("lead_activities").insert({
        lead_id: leadId,
        user_id: user.id,
        type: "meeting",
        metadata: {
          title: data.title,
          scheduled_date: data.scheduled_date,
          duration_minutes: data.duration_minutes,
          meeting_link: data.meeting_link || null,
          status: "scheduled",
        },
      });

      qc.invalidateQueries({ queryKey: pipelineQueryKeys.activities(leadId) });
      toast.success("Reuni\u00f3n agendada");
      onOpenChange(false);
      form.reset({ title: `Reuni\u00f3n con ${leadName}`, duration_minutes: 30 });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al agendar");
    } finally {
      setSaving(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agendar reuni\u00f3n</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label>T\u00edtulo *</Label>
            <Input {...form.register("title")} />
            {form.formState.errors.title && (
              <p className="text-xs text-destructive mt-1">{form.formState.errors.title.message}</p>
            )}
          </div>
          <div>
            <Label>Fecha y hora *</Label>
            <Input type="datetime-local" {...form.register("scheduled_date")} />
          </div>
          <div>
            <Label>Duraci\u00f3n</Label>
            <Select
              value={String(form.watch("duration_minutes"))}
              onValueChange={(v) => form.setValue("duration_minutes", Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">15 minutos</SelectItem>
                <SelectItem value="30">30 minutos</SelectItem>
                <SelectItem value="45">45 minutos</SelectItem>
                <SelectItem value="60">60 minutos</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Enlace de reuni\u00f3n</Label>
            <Input {...form.register("meeting_link")} placeholder="https://meet.google.com/\u2026" />
          </div>
          <div>
            <Label>Notas</Label>
            <Textarea rows={3} {...form.register("notes")} placeholder="Temas a tratar\u2026" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              Agendar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
