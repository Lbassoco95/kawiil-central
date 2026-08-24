import { useParams, Link } from "react-router-dom";
import { useForm, type UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  useLeadDetail,
  useLeadActivities,
  useLeadTasks,
  usePipelineStages,
  useUpdateLead,
  useAssignLead,
  useMoveLeadStage,
  pipelineQueryKeys,
} from "@/hooks/usePipeline";
import { LeadEmailPanel } from "@/components/pipeline/LeadEmailPanel";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Sparkles, Plane, Landmark, User, StickyNote, Info, Handshake } from "lucide-react";
import { KAWIIL_AI_GRADIENT, KAWIIL_AI_HEADER_BG } from "@/lib/kawiilAi";
import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LeadActivityPanel } from "@/components/pipeline/LeadActivityPanel";
import { LeadActivityTimeline } from "@/components/pipeline/LeadActivityTimeline";
import { LeadFollowUpNotes } from "@/components/pipeline/LeadFollowUpNotes";
import { LeadSavioPromotionCard } from "@/components/pipeline/LeadSavioPromotionCard";
import { formatMxnShort } from "@/lib/pipelineFormat";
import { SERVICE_LABELS } from "@/lib/serviceLabels";
import { usePipelinePartners } from "@/hooks/usePartners";
import { estimateCommission, formatArrangement } from "@/lib/partnerArrangement";

const priorityOptions = [
  { value: "urgent", label: "Urgente" },
  { value: "high", label: "Alta" },
  { value: "medium", label: "Media" },
  { value: "low", label: "Baja" },
] as const;

/**
 * Servicios que puede solicitar un prospecto. Define qué formulario de datos
 * se muestra en la pestaña "Servicio" (Soft Landing, Constitución, etc.)
 * en lugar de apilar todos los campos en una sola columna.
 */
const serviceTypeOptions = [
  "softlanding",
  "constitucion_nacional",
  "contabilidad",
  "legal",
  "gestoria",
  "pld_ft",
  "cumplimiento",
  "representacion",
  "juicios",
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

const estadoOptions = [
  "Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas",
  "Chihuahua", "Ciudad de México", "Coahuila", "Colima", "Durango", "Estado de México",
  "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "Michoacán", "Morelos", "Nayarit",
  "Nuevo León", "Oaxaca", "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí",
  "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas",
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
  service_type: z.string().optional().nullable(),
  // Atribución a partner / convenio
  partner_id: z.string().optional().nullable(),
  partner_notes: z.string().optional().nullable(),
  // Softlanding fields
  country_origin: z.string().optional().nullable(),
  entity_type: z.string().optional().nullable(),
  industry: z.string().optional().nullable(),
  estimated_budget: z.string().optional().nullable(),
  urgency: z.string().optional().nullable(),
  needs_visa: z.boolean().optional().default(false),
  softlanding_notes: z.string().optional().nullable(),
  // Constitución fields
  constitucion_denominacion_1: z.string().optional().nullable(),
  constitucion_denominacion_2: z.string().optional().nullable(),
  constitucion_denominacion_3: z.string().optional().nullable(),
  constitucion_entity_type: z.string().optional().nullable(),
  constitucion_partners_count: z.preprocess((val) => {
    if (val === "" || val === undefined || val === null) return null;
    const n = typeof val === "number" ? val : Number(val);
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
  }, z.number().nullable().optional()),
  constitucion_capital_social: z.preprocess((val) => {
    if (val === "" || val === undefined || val === null) return null;
    const n = typeof val === "number" ? val : Number(val);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }, z.number().nullable().optional()),
  constitucion_objeto_social: z.string().optional().nullable(),
  constitucion_estado: z.string().optional().nullable(),
  constitucion_ciudad: z.string().optional().nullable(),
  constitucion_notario: z.string().optional().nullable(),
  constitucion_foreign_partners: z.boolean().optional().default(false),
  constitucion_needs_fiel: z.boolean().optional().default(false),
  constitucion_needs_bank_account: z.boolean().optional().default(false),
  constitucion_notes: z.string().optional().nullable(),
  estimated_value: z.preprocess((val) => {
    if (val === "" || val === undefined || val === null) return null;
    const n = typeof val === "number" ? val : Number(val);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }, z.number().nullable().optional()),
});

type FormValues = z.infer<typeof schema>;

/** Columnas que sólo existen tras aplicar la migración de partners. */
const PARTNER_COLUMNS = ["partner_id", "partner_notes"] as const;

/** Columnas que sólo existen tras aplicar la migración de servicio/constitución. */
const CONSTITUCION_COLUMNS = [
  "constitucion_denominacion_1",
  "constitucion_denominacion_2",
  "constitucion_denominacion_3",
  "constitucion_entity_type",
  "constitucion_partners_count",
  "constitucion_capital_social",
  "constitucion_objeto_social",
  "constitucion_estado",
  "constitucion_ciudad",
  "constitucion_notario",
  "constitucion_foreign_partners",
  "constitucion_needs_fiel",
  "constitucion_needs_bank_account",
  "constitucion_notes",
] as const;

function isMissingColumnError(message: string): boolean {
  return /service_type|constitucion_|partner_id|partner_notes|schema cache|column .* does not exist/i.test(message);
}

// ─── Formularios por servicio ────────────────────────────────────────────────

function SoftlandingForm({ form }: { form: UseFormReturn<FormValues> }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>País de origen</Label>
          <Select
            value={form.watch("country_origin") || "__none__"}
            onValueChange={(v) => form.setValue("country_origin", v === "__none__" ? null : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar…" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="__none__">Sin especificar</SelectItem>
              {countryOriginOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Tipo de entidad deseada</Label>
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
          <Label>Industria / Giro</Label>
          <Select
            value={form.watch("industry") || "__none__"}
            onValueChange={(v) => form.setValue("industry", v === "__none__" ? null : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar…" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
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
        <div className="flex items-end">
          <div className="flex w-full items-center justify-between rounded-md border border-input px-3 py-2">
            <Label htmlFor="needs-visa" className="cursor-pointer text-sm">
              Necesita visa
            </Label>
            <Switch
              id="needs-visa"
              checked={form.watch("needs_visa") || false}
              onCheckedChange={(v) => form.setValue("needs_visa", v)}
            />
          </div>
        </div>
      </div>
      <div>
        <Label>Notas de Soft Landing</Label>
        <Textarea
          rows={3}
          {...form.register("softlanding_notes")}
          placeholder="Detalles específicos del caso…"
        />
      </div>
    </div>
  );
}

function ConstitucionForm({ form }: { form: UseFormReturn<FormValues> }) {
  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Denominación / razón social (3 opciones para la Secretaría de Economía)
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input placeholder="Opción 1" {...form.register("constitucion_denominacion_1")} />
          <Input placeholder="Opción 2" {...form.register("constitucion_denominacion_2")} />
          <Input placeholder="Opción 3" {...form.register("constitucion_denominacion_3")} />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Tipo societario</Label>
          <Select
            value={form.watch("constitucion_entity_type") || "__none__"}
            onValueChange={(v) =>
              form.setValue("constitucion_entity_type", v === "__none__" ? null : v)
            }
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
          <Label>Número de socios / accionistas</Label>
          <Input
            type="number"
            min={0}
            step="1"
            placeholder="Ej. 2"
            {...form.register("constitucion_partners_count", {
              setValueAs: (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
            })}
          />
        </div>
        <div>
          <Label>Capital social (MXN)</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            placeholder="Ej. 50000"
            {...form.register("constitucion_capital_social", {
              setValueAs: (v) => (v === "" || v === null || v === undefined ? null : Number(v)),
            })}
          />
        </div>
        <div>
          <Label>Notario / fedatario</Label>
          <Input placeholder="Nombre o número de notaría" {...form.register("constitucion_notario")} />
        </div>
        <div>
          <Label>Entidad federativa del domicilio</Label>
          <Select
            value={form.watch("constitucion_estado") || "__none__"}
            onValueChange={(v) => form.setValue("constitucion_estado", v === "__none__" ? null : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Seleccionar…" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="__none__">Sin especificar</SelectItem>
              {estadoOptions.map((e) => (
                <SelectItem key={e} value={e}>{e}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Ciudad / municipio</Label>
          <Input placeholder="Ej. Mérida" {...form.register("constitucion_ciudad")} />
        </div>
      </div>

      <div>
        <Label>Objeto social</Label>
        <Textarea
          rows={3}
          placeholder="Actividades que realizará la sociedad…"
          {...form.register("constitucion_objeto_social")}
        />
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="flex items-center justify-between rounded-md border border-input px-3 py-2">
          <Label htmlFor="const-foreign" className="cursor-pointer text-xs">
            Socios extranjeros
          </Label>
          <Switch
            id="const-foreign"
            checked={form.watch("constitucion_foreign_partners") || false}
            onCheckedChange={(v) => form.setValue("constitucion_foreign_partners", v)}
          />
        </div>
        <div className="flex items-center justify-between rounded-md border border-input px-3 py-2">
          <Label htmlFor="const-fiel" className="cursor-pointer text-xs">
            Requiere e.firma (FIEL)
          </Label>
          <Switch
            id="const-fiel"
            checked={form.watch("constitucion_needs_fiel") || false}
            onCheckedChange={(v) => form.setValue("constitucion_needs_fiel", v)}
          />
        </div>
        <div className="flex items-center justify-between rounded-md border border-input px-3 py-2">
          <Label htmlFor="const-bank" className="cursor-pointer text-xs">
            Requiere cuenta bancaria
          </Label>
          <Switch
            id="const-bank"
            checked={form.watch("constitucion_needs_bank_account") || false}
            onCheckedChange={(v) => form.setValue("constitucion_needs_bank_account", v)}
          />
        </div>
      </div>

      <div>
        <Label>Notas de Constitución</Label>
        <Textarea
          rows={3}
          placeholder="Acuerdos, pendientes documentales, plazos…"
          {...form.register("constitucion_notes")}
        />
      </div>
    </div>
  );
}

export default function LeadDetailPage() {
  const qc = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const { data: lead, isLoading } = useLeadDetail(id);
  const { data: activities = [] } = useLeadActivities(id);
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
      constitucion_foreign_partners: false,
      constitucion_needs_fiel: false,
      constitucion_needs_bank_account: false,
    },
  });

  useEffect(() => {
    if (!lead) return;
    const leadAny = lead as Record<string, unknown>;
    const numOrNull = (v: unknown) => {
      if (v === null || v === undefined || v === "") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
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
      service_type: (leadAny.service_type as string) || null,
      partner_id: (leadAny.partner_id as string) || null,
      partner_notes: (leadAny.partner_notes as string) || null,
      country_origin: (leadAny.country_origin as string) || null,
      entity_type: (leadAny.entity_type as string) || null,
      industry: (leadAny.industry as string) || null,
      estimated_budget: (leadAny.estimated_budget as string) || null,
      urgency: (leadAny.urgency as string) || null,
      needs_visa: !!(leadAny.needs_visa as boolean),
      softlanding_notes: (leadAny.softlanding_notes as string) || null,
      constitucion_denominacion_1: (leadAny.constitucion_denominacion_1 as string) || null,
      constitucion_denominacion_2: (leadAny.constitucion_denominacion_2 as string) || null,
      constitucion_denominacion_3: (leadAny.constitucion_denominacion_3 as string) || null,
      constitucion_entity_type: (leadAny.constitucion_entity_type as string) || null,
      constitucion_partners_count: numOrNull(leadAny.constitucion_partners_count),
      constitucion_capital_social: numOrNull(leadAny.constitucion_capital_social),
      constitucion_objeto_social: (leadAny.constitucion_objeto_social as string) || null,
      constitucion_estado: (leadAny.constitucion_estado as string) || null,
      constitucion_ciudad: (leadAny.constitucion_ciudad as string) || null,
      constitucion_notario: (leadAny.constitucion_notario as string) || null,
      constitucion_foreign_partners: !!(leadAny.constitucion_foreign_partners as boolean),
      constitucion_needs_fiel: !!(leadAny.constitucion_needs_fiel as boolean),
      constitucion_needs_bank_account: !!(leadAny.constitucion_needs_bank_account as boolean),
      constitucion_notes: (leadAny.constitucion_notes as string) || null,
      estimated_value:
        typeof lead.estimated_value === "number" && Number.isFinite(lead.estimated_value)
          ? lead.estimated_value
          : null,
    });
  }, [lead, form]);

  const { data: partners = [] } = usePipelinePartners();
  const serviceType = form.watch("service_type");
  const partnerId = form.watch("partner_id");
  const selectedPartner = useMemo(
    () => partners.find((p) => p.id === partnerId) || null,
    [partners, partnerId],
  );
  /** Comisión que le tocaría al partner con el valor estimado capturado. */
  const partnerCommission = useMemo(() => {
    if (!selectedPartner) return null;
    const value = form.getValues("estimated_value");
    return estimateCommission(selectedPartner, typeof value === "number" ? value : null);
  }, [selectedPartner, form]);
  const showSoftlanding = serviceType === "softlanding";
  const showConstitucion =
    serviceType === "constitucion_nacional" || serviceType === "softlanding";

  const onSave = form.handleSubmit(async (vals) => {
    if (!id) return;
    const base = {
      id,
      full_name: vals.full_name,
      email: vals.email || null,
      phone: vals.phone || null,
      whatsapp: vals.whatsapp || null,
      company_name: vals.company_name || null,
      notes: vals.notes || null,
      campaign_name: vals.campaign_name || null,
      estimated_value:
        vals.estimated_value !== null && vals.estimated_value !== undefined
          ? vals.estimated_value
          : null,
    };
    // Columnas que pueden no existir todavía en la base (migraciones pendientes).
    const extras: Record<string, unknown> = {
      service_type: vals.service_type || null,
      partner_id: vals.partner_id || null,
      partner_notes: vals.partner_notes || null,
      country_origin: vals.country_origin || null,
      entity_type: vals.entity_type || null,
      industry: vals.industry || null,
      estimated_budget: vals.estimated_budget || null,
      urgency: vals.urgency || null,
      needs_visa: vals.needs_visa || false,
      softlanding_notes: vals.softlanding_notes || null,
      constitucion_denominacion_1: vals.constitucion_denominacion_1 || null,
      constitucion_denominacion_2: vals.constitucion_denominacion_2 || null,
      constitucion_denominacion_3: vals.constitucion_denominacion_3 || null,
      constitucion_entity_type: vals.constitucion_entity_type || null,
      constitucion_partners_count: vals.constitucion_partners_count ?? null,
      constitucion_capital_social: vals.constitucion_capital_social ?? null,
      constitucion_objeto_social: vals.constitucion_objeto_social || null,
      constitucion_estado: vals.constitucion_estado || null,
      constitucion_ciudad: vals.constitucion_ciudad || null,
      constitucion_notario: vals.constitucion_notario || null,
      constitucion_foreign_partners: vals.constitucion_foreign_partners || false,
      constitucion_needs_fiel: vals.constitucion_needs_fiel || false,
      constitucion_needs_bank_account: vals.constitucion_needs_bank_account || false,
      constitucion_notes: vals.constitucion_notes || null,
    };

    try {
      await updateLead.mutateAsync({ ...base, ...(extras as Record<string, never>) });
      toast.success("Guardado");
      return;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!isMissingColumnError(msg)) {
        toast.error(msg || "Error al guardar");
        return;
      }
      // Reintento sin las columnas nuevas: así el resto de la ficha sí se guarda.
      const fallback = { ...extras };
      delete fallback.service_type;
      for (const c of CONSTITUCION_COLUMNS) delete fallback[c];
      for (const c of PARTNER_COLUMNS) delete fallback[c];
      try {
        await updateLead.mutateAsync({ ...base, ...(fallback as Record<string, never>) });
        toast.warning(
          "Se guardó lo demás, pero faltan columnas en la base. Ejecuta la migración " +
            "20260824120000_lead_service_type_and_constitucion.sql y " +
            "20260824190000_pipeline_partners_commissions.sql en Supabase para guardar " +
            "tipo de servicio, datos de Constitución y el partner que refirió al lead.",
        );
      } catch (e2: unknown) {
        toast.error(e2 instanceof Error ? e2.message : "Error al guardar");
      }
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

  const currentStageSlug = useMemo(() => {
    if (!lead) return undefined;
    return stages.find((s) => s.id === lead.stage_id)?.slug;
  }, [stages, lead]);

  const ownerName = useMemo(() => {
    if (!lead?.owner_id) return null;
    const p = profiles.find((x) => x.user_id === lead.owner_id);
    return p?.full_name || p?.email || null;
  }, [profiles, lead]);

  if (isLoading || !lead) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const estimatedCloseMxn =
    typeof lead.estimated_value === "number" && Number.isFinite(lead.estimated_value)
      ? lead.estimated_value
      : null;

  return (
    <div className="space-y-6 max-w-5xl pb-24 md:pb-8">
      {/* Header v2.4 — paleta Kawiil AI */}
      <header
        className="relative overflow-hidden rounded-2xl px-4 py-3 sm:px-5 sm:py-4 text-white shadow-md"
        style={{ background: KAWIIL_AI_HEADER_BG }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            asChild
            className="h-8 gap-1 px-2 text-white hover:bg-white/15"
          >
            <Link to="/pipeline">
              <ArrowLeft className="h-4 w-4" />
              Tablero
            </Link>
          </Button>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/15 backdrop-blur-sm">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate text-lg sm:text-xl font-semibold">{lead.full_name}</h2>
              <span className="rounded-full border border-white/40 bg-white/10 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-white">
                v2.4
              </span>
            </div>
            <p className="text-[11.5px] text-white/80 truncate">
              {lead.company_name || "Sin empresa"}
              {lead.email ? ` · ${lead.email}` : ""}
            </p>
          </div>
          {serviceType ? (
            <Badge className="bg-white/15 text-white border-white/20 hover:bg-white/20">
              {SERVICE_LABELS[serviceType as keyof typeof SERVICE_LABELS] || serviceType}
            </Badge>
          ) : null}
          <Badge className="bg-white/15 text-white border-white/20 hover:bg-white/20">
            {lead.priority}
          </Badge>
          <Badge variant="outline" className="border-white/40 bg-white/10 text-white">
            score {lead.score}
          </Badge>
          {estimatedCloseMxn !== null ? (
            <Badge variant="outline" className="border-amber-200/50 bg-amber-500/20 text-white shrink-0">
              {formatMxnShort(estimatedCloseMxn)} MXN estim.
            </Badge>
          ) : null}
        </div>
      </header>

      <div
        className="flex items-start gap-2.5 rounded-xl border border-sky-200/70 bg-gradient-to-r from-sky-50 to-blue-50 px-3 py-2.5 text-[12px] text-sky-800 shadow-sm dark:border-sky-800/40 dark:from-sky-950/30 dark:to-blue-950/20 dark:text-sky-200"
      >
        <span
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white shadow-sm"
          style={{ background: KAWIIL_AI_GRADIENT }}
        >
          <Sparkles className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-sky-700 dark:text-sky-300">
            KAWIIL AI · Insights del lead
          </p>
          <p className="mt-0.5 text-[12px] leading-snug">
            {lead.priority === "urgent"
              ? "Lead marcado como urgente. Recomiendo registrar una llamada o WhatsApp hoy mismo y mover de etapa cuando confirmes interés."
              : lead.score >= 70
                ? "Score alto: el lead está caliente. Aprovecha para enviar una propuesta concreta y agendar reunión."
                : "Mantén el seguimiento con notas y correos breves. Kawiil te recordará si pasa demasiado tiempo sin actividad."}
          </p>
        </div>
      </div>

      <LeadSavioPromotionCard
        leadId={lead.id}
        organizationId={lead.organization_id}
        fullName={lead.full_name}
        companyName={lead.company_name}
        email={lead.email}
        phone={lead.phone}
        stageSlug={currentStageSlug}
        billingLegalName={lead.billing_legal_name}
        billingRfc={lead.billing_rfc}
        billingServiceDescription={lead.billing_service_description}
        estimatedCloseMxn={estimatedCloseMxn}
      />

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
        {/* Left column: ficha del lead en pestañas (contacto / servicio / notas) */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Ficha del lead</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={onSave} className="space-y-4">
                <Tabs defaultValue="contacto">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="contacto" className="text-xs">
                      <User className="mr-1 h-3.5 w-3.5" />
                      Contacto
                    </TabsTrigger>
                    <TabsTrigger value="servicio" className="text-xs">
                      <Plane className="mr-1 h-3.5 w-3.5" />
                      Servicio
                    </TabsTrigger>
                    <TabsTrigger value="notas" className="text-xs">
                      <StickyNote className="mr-1 h-3.5 w-3.5" />
                      Notas
                    </TabsTrigger>
                  </TabsList>

                  {/* ── Contacto ─────────────────────────────────────────── */}
                  <TabsContent value="contacto" className="mt-4 space-y-3">
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
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label>Empresa</Label>
                        <Input {...form.register("company_name")} />
                      </div>
                      <div>
                        <Label>Campaña</Label>
                        <Input {...form.register("campaign_name")} />
                      </div>
                    </div>

                    {/* Atribución: ¿llegó por un partner o convenio? */}
                    <div className="space-y-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
                      <Label className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Handshake className="h-3.5 w-3.5" />
                        Viene de (partner / convenio)
                      </Label>
                      <Select
                        value={partnerId || "__none__"}
                        onValueChange={(v) =>
                          form.setValue("partner_id", v === "__none__" ? null : v, {
                            shouldDirty: true,
                          })
                        }
                      >
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Canal propio (sin partner)" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          <SelectItem value="__none__">Canal propio (sin partner)</SelectItem>
                          {partners.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                              {p.status !== "activo" ? ` (${p.status})` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {selectedPartner ? (
                        <>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge className="bg-primary/10 text-primary hover:bg-primary/15">
                              {formatArrangement(selectedPartner)}
                            </Badge>
                            {partnerCommission ? (
                              <span className="text-[11px] text-muted-foreground">
                                {partnerCommission.manual
                                  ? "Comisión a capturar a mano al cerrar"
                                  : partnerCommission.amount != null
                                    ? `Comisión estimada: ${formatMxnShort(partnerCommission.amount)} ${partnerCommission.currency}`
                                    : "Captura el valor estimado para calcular la comisión"}
                              </span>
                            ) : null}
                          </div>
                          <div>
                            <Label className="text-xs">Nota de la referencia</Label>
                            <Textarea
                              rows={2}
                              className="bg-background"
                              placeholder="Quién lo refirió, qué se acordó en este caso…"
                              {...form.register("partner_notes")}
                            />
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            La comisión se devenga automáticamente cuando el lead llega a la etapa
                            “Cerrado”; se administra en la pestaña <strong>Partners</strong>.
                          </p>
                        </>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">
                          Si no aparece el partner, regístralo primero en la pestaña{" "}
                          <strong>Partners</strong> del módulo.
                        </p>
                      )}
                    </div>
                    <div>
                      <Label>Valor estimado al cierre (MXN)</Label>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        placeholder="Ej. 45000"
                        {...form.register("estimated_value", {
                          setValueAs: (v) =>
                            v === "" || v === null || v === undefined
                              ? null
                              : typeof v === "number"
                                ? v
                                : Number(v),
                        })}
                      />
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Sirve para el tablero (sumatoria por etapa), la lista del pipeline y el alta en Savio.
                      </p>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
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
                    </div>
                    <div>
                      <Label>Propietario (quien da seguimiento)</Label>
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
                  </TabsContent>

                  {/* ── Servicio ─────────────────────────────────────────── */}
                  <TabsContent value="servicio" className="mt-4 space-y-4">
                    <div>
                      <Label>Tipo de servicio</Label>
                      <Select
                        value={serviceType || "__none__"}
                        onValueChange={(v) =>
                          form.setValue("service_type", v === "__none__" ? null : v, {
                            shouldDirty: true,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Seleccionar servicio…" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          <SelectItem value="__none__">Sin definir</SelectItem>
                          {serviceTypeOptions.map((s) => (
                            <SelectItem key={s} value={s}>
                              {SERVICE_LABELS[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Al elegir el servicio aparece únicamente el formulario que corresponde.
                      </p>
                    </div>

                    {!serviceType ? (
                      <div className="flex items-start gap-2 rounded-lg border border-dashed border-border/70 px-3 py-4 text-[12px] text-muted-foreground">
                        <Info className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          Selecciona el tipo de servicio para capturar sus datos (Soft Landing,
                          Constitución, etc.).
                        </span>
                      </div>
                    ) : null}

                    {/* Soft Landing suele terminar en una constitución: se muestran
                        ambos formularios en acordeón para no apilar todo junto. */}
                    {showSoftlanding ? (
                      <Accordion type="multiple" defaultValue={["softlanding"]} className="w-full">
                        <AccordionItem value="softlanding">
                          <AccordionTrigger className="text-sm font-semibold">
                            <span className="flex items-center gap-2">
                              <Plane className="h-4 w-4" />
                              Datos de Soft Landing
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="pt-2">
                            <SoftlandingForm form={form} />
                          </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="constitucion">
                          <AccordionTrigger className="text-sm font-semibold">
                            <span className="flex items-center gap-2">
                              <Landmark className="h-4 w-4" />
                              Datos de Constitución
                            </span>
                          </AccordionTrigger>
                          <AccordionContent className="pt-2">
                            <ConstitucionForm form={form} />
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    ) : null}

                    {!showSoftlanding && showConstitucion ? <ConstitucionForm form={form} /> : null}


                    {serviceType && !showSoftlanding && !showConstitucion ? (
                      <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-3 text-[12px] text-muted-foreground">
                        <Info className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          {SERVICE_LABELS[serviceType as keyof typeof SERVICE_LABELS]} no requiere
                          datos adicionales en el pipeline. Usa los comentarios de seguimiento para
                          el detalle del caso.
                        </span>
                      </div>
                    ) : null}
                  </TabsContent>

                  {/* ── Notas ────────────────────────────────────────────── */}
                  <TabsContent value="notas" className="mt-4 space-y-3">
                    <div>
                      <Label>Resumen del lead</Label>
                      <Textarea
                        rows={5}
                        {...form.register("notes")}
                        placeholder="Contexto general del prospecto…"
                      />
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Este campo se <strong>sobreescribe</strong> al editarlo y es lo que se ve en la
                        tarjeta del tablero. Para dejar seguimiento con autor y fecha usa
                        <strong> Comentarios de seguimiento</strong> (columna derecha).
                      </p>
                    </div>
                  </TabsContent>
                </Tabs>

                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
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
                  <strong>Guardar cambios</strong> (aplica a todas las pestañas).
                </p>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Right column: correos + comentarios + actividad */}
        <div className="space-y-4">
          <LeadEmailPanel leadId={lead.id} leadEmail={lead.email || ""} leadName={lead.full_name} />

          <LeadFollowUpNotes leadId={lead.id} activities={activities} ownerName={ownerName} />

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
