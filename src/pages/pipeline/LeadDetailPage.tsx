import { useParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useLeadDetail,
  useLeadActivities,
  useLeadEmailLog,
  useLeadTasks,
  usePipelineStages,
  useUpdateLead,
  useAssignLead,
  useMoveLeadStage,
  pipelineQueryKeys,
} from "@/hooks/usePipeline";
import { useProfiles } from "@/hooks/useTasks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LeadActivityPanel } from "@/components/pipeline/LeadActivityPanel";
import { LeadActivityTimeline } from "@/components/pipeline/LeadActivityTimeline";

const priorityOptions = [
  { value: "urgent", label: "Urgente" },
  { value: "high", label: "Alta" },
  { value: "medium", label: "Media" },
  { value: "low", label: "Baja" },
] as const;

const countryOriginOptions = [
  "Argentina", "Bolivia", "Chile", "Colombia", "Costa Rica", "Ecuador",
  "El Salvador", "Guatemala", "Honduras", "México", "Nicaragua", "Panamá",
  "Paraguay", "Perú", "Rep. Dominicana", "Uruguay", "Venezuela", "Otro",
];

const entityTypeOptions = [
  { value: "sa_cv", label: "S.A. de C.V." },
  { value: "srl", label: "S. de R.L." },
  { value: "persona_fisica", label: "Persona Física con Act. Empresarial" },
  { value: "sucursal", label: "Sucursal Extranjera" },
  { value: "por_definir", label: "Por definir" },
];

const industryOptions = [
  "Tecnología", "Comercio", "Servicios", "Manufactura",
  "Consultoría", "Alimentos", "Salud", "Educación", "Otro",
];

const budgetOptions = [
  { value: "menos_5k", label: "Menos de $5,000 USD" },
  { value: "5k_15k", label: "$5,000 - $15,000" },
  { value: "15k_30k", label: "$15,000 - $30,000" },
  { value: "30k_plus", label: "Más de $30,000" },
  { value: "por_definir", label: "Por definir" },
];

const urgencyOptions = [
  { value: "immediate", label: "Inmediato (< 1 mes)" },
  { value: "short_term", label: "Corto plazo (1-3 meses)" },
  { value: "exploring", label: "Explorando (3+ meses)" },
];

const schema = z.object({
  full_name: z.string().min(1),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  company_name: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  campaign_name: z.string().optional().nullable(),
  stage_id: z.string().uuid(),
  priority: z.enum(["urgent", "high", "medium", "low"]),
  // Softlanding fields
  country_origin: z.string().optional().nullable(),
  entity_type: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  estimated_budget: z.string().optional().nullable(),
  urgency: z.string().optional().nullable(),
  needs_visa: z.boolean().optional().default(false),
  softlanding_notes: z.string().optional().nullable(),
});

type FormValues = z.infer<typeof schema>;

export default function LeadDetailPage() {
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const { data: lead, isLoading } = useLeadDetail(id);
  const { data: activities = [] } = useLeadActivities(id);
  const { data: emails = [] } = useLeadEmailLog(id);
  const { data: tasks = [] } = useLeadTasks(id);
  const { data: stages = [] } = usePipelineStages();
  const { data: profiles = [] } = useProfiles();
  const updateLead = useUpdateLead();
  const assignLead = useAssignLead();
  const moveStage = useMoveLeadStage();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: "",
      stage_id: "",
      priority: "medium",
      needs_visa: false,
    },
  });

  useEffect(() => {
    if (!lead) return;
    const leadAny = lead as Record<string, unknown>;
    form.reset({
      full_name: lead.full_name,
      email: lead.email,
      phone: lead.phone,
      whatsapp: lead.whatsapp,
      company_name: lead.company_name,
      notes: lead.notes,
      campaign_name: lead.campaign_name,
      stage_id: lead.stage_id,
      priority: lead.priority as FormValues["priority"],
      country_origin: (leadAny.country_origin as string) || null,
      entity_type: (leadAny.entity_type as string) || null,
      industry: (leadAny.industry as string) || null,
      estimated_budget: (leadAny.estimated_budget as string) || null,
      urgency: (leadAny.urgency as string) || null,
      needs_visa: !!(leadAny.needs_visa as boolean),
      softlanding_notes: (leadAny.softlanding_notes as string) || null,
    });
  }, [lead, form]);

  const onSave = form.handleSubmit(async (vals) => {
    if (!id) return;
    try {
      await updateLead.mutateAsync({
        id,
        full_name: vals.full_name,
        email: vals.email || null,
        phone: vals.phone || null,
        whatsapp: vals.whatsapp || null,
        company_name: vals.company_name || null,
        notes: vals.notes || null,
        campaign_name: vals.campaign_name || null,
        // Softlanding fields - use spread to handle columns that may not exist yet
        ...({
          country_origin: vals.country_origin || null,
          entity_type: vals.entity_type || null,
          industry: vals.industry || null,
          estimated_budget: vals.estimated_budget || null,
          urgency: vals.urgency || null,
          needs_visa: vals.needs_visa || false,
          softlanding_notes: vals.softlanding_notes || null,
        } as Record<string, unknown>),
      });
      toast.success("Guardado");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    }
  });

  const onStageChange = async (newStageId: string) => {
    if (!id || !lead || newStageId === lead.stage_id) return;
    const previous = lead.stage_id;
    form.setValue("stage_id", newStageId);
    try {
      await moveStage.mutateAsync({ leadId: id, newStageId });
      toast.success("Etapa actualizada");
    } catch (e: unknown) {
      form.setValue("stage_id", previous);
      toast.error(e instanceof Error ? e.message : "No se pudo cambiar la etapa");
    }
  };

  const onPriorityChange = async (priority: FormValues["priority"]) => {
    if (!id || !lead || priority === lead.priority) return;
    const previous = lead.priority as FormValues["priority"];
    form.setValue("priority", priority);
    try {
      await updateLead.mutateAsync({ id, priority });
      toast.success("Prioridad actualizada");
    } catch (e: unknown) {
      form.setValue("priority", previous);
      toast.error(e instanceof Error ? e.message : "No se pudo actualizar la prioridad");
    }
  };

  const setScore = async (score: number) => {
    if (!id) return;
    const { data, error } = await supabase.rpc("score_lead", {
      p_lead_id: id,
      p_score: score,
      p_reason: "manual_ui",
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    const j = data as { ok?: boolean };
    if (!j?.ok) toast.error("No se pudo actualizar score");
    else {
      toast.success("Score actualizado");
      void qc.invalidateQueries({ queryKey: pipelineQueryKeys.lead(id) });
      void qc.invalidateQueries({ queryKey: pipelineQueryKeys.leads });
    }
  };

  if (isLoading || !lead) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl pb-24 md:pb-8">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/pipeline">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Tablero
          </Link>
        </Button>
        <h2 className="text-xl font-semibold flex-1 min-w-0 truncate">{lead.full_name}</h2>
        <Badge>{lead.priority}</Badge>
        <Badge variant="outline">score {lead.score}</Badge>
      </div>

      {/* Activity action buttons */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Registrar actividad</CardTitle>
        </CardHeader>
        <CardContent>
          <LeadActivityPanel
            leadId={lead.id}
            leadName={lead.full_name}
            leadEmail={lead.email}
            currentStageId={lead.stage_id}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Left column: Lead data + Softlanding */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Datos del lead</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSave} className="space-y-3">
                <div>
                  <Label>Nombre</Label>
                  <Input {...form.register("full_name")} />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input type="email" {...form.register("email")} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label>Teléfono</Label>
                    <Input {...form.register("phone")} />
                  </div>
                  <div>
                    <Label>WhatsApp</Label>
                    <Input {...form.register("whatsapp")} />
                  </div>
                </div>
                <div>
                  <Label>Empresa</Label>
                  <Input {...form.register("company_name")} />
                </div>
                <div>
                  <Label>Campaña</Label>
                  <Input {...form.register("campaign_name")} />
                </div>
                <div>
                  <Label>Prioridad</Label>
                  <Select
                    value={form.watch("priority")}
                    onValueChange={(v) => void onPriorityChange(v as FormValues["priority"])}
                    disabled={updateLead.isPending}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent side="top" sideOffset={5}>
                      {priorityOptions.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Etapa</Label>
                  <Select
                    value={form.watch("stage_id")}
                    onValueChange={(v) => void onStageChange(v)}
                    disabled={moveStage.isPending}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent side="top" sideOffset={5} className="max-h-72">
                      {stages.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Propietario</Label>
                  <Select
                    value={lead.owner_id || "__none__"}
                    onValueChange={(v) => {
                      void assignLead
                        .mutateAsync({
                          leadId: lead.id,
                          ownerId: v === "__none__" ? null : v,
                        })
                        .then(() => toast.success("Asignación actualizada"))
                        .catch((e) => toast.error(String(e)));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sin asignar" />
                    </SelectTrigger>
                    <SelectContent side="top" sideOffset={5}>
                      <SelectItem value="__none__">Sin asignar</SelectItem>
                      {profiles.map((p) => (
                        <SelectItem key={p.user_id} value={p.user_id}>
                          {p.full_name || p.user_id}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Notas</Label>
                  <Textarea rows={3} {...form.register("notes")} />
                </div>

                {/* Softlanding section */}
                <div className="border-t pt-4 mt-4">
                  <h3 className="text-sm font-semibold mb-3">Datos de Softlanding</h3>
                  <div className="space-y-3">
                    <div>
                      <Label>País de origen</Label>
                      <Select
                        value={form.watch("country_origin") || "__none__"}
                        onValueChange={(v) => form.setValue("country_origin", v === "__none__" ? null : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sin especificar</SelectItem>
                          {countryOriginOptions.map((c) => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Tipo de entidad</Label>
                      <Select
                        value={form.watch("entity_type") || "__none__"}
                        onValueChange={(v) => form.setValue("entity_type", v === "__none__" ? null : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sin especificar</SelectItem>
                          {entityTypeOptions.map((e) => (
                            <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Industria/Giro</Label>
                      <Select
                        value={form.watch("industry") || "__none__"}
                        onValueChange={(v) => form.setValue("industry", v === "__none__" ? null : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sin especificar</SelectItem>
                          {industryOptions.map((i) => (
                            <SelectItem key={i} value={i}>{i}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Presupuesto estimado</Label>
                      <Select
                        value={form.watch("estimated_budget") || "__none__"}
                        onValueChange={(v) => form.setValue("estimated_budget", v === "__none__" ? null : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sin especificar</SelectItem>
                          {budgetOptions.map((b) => (
                            <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Urgencia</Label>
                      <Select
                        value={form.watch("urgency") || "__none__"}
                        onValueChange={(v) => form.setValue("urgency", v === "__none__" ? null : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sin especificar</SelectItem>
                          {urgencyOptions.map((u) => (
                            <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="needs-visa">Necesita visa</Label>
                      <Switch
                        id="needs-visa"
                        checked={form.watch("needs_visa") || false}
                        onCheckedChange={(v) => form.setValue("needs_visa", v)}
                      />
                    </div>
                    <div>
                      <Label>Notas de Softlanding</Label>
                      <Textarea rows={3} {...form.register("softlanding_notes")} placeholder="Detalles específicos del caso…" />
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2">
                  <Button type="submit" disabled={updateLead.isPending}>
                    Guardar cambios
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => void setScore(50)}>
                    Score 50
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => void setScore(80)}>
                    Score 80
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Etapa, prioridad y propietario se guardan al cambiarlos. El resto usa{" "}
                  <strong>Guardar cambios</strong>.
                </p>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Right column: Emails + Activity Timeline */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Correos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm max-h-[200px] overflow-y-auto">
              {emails.length === 0 ? (
                <p className="text-muted-foreground">Sin envíos registrados</p>
              ) : (
                emails.map((e) => (
                  <div key={e.id} className="border-b border-border/50 pb-2">
                    <p className="font-medium truncate">{e.subject}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge
                        variant={
                          e.status === "opened" || e.status === "clicked"
                            ? "default"
                            : e.status === "sent"
                              ? "secondary"
                              : "outline"
                        }
                        className="text-[10px]"
                      >
                        {e.status === "sent" && "Enviado"}
                        {e.status === "opened" && "Abierto"}
                        {e.status === "clicked" && "Click"}
                        {!["sent", "opened", "clicked"].includes(e.status) && e.status}
                      </Badge>
                      {e.sent_at && (
                        <span>
                          {new Date(e.sent_at).toLocaleDateString("es-MX", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actividad</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[500px] overflow-y-auto">
              <LeadActivityTimeline
                activities={activities}
                tasks={tasks}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
