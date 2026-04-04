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
import { pipelineQueryKeys, usePipelineStages } from "@/hooks/usePipeline";

const callSchema = z.object({
  duration: z.coerce.number().min(0).optional(),
  result: z.enum(["conectado", "buzon", "no_contesta", "numero_invalido", "callback"]),
  notes: z.string().optional(),
  schedule_follow_up: z.boolean().default(false),
  follow_up_date: z.string().optional(),
  follow_up_type: z.enum(["call", "whatsapp", "email"]).optional(),
});

type CallForm = z.infer<typeof callSchema>;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId: string;
  leadName: string;
  currentStageId: string;
}

export function LogCallModal({ open, onOpenChange, leadId, leadName, currentStageId }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: stages = [] } = usePipelineStages();
  const [saving, setSaving] = useState(false);

  const currentStage = stages.find((s) => s.id === currentStageId);

  const form = useForm<CallForm>({
    resolver: zodResolver(callSchema),
    defaultValues: { result: "conectado", schedule_follow_up: false },
  });

  const watchFollowUp = form.watch("schedule_follow_up");

  const onSubmit = form.handleSubmit(async (data) => {
    if (!user) return;
    setSaving(true);
    try {
      await supabase.from("lead_activities").insert({
        lead_id: leadId,
        user_id: user.id,
        type: "call",
        metadata: {
          duration_minutes: data.duration || null,
          result: data.result,
          notes: data.notes || null,
        },
      });

      if (data.schedule_follow_up && data.follow_up_date) {
        await supabase.from("lead_tasks" as never).insert({
          lead_id: leadId,
          assigned_to: user.id,
          created_by: user.id,
          title: `Follow-up: ${data.follow_up_type || "call"} con ${leadName}`,
          task_type: data.follow_up_type || "call",
          due_date: data.follow_up_date,
          priority: "high",
        } as never);
      }

      // Auto-move to "Contactado" if connected and currently in "Registrado"
      if (data.result === "conectado" && currentStage?.slug === "registrado") {
        const contactadoStage = stages.find((s) => s.slug === "contactado");
        if (contactadoStage) {
          await supabase.from("leads").update({ stage_id: contactadoStage.id }).eq("id", leadId);
          await supabase.from("lead_activities").insert({
            lead_id: leadId,
            user_id: user.id,
            type: "stage_change",
            metadata: {
              from_stage_id: currentStageId,
              to_stage_id: contactadoStage.id,
              reason: "auto_call_connected",
            },
          });
        }
      }

      qc.invalidateQueries({ queryKey: pipelineQueryKeys.activities(leadId) });
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.lead(leadId) });
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.leads });
      toast.success("Llamada registrada");
      onOpenChange(false);
      form.reset();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al registrar llamada");
    } finally {
      setSaving(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Registrar llamada</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label>Resultado *</Label>
            <Select
              value={form.watch("result")}
              onValueChange={(v) => form.setValue("result", v as CallForm["result"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="conectado">Conectado</SelectItem>
                <SelectItem value="buzon">Buzón</SelectItem>
                <SelectItem value="no_contesta">No contesta</SelectItem>
                <SelectItem value="numero_invalido">Número inválido</SelectItem>
                <SelectItem value="callback">Callback</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Duración (minutos)</Label>
            <Input type="number" min={0} {...form.register("duration")} placeholder="5" />
          </div>
          <div>
            <Label>Notas</Label>
            <Textarea rows={3} {...form.register("notes")} placeholder="Resumen de la llamada…" />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="follow-up"
              checked={watchFollowUp}
              onCheckedChange={(v) => form.setValue("schedule_follow_up", !!v)}
            />
            <Label htmlFor="follow-up" className="cursor-pointer">
              Programar seguimiento
            </Label>
          </div>
          {watchFollowUp && (
            <div className="grid grid-cols-2 gap-2 pl-6">
              <div>
                <Label>Fecha</Label>
                <Input type="datetime-local" {...form.register("follow_up_date")} />
              </div>
              <div>
                <Label>Tipo</Label>
                <Select
                  value={form.watch("follow_up_type") || "call"}
                  onValueChange={(v) => form.setValue("follow_up_type", v as CallForm["follow_up_type"])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="call">Llamada</SelectItem>
                    <SelectItem value="whatsapp">WhatsApp</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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
