import { useParams, Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useLeadDetail,
  useLeadActivities,
  useLeadEmailLog,
  usePipelineStages,
  useUpdateLead,
  useAssignLead,
} from "@/hooks/usePipeline";
import { useProfiles } from "@/hooks/useTasks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import { ArrowLeft, Mail, Phone, MessageCircle } from "lucide-react";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { pipelineQueryKeys } from "@/hooks/usePipeline";

const schema = z.object({
  full_name: z.string().min(1),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  company_name: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  campaign_name: z.string().optional().nullable(),
  stage_id: z.string().uuid(),
});

type FormValues = z.infer<typeof schema>;

export default function LeadDetailPage() {
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const { data: lead, isLoading } = useLeadDetail(id);
  const { data: activities = [] } = useLeadActivities(id);
  const { data: emails = [] } = useLeadEmailLog(id);
  const { data: stages = [] } = usePipelineStages();
  const { data: profiles = [] } = useProfiles();
  const updateLead = useUpdateLead();
  const assignLead = useAssignLead();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      full_name: "",
      stage_id: "",
    },
  });

  useEffect(() => {
    if (!lead) return;
    form.reset({
      full_name: lead.full_name,
      email: lead.email,
      phone: lead.phone,
      whatsapp: lead.whatsapp,
      company_name: lead.company_name,
      notes: lead.notes,
      campaign_name: lead.campaign_name,
      stage_id: lead.stage_id,
    });
  }, [lead, form]);

  const onSave = form.handleSubmit(async (vals) => {
    if (!id) return;
    try {
      if (vals.stage_id !== lead?.stage_id) {
        const { data: mv, error: e1 } = await supabase.rpc("move_lead_stage", {
          p_lead_id: id,
          p_new_stage_id: vals.stage_id,
        });
        if (e1) throw e1;
        const mj = mv as { ok?: boolean; error?: string };
        if (!mj?.ok) throw new Error(mj?.error || "move");
      }
      await updateLead.mutateAsync({
        id,
        full_name: vals.full_name,
        email: vals.email || null,
        phone: vals.phone || null,
        whatsapp: vals.whatsapp || null,
        company_name: vals.company_name || null,
        notes: vals.notes || null,
        campaign_name: vals.campaign_name || null,
      });
      toast.success("Guardado");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    }
  });

  const waLink = lead?.whatsapp
    ? `https://wa.me/${String(lead.whatsapp).replace(/\D/g, "")}`
    : lead?.phone
      ? `https://wa.me/${String(lead.phone).replace(/\D/g, "")}`
      : null;
  const telLink = lead?.phone ? `tel:${lead.phone}` : null;
  const mailTo = lead?.email ? `mailto:${lead.email}` : null;

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
    <div className="space-y-6 max-w-4xl">
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

      <div className="flex flex-wrap gap-2">
        {mailTo && (
          <Button variant="outline" size="sm" asChild>
            <a href={mailTo}>
              <Mail className="h-4 w-4 mr-1" />
              Email
            </a>
          </Button>
        )}
        {waLink && (
          <Button variant="outline" size="sm" asChild>
            <a href={waLink} target="_blank" rel="noreferrer">
              <MessageCircle className="h-4 w-4 mr-1" />
              WhatsApp
            </a>
          </Button>
        )}
        {telLink && (
          <Button variant="outline" size="sm" asChild>
            <a href={telLink}>
              <Phone className="h-4 w-4 mr-1" />
              Llamar
            </a>
          </Button>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
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
                <Label>Etapa</Label>
                <Select
                  value={form.watch("stage_id")}
                  onValueChange={(v) => form.setValue("stage_id", v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
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
                    void assignLead.mutateAsync({
                      leadId: lead.id,
                      ownerId: v === "__none__" ? null : v,
                    }).then(() => toast.success("Asignación actualizada")).catch((e) => toast.error(String(e)));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sin asignar" />
                  </SelectTrigger>
                  <SelectContent>
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
                <Textarea rows={4} {...form.register("notes")} />
              </div>
              <div className="flex flex-wrap gap-2">
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
            </form>
          </CardContent>
        </Card>

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
                    <p className="text-xs text-muted-foreground">{e.status}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actividad</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 max-h-[360px] overflow-y-auto text-sm">
              {activities.length === 0 ? (
                <p className="text-muted-foreground">Sin actividades</p>
              ) : (
                activities.map((a) => (
                  <div key={a.id} className="flex gap-2 border-b border-border/40 pb-2">
                    <Badge variant="outline" className="shrink-0">
                      {a.type}
                    </Badge>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        {new Date(a.created_at).toLocaleString("es-MX")}
                      </p>
                      {a.metadata && (
                        <pre className="text-[11px] mt-1 whitespace-pre-wrap break-all opacity-80">
                          {JSON.stringify(a.metadata, null, 0)}
                        </pre>
                      )}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
