import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from "@/components/ui/dialog";
import { ListTodo } from "lucide-react";
import { PipelineModalHeader } from "@/components/pipeline/modals/PipelineModalHeader";
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

const taskSchema = z.object({
  title: z.string().min(1, "El título es requerido"),
  task_type: z.enum(["call", "email", "meeting", "whatsapp", "task", "follow_up"]),
  due_date: z.string().min(1, "La fecha es requerida"),
  priority: z.enum(["low", "medium", "high", "urgent"]),
  description: z.string().optional(),
});

type TaskForm = z.infer<typeof taskSchema>;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId: string;
  leadName: string;
}

export function CreateTaskModal({ open, onOpenChange, leadId, leadName }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const form = useForm<TaskForm>({
    resolver: zodResolver(taskSchema),
    defaultValues: {
      title: "",
      task_type: "task",
      priority: "medium",
    },
  });

  const onSubmit = form.handleSubmit(async (data) => {
    if (!user) return;
    setSaving(true);
    try {
      await supabase.from("lead_tasks" as never).insert({
        lead_id: leadId,
        assigned_to: user.id,
        created_by: user.id,
        title: data.title,
        task_type: data.task_type,
        due_date: data.due_date,
        priority: data.priority,
        description: data.description || null,
      } as never);

      qc.invalidateQueries({ queryKey: pipelineQueryKeys.activities(leadId) });
      toast.success("Tarea creada");
      onOpenChange(false);
      form.reset({ title: "", task_type: "task", priority: "medium" });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al crear tarea");
    } finally {
      setSaving(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md overflow-hidden p-0 [&>button.absolute]:text-white [&>button.absolute]:hover:bg-white/15 [&>button.absolute]:top-3 [&>button.absolute]:right-3">
        <PipelineModalHeader
          icon={<ListTodo className="h-4 w-4" />}
          title="Crear tarea"
          subtitle={`Para ${leadName}`}
        />
        <form onSubmit={onSubmit} className="space-y-4 px-4 pb-4 pt-3 sm:px-5">
          <div>
            <Label>Título *</Label>
            <Input {...form.register("title")} placeholder="Descripción de la tarea…" />
            {form.formState.errors.title && (
              <p className="text-xs text-destructive mt-1">{form.formState.errors.title.message}</p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Tipo</Label>
              <Select
                value={form.watch("task_type")}
                onValueChange={(v) => form.setValue("task_type", v as TaskForm["task_type"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="task">Tarea</SelectItem>
                  <SelectItem value="call">Llamada</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="meeting">Reunión</SelectItem>
                  <SelectItem value="follow_up">Seguimiento</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Prioridad</Label>
              <Select
                value={form.watch("priority")}
                onValueChange={(v) => form.setValue("priority", v as TaskForm["priority"])}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Baja</SelectItem>
                  <SelectItem value="medium">Media</SelectItem>
                  <SelectItem value="high">Alta</SelectItem>
                  <SelectItem value="urgent">Urgente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Fecha y hora *</Label>
            <Input type="datetime-local" {...form.register("due_date")} />
          </div>
          <div>
            <Label>Descripción</Label>
            <Textarea rows={3} {...form.register("description")} placeholder="Detalles adicionales…" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              Crear tarea
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
