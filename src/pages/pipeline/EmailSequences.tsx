import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEmailSequences, useEmailTemplates, usePipelineStages, pipelineQueryKeys } from "@/hooks/usePipeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus } from "lucide-react";

export default function EmailSequences() {
  const qc = useQueryClient();
  const { data: sequences = [], isLoading } = useEmailSequences();
  const { data: templates = [] } = useEmailTemplates();
  const { data: stages = [] } = usePipelineStages();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [triggerStage, setTriggerStage] = useState<string>("__none__");
  const [stepOpen, setStepOpen] = useState(false);
  const [seqId, setSeqId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [stepOrder, setStepOrder] = useState(1);
  const [delayHours, setDelayHours] = useState(0);

  const { data: steps = [] } = useQuery({
    queryKey: ["pipeline-sequence-steps", seqId],
    enabled: !!seqId && stepOpen,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sequence_steps")
        .select("*")
        .eq("sequence_id", seqId!)
        .order("step_order");
      if (error) throw error;
      return data;
    },
  });

  const createSeq = useMutation({
    mutationFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data: org } = await supabase.rpc("get_user_org_id", { _user_id: u.user!.id });
      const { error } = await supabase.from("email_sequences").insert({
        organization_id: org as string,
        name: name.trim(),
        description: desc.trim() || null,
        trigger_stage: triggerStage === "__none__" ? null : triggerStage,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Secuencia creada");
      void qc.invalidateQueries({ queryKey: pipelineQueryKeys.sequences });
      setOpen(false);
      setName("");
      setDesc("");
      setTriggerStage("__none__");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addStep = useMutation({
    mutationFn: async () => {
      if (!seqId || !templateId) throw new Error("Datos incompletos");
      const { error } = await supabase.from("email_sequence_steps").insert({
        sequence_id: seqId,
        template_id: templateId,
        step_order: stepOrder,
        delay_hours: delayHours,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Paso añadido");
      void qc.invalidateQueries({ queryKey: ["pipeline-sequence-steps", seqId] });
      setStepOpen(false);
      setTemplateId("");
      setStepOrder((s) => s + 1);
      setDelayHours(0);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Nueva secuencia
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Secuencia de correos</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Nombre</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label>Descripción</Label>
                <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
              </div>
              <div>
                <Label>Disparador (etapa al entrar)</Label>
                <Select value={triggerStage} onValueChange={setTriggerStage}>
                  <SelectTrigger>
                    <SelectValue placeholder="Opcional" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Ninguno</SelectItem>
                    {stages.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button onClick={() => createSeq.mutate()} disabled={!name.trim() || createSeq.isPending}>
                Crear
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-3">
        {sequences.length === 0 ? (
          <p className="text-muted-foreground text-sm">No hay secuencias.</p>
        ) : (
          sequences.map((s) => (
            <Card key={s.id}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div>
                  <CardTitle className="text-base">{s.name}</CardTitle>
                  {s.description && (
                    <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSeqId(s.id);
                    setStepOrder(1);
                    setStepOpen(true);
                  }}
                >
                  Añadir paso
                </Button>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                {s.is_active ? "Activa" : "Inactiva"}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Dialog open={stepOpen} onOpenChange={setStepOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Paso de secuencia</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Plantilla</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Elegir" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Orden</Label>
              <Input
                type="number"
                min={1}
                value={stepOrder}
                onChange={(e) => setStepOrder(parseInt(e.target.value, 10) || 1)}
              />
            </div>
            <div>
              <Label>Horas de espera desde el paso anterior</Label>
              <Input
                type="number"
                min={0}
                value={delayHours}
                onChange={(e) => setDelayHours(parseInt(e.target.value, 10) || 0)}
              />
            </div>
            {seqId && steps.length > 0 && (
              <div className="text-xs text-muted-foreground border rounded p-2 max-h-24 overflow-auto">
                Pasos actuales: {steps.map((x) => `#${x.step_order} +${x.delay_hours}h`).join(" · ")}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStepOpen(false)}>
              Cerrar
            </Button>
            <Button onClick={() => addStep.mutate()} disabled={addStep.isPending || !templateId}>
              Guardar paso
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
