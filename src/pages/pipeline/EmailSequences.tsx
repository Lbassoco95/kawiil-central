import { useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useEmailSequences,
  useEmailTemplates,
  usePipelineStages,
  usePipelineLeads,
  pipelineQueryKeys,
} from "@/hooks/usePipeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import { PipelineModalHeader } from "@/components/pipeline/modals/PipelineModalHeader";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Plus,
  MailPlus,
  Play,
  Pause,
  Pencil,
  FlaskConical,
  ChevronRight,
  Users,
  Activity,
  Mail,
} from "lucide-react";
import { stageBadgeStyle } from "@/lib/pipelineFormat";

type SequenceStep = {
  id: string;
  sequence_id: string;
  step_order: number;
  delay_hours: number;
  template_id: string;
};

type TemplateMini = {
  id: string;
  name: string;
  subject: string;
};

function formatDelay(hours: number): string {
  if (hours <= 0) return "inmediato";
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  return days === 1 ? "1 día" : `${days} días`;
}

function StepChip({
  step,
  template,
}: {
  step: SequenceStep;
  template?: TemplateMini;
}) {
  return (
    <div className="flex min-w-[180px] flex-col items-start rounded-xl border border-border/60 bg-card px-3 py-2 shadow-sm">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        <Mail className="h-3 w-3" />
        Paso {step.step_order}
        <span className="rounded-full bg-muted/70 px-1.5 py-0.5 text-[9.5px] text-foreground">
          {formatDelay(step.delay_hours)}
        </span>
      </div>
      <p className="mt-1 text-xs font-semibold line-clamp-1">{template?.name ?? "Plantilla"}</p>
      <p className="text-[10.5px] text-muted-foreground line-clamp-2">{template?.subject ?? "—"}</p>
    </div>
  );
}

export default function EmailSequences() {
  const qc = useQueryClient();
  const { data: sequences = [], isLoading } = useEmailSequences();
  const { data: templates = [] } = useEmailTemplates();
  const { data: stages = [] } = usePipelineStages();
  const { data: leads = [] } = usePipelineLeads(true);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [triggerStage, setTriggerStage] = useState<string>("__none__");

  const [stepOpen, setStepOpen] = useState(false);
  const [seqId, setSeqId] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [stepOrder, setStepOrder] = useState(1);
  const [delayHours, setDelayHours] = useState(0);

  const templateById = useMemo(
    () => new Map(templates.map((t) => [t.id, { id: t.id, name: t.name, subject: t.subject } as TemplateMini] as const)),
    [templates],
  );

  const { data: allSteps = [] } = useQuery({
    queryKey: ["pipeline-all-sequence-steps"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sequence_steps")
        .select("*")
        .order("step_order");
      if (error) throw error;
      return data as SequenceStep[];
    },
  });

  const stepsBySequence = useMemo(() => {
    const m = new Map<string, SequenceStep[]>();
    for (const s of allSteps) {
      const arr = m.get(s.sequence_id) ?? [];
      arr.push(s);
      m.set(s.sequence_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.step_order - b.step_order);
    return m;
  }, [allSteps]);

  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s] as const)), [stages]);

  const leadsEnrolledBySequence = useMemo(() => {
    const m = new Map<string, number>();
    for (const seq of sequences) {
      if (!seq.trigger_stage) {
        m.set(seq.id, 0);
        continue;
      }
      const count = leads.filter((l) => l.stage_id === seq.trigger_stage).length;
      m.set(seq.id, count);
    }
    return m;
  }, [sequences, leads]);

  const { data: seqStats = new Map() } = useQuery({
    queryKey: ["pipeline-sequence-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_log")
        .select("sequence_step_id, status, opened_at, direction");
      if (error) return new Map();
      const stepToSeq = new Map<string, string>();
      for (const st of allSteps) stepToSeq.set(st.id, st.sequence_id);
      const m = new Map<string, { sent: number; opened: number; replies: number }>();
      for (const row of (data || []) as Array<{
        sequence_step_id: string | null;
        status: string | null;
        opened_at: string | null;
        direction: string | null;
      }>) {
        if (!row.sequence_step_id) continue;
        const seqId = stepToSeq.get(row.sequence_step_id);
        if (!seqId) continue;
        const stats = m.get(seqId) ?? { sent: 0, opened: 0, replies: 0 };
        if (row.status === "sent" || row.status === "delivered") stats.sent += 1;
        if (row.opened_at) stats.opened += 1;
        if (row.direction === "inbound") stats.replies += 1;
        m.set(seqId, stats);
      }
      return m;
    },
    enabled: allSteps.length > 0,
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
      void qc.invalidateQueries({ queryKey: ["pipeline-all-sequence-steps"] });
      setStepOpen(false);
      setTemplateId("");
      setStepOrder((s) => s + 1);
      setDelayHours(0);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("email_sequences")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: pipelineQueryKeys.sequences });
      toast.success("Secuencia actualizada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const headerStats = useMemo(() => {
    const total = sequences.length;
    const active = sequences.filter((s) => s.is_active).length;
    const enrolled = Array.from(leadsEnrolledBySequence.values()).reduce((a, b) => a + b, 0);
    return { total, active, enrolled };
  }, [sequences, leadsEnrolledBySequence]);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header con stats */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-sm">
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Total secuencias
            </p>
            <p className="mt-0.5 text-xl font-bold tabular-nums">{headerStats.total}</p>
          </div>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Activas
            </p>
            <p className="mt-0.5 text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
              {headerStats.active}
            </p>
          </div>
          <div>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground inline-flex items-center gap-1">
              <Users className="h-3 w-3" /> Leads en secuencia
            </p>
            <p className="mt-0.5 text-xl font-bold tabular-nums">{headerStats.enrolled}</p>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" />
              Nueva secuencia
            </Button>
          </DialogTrigger>
          <DialogContent className="overflow-hidden p-0 [&>button.absolute]:text-white [&>button.absolute]:hover:bg-white/15 [&>button.absolute]:top-3 [&>button.absolute]:right-3">
            <PipelineModalHeader
              icon={<MailPlus className="h-4 w-4" />}
              title="Secuencia de correos"
              subtitle="Automatiza el seguimiento del pipeline"
            />
            <div className="space-y-3 px-4 pb-4 pt-3 sm:px-5">
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
            <DialogFooter className="px-4 pb-4 sm:px-5">
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

      {/* Lista de secuencias */}
      {isLoading ? (
        <Skeleton className="h-[200px] w-full" />
      ) : sequences.length === 0 ? (
        <Card>
          <CardContent className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No hay secuencias todavía. Crea la primera para automatizar seguimientos.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sequences.map((s) => {
            const steps = stepsBySequence.get(s.id) ?? [];
            const stats = seqStats.get(s.id) ?? { sent: 0, opened: 0, replies: 0 };
            const openRate = stats.sent > 0 ? (stats.opened / stats.sent) * 100 : 0;
            const replyRate = stats.sent > 0 ? (stats.replies / stats.sent) * 100 : 0;
            const trigger = s.trigger_stage ? stageById.get(s.trigger_stage) : null;
            const enrolled = leadsEnrolledBySequence.get(s.id) ?? 0;
            return (
              <Card key={s.id} className="overflow-hidden">
                <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between pb-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold">{s.name}</h3>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                          s.is_active
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${s.is_active ? "bg-emerald-500" : "bg-muted-foreground/60"}`}
                          aria-hidden
                        />
                        {s.is_active ? "Activa" : "Pausada"}
                      </span>
                      {trigger ? (
                        <span
                          className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-semibold"
                          style={stageBadgeStyle(trigger)}
                        >
                          Dispara en: {trigger.name}
                        </span>
                      ) : null}
                    </div>
                    {s.description ? (
                      <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {enrolled} lead{enrolled === 1 ? "" : "s"} activos
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Activity className="h-3 w-3" />
                        {openRate.toFixed(0)}% apertura
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {replyRate.toFixed(0)}% respuesta
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() =>
                        toast.info("Próximamente: enviar correo de prueba", {
                          description: "Se enviará el paso 1 a tu cuenta para revisar el formato.",
                        })
                      }
                    >
                      <FlaskConical className="h-3 w-3 mr-1" />
                      Probar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => {
                        setSeqId(s.id);
                        setStepOrder(steps.length + 1);
                        setStepOpen(true);
                      }}
                    >
                      <Pencil className="h-3 w-3 mr-1" />
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant={s.is_active ? "outline" : "default"}
                      className="h-8 text-xs"
                      onClick={() => toggleActive.mutate({ id: s.id, is_active: !s.is_active })}
                      disabled={toggleActive.isPending}
                    >
                      {s.is_active ? (
                        <>
                          <Pause className="h-3 w-3 mr-1" /> Pausar
                        </>
                      ) : (
                        <>
                          <Play className="h-3 w-3 mr-1" /> Activar
                        </>
                      )}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="border-t border-border/50 bg-muted/20 px-4 py-3">
                  {steps.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">
                      Sin pasos aún. Pulsa <strong>Editar</strong> para añadir el primero.
                    </p>
                  ) : (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {steps.map((st, i) => (
                        <div key={st.id} className="flex items-center gap-2 shrink-0">
                          <StepChip step={st} template={templateById.get(st.template_id)} />
                          {i < steps.length - 1 ? (
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialog para añadir paso */}
      <Dialog open={stepOpen} onOpenChange={setStepOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Añadir paso a la secuencia</DialogTitle>
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
            {seqId ? (
              <div className="text-xs text-muted-foreground border rounded p-2 max-h-24 overflow-auto">
                Pasos actuales:{" "}
                {(stepsBySequence.get(seqId) ?? [])
                  .map((x) => `#${x.step_order} +${x.delay_hours}h`)
                  .join(" · ") || "—"}
              </div>
            ) : null}
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
