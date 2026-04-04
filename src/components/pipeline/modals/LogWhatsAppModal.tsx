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
import { Checkbox } from "@/components/ui/checkbox";
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

const waSchema = z.object({
  summary: z.string().min(1, "El resumen es requerido"),
  direction: z.enum(["outbound", "inbound"]),
  schedule_follow_up: z.boolean().default(false),
  follow_up_date: z.string().optional(),
});

type WAForm = z.infer<typeof waSchema>;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId: string;
  leadName: string;
}

export function LogWhatsAppModal({ open, onOpenChange, leadId, leadName }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const form = useForm<WAForm>({
    resolver: zodResolver(waSchema),
    defaultValues: { direction: "outbound", schedule_follow_up: false },
  });

  const watchFollowUp = form.watch("schedule_follow_up");

  const onSubmit = form.handleSubmit(async (data) => {
    if (!user) return;
    setSaving(true);
    try {
      await supabase.from("lead_activities").insert({
        lead_id: leadId,
        user_id: user.id,
        type: "whatsapp",
        metadata: {
          summary: data.summary,
          direction: data.direction,
        },
      });

      if (data.schedule_follow_up && data.follow_up_date) {
        await supabase.from("lead_tasks" as never).insert({
          lead_id: leadId,
          assigned_to: user.id,
          created_by: user.id,
          title: `Follow-up WhatsApp con ${leadName}`,
          task_type: "whatsapp",
          due_date: data.follow_up_date,
          priority: "medium",
        } as never);
      }

      qc.invalidateQueries({ queryKey: pipelineQueryKeys.activities(leadId) });
      toast.success("WhatsApp registrado");
      onOpenChange(false);
      form.reset();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al registrar");
    } finally {
      setSaving(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar WhatsApp</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label>Direcci\u00f3n</Label>
            <Select
              value={form.watch("direction")}
              onValueChange={(v) => form.setValue("direction", v as WAForm["direction"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="outbound">Enviado</SelectItem>
                <SelectItem value="inbound">Recibido</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Resumen de la conversaci\u00f3n *</Label>
            <Textarea rows={4} {...form.register("summary")} placeholder="Resumen del mensaje\u2026" />
            {form.formState.errors.summary && (
              <p className="text-xs text-destructive mt-1">{form.formState.errors.summary.message}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="wa-follow-up"
              checked={watchFollowUp}
              onCheckedChange={(v) => form.setValue("schedule_follow_up", !!v)}
            />
            <Label htmlFor="wa-follow-up" className="cursor-pointer">
              Programar seguimiento
            </Label>
          </div>
          {watchFollowUp && (
            <div className="pl-6">
              <Label>Fecha de seguimiento</Label>
              <Input type="datetime-local" {...form.register("follow_up_date")} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
