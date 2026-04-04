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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { pipelineQueryKeys } from "@/hooks/usePipeline";

const noteSchema = z.object({
  content: z.string().min(1, "La nota no puede estar vacía"),
  is_important: z.boolean().default(false),
});

type NoteForm = z.infer<typeof noteSchema>;

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  leadId: string;
}

export function AddNoteModal({ open, onOpenChange, leadId }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const form = useForm<NoteForm>({
    resolver: zodResolver(noteSchema),
    defaultValues: { content: "", is_important: false },
  });

  const onSubmit = form.handleSubmit(async (data) => {
    if (!user) return;
    setSaving(true);
    try {
      await supabase.from("lead_activities").insert({
        lead_id: leadId,
        user_id: user.id,
        type: "note",
        metadata: { content: data.content, is_important: data.is_important },
      });
      qc.invalidateQueries({ queryKey: pipelineQueryKeys.activities(leadId) });
      toast.success("Nota agregada");
      onOpenChange(false);
      form.reset();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al guardar nota");
    } finally {
      setSaving(false);
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar nota</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label>Contenido *</Label>
            <Textarea rows={5} {...form.register("content")} placeholder="Escribe tu nota aquí…" />
            {form.formState.errors.content && (
              <p className="text-xs text-destructive mt-1">{form.formState.errors.content.message}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="important"
              checked={form.watch("is_important")}
              onCheckedChange={(v) => form.setValue("is_important", !!v)}
            />
            <Label htmlFor="important" className="cursor-pointer">
              Marcar como importante
            </Label>
          </div>
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
