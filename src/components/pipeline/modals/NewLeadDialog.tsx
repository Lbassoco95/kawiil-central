import { useEffect, useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Building2, User, Handshake, UserRoundCheck } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useCreateLead,
  usePipelineStages,
  useReferralClients,
  type PipelineStage,
} from "@/hooks/usePipeline";
import { usePipelinePartners } from "@/hooks/usePartners";
import { LeadServicesPicker } from "@/components/pipeline/LeadServicesPicker";
import { LeadValueFields } from "@/components/pipeline/LeadValueFields";
import {
  computeTcv,
  contractMonths,
  normalizeServices,
  primaryService,
  type ServiceArea,
  type ValueBreakdown,
} from "@/lib/leadServices";
import { cn } from "@/lib/utils";

type PersonType = "fisica" | "moral";

/** Columnas que dependen de migraciones recientes; si faltan, se reintenta sin ellas. */
const OPTIONAL_COLUMNS = [
  "person_type",
  "contact_role",
  "service_type",
  "service_types",
  "partner_id",
  "referred_by_client_id",
  "estimated_value_one_time",
  "estimated_value_monthly",
  "estimated_months",
] as const;

function isMissingColumnError(message: string): boolean {
  return /person_type|contact_role|service_type|service_types|partner_id|referred_by_client_id|estimated_value_|estimated_months|schema cache|column .* does not exist/i.test(
    message,
  );
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Etapa destino. Si no se indica, se usa la primera etapa no terminal. */
  defaultStageId?: string | null;
  stages?: PipelineStage[];
}

/**
 * Alta de lead consciente del tipo de persona.
 *
 * Persona física pide el nombre de la persona; persona moral pide la razón
 * social y deja el contacto como opcional (es común tener sólo la empresa).
 * `full_name` —que es lo que se ve en el tablero— se resuelve a partir de eso.
 */
export function NewLeadDialog({ open, onOpenChange, defaultStageId, stages: stagesProp }: Props) {
  const { data: stagesQuery = [] } = usePipelineStages();
  const stages = stagesProp ?? stagesQuery;
  const createLead = useCreateLead();
  const { data: partners = [] } = usePipelinePartners();
  const { data: referralClients = [] } = useReferralClients();

  const [personType, setPersonType] = useState<PersonType | null>(null);
  const [personName, setPersonName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactRole, setContactRole] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [value, setValue] = useState<ValueBreakdown>({ oneTime: null, monthly: null, months: null });
  const [serviceTypes, setServiceTypes] = useState<ServiceArea[]>([]);
  const [originType, setOriginType] = useState<"own" | "partner" | "client">("own");
  const [partnerId, setPartnerId] = useState<string>("");
  const [referringClientId, setReferringClientId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const { data: orgId } = useQuery({
    queryKey: ["user-org-pipeline"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const { data } = await supabase.rpc("get_user_org_id", { _user_id: u.user.id });
      return data as string | null;
    },
  });

  const targetStage = useMemo(() => {
    if (defaultStageId) return stages.find((s) => s.id === defaultStageId) ?? null;
    return stages.find((s) => !s.is_terminal) ?? stages[0] ?? null;
  }, [stages, defaultStageId]);

  useEffect(() => {
    if (open) return;
    setPersonType(null);
    setPersonName("");
    setLegalName("");
    setContactName("");
    setContactRole("");
    setEmail("");
    setPhone("");
    setValue({ oneTime: null, monthly: null, months: null });
    setServiceTypes([]);
    setOriginType("own");
    setPartnerId("");
    setReferringClientId("");
  }, [open]);

  const submit = async () => {
    if (!personType) {
      toast.error("Elige si es persona física o moral");
      return;
    }
    if (!orgId) {
      toast.error("No se encontró la organización del usuario");
      return;
    }
    if (!targetStage) {
      toast.error("No hay etapas configuradas en el pipeline");
      return;
    }
    if (originType === "partner" && !partnerId) {
      toast.error("Selecciona el partner o convenio que refirió al prospecto");
      return;
    }
    if (originType === "client" && !referringClientId) {
      toast.error("Selecciona el cliente que hizo la recomendación");
      return;
    }

    const isMoral = personType === "moral";
    const company = legalName.trim();
    const contact = contactName.trim();
    const person = personName.trim();

    if (isMoral && !company) {
      toast.error("Captura la razón social o nombre comercial");
      return;
    }
    if (!isMoral && !person) {
      toast.error("Captura el nombre de la persona");
      return;
    }

    // `full_name` es lo que se muestra en tablero, lista y correos.
    const fullName = isMoral ? contact || company : person;

    const base = {
      organization_id: orgId,
      full_name: fullName,
      company_name: isMoral ? company : company || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      stage_id: targetStage.id,
      source: "manual",
      priority: "medium",
      // `estimated_value` es el valor total del contrato (TCV).
      estimated_value: computeTcv(value) || null,
    };
    const optional: Record<string, unknown> = {
      person_type: personType,
      contact_role: isMoral ? contactRole.trim() || null : null,
      service_types: serviceTypes,
      service_type: primaryService(serviceTypes),
      partner_id: originType === "partner" ? partnerId || null : null,
      referred_by_client_id: originType === "client" ? referringClientId || null : null,
      estimated_value_one_time: value.oneTime,
      estimated_value_monthly: value.monthly,
      estimated_months: value.monthly ? contractMonths(value.months) : null,
    };

    setSaving(true);
    try {
      let row: { id: string } | null = null;
      try {
        row = await createLead.mutateAsync({
          ...base,
          ...(optional as Record<string, never>),
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!isMissingColumnError(msg)) throw e;
        // Migraciones pendientes: se crea el lead con los campos base.
        const fallback = { ...optional };
        for (const c of OPTIONAL_COLUMNS) delete fallback[c];
        row = await createLead.mutateAsync({ ...base, ...(fallback as Record<string, never>) });
        toast.warning(
          "Lead creado, pero faltan columnas en la base (tipo de persona / servicio / partner). " +
            "Ejecuta las migraciones pendientes en Supabase.",
        );
      }

      const { data: u } = await supabase.auth.getUser();
      if (u.user && row?.id) {
        await supabase.from("lead_activities").insert({
          lead_id: row.id,
          user_id: u.user.id,
          type: "lead_created",
          metadata: { source: "manual", person_type: personType },
          organization_id: orgId,
        });
      }

      toast.success(isMoral ? "Empresa registrada como lead" : "Lead creado");
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al crear el lead");
    } finally {
      setSaving(false);
    }
  };

  const stageLabel = targetStage?.name ?? "etapa inicial";
  const activePartners = partners.filter((p) => p.status === "activo");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo lead · {stageLabel}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Paso 1: tipo de persona — define qué datos se piden */}
          <div>
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              ¿Con quién estamos tratando? *
            </Label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPersonType("fisica")}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                  personType === "fisica"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border/60 hover:bg-muted/50",
                )}
              >
                <User className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Persona física</span>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  Un individuo; sabemos su nombre.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setPersonType("moral")}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                  personType === "moral"
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border/60 hover:bg-muted/50",
                )}
              >
                <Building2 className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold">Persona moral</span>
                <span className="text-[11px] leading-snug text-muted-foreground">
                  Una empresa; el contacto puede venir después.
                </span>
              </button>
            </div>
          </div>

          {personType === null ? (
            <p className="rounded-lg border border-dashed border-border/70 px-3 py-4 text-center text-[12px] text-muted-foreground">
              Elige el tipo para capturar los datos que corresponden.
            </p>
          ) : null}

          {/* Paso 2: datos según el tipo */}
          {personType === "fisica" ? (
            <div className="space-y-3">
              <div>
                <Label>Nombre completo *</Label>
                <Input
                  value={personName}
                  onChange={(e) => setPersonName(e.target.value)}
                  placeholder="María Pérez"
                  autoFocus
                />
              </div>
              <div>
                <Label>Empresa donde trabaja (opcional)</Label>
                <Input
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder="Nombre de la empresa, si aplica"
                />
              </div>
            </div>
          ) : null}

          {personType === "moral" ? (
            <div className="space-y-3">
              <div>
                <Label>Razón social o nombre comercial *</Label>
                <Input
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  placeholder="Comercializadora del Sureste, S.A. de C.V."
                  autoFocus
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label>Contacto (opcional)</Label>
                  <Input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Aún no lo sé"
                  />
                </div>
                <div>
                  <Label>Puesto (opcional)</Label>
                  <Input
                    value={contactRole}
                    onChange={(e) => setContactRole(e.target.value)}
                    placeholder="Director, contador…"
                  />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Si aún no hay contacto, la tarjeta del tablero mostrará la razón social; puedes
                agregar a la persona después en la ficha.
              </p>
            </div>
          ) : null}

          {personType !== null ? (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label>Email (opcional)</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="correo@ejemplo.com"
                  />
                </div>
                <div>
                  <Label>Teléfono (opcional)</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="999 123 4567"
                  />
                </div>
              </div>

              <div className="space-y-3 border-t border-border/60 pt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Opcional — se puede completar después
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label>Servicios que busca</Label>
                    <div className="mt-1.5">
                      <LeadServicesPicker value={serviceTypes} onChange={setServiceTypes} />
                    </div>
                  </div>
                </div>
                <div>
                  <Label>Valor estimado</Label>
                  <div className="mt-1.5">
                    <LeadValueFields
                      value={value}
                      onChange={setValue}
                      services={serviceTypes}
                      onAddServices={(extra) =>
                        setServiceTypes((prev) => normalizeServices([...prev, ...extra]))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>¿Cómo llegó este prospecto?</Label>
                  <Select
                    value={originType}
                    onValueChange={(v: "own" | "partner" | "client") => {
                      setOriginType(v);
                      if (v !== "partner") setPartnerId("");
                      if (v !== "client") setReferringClientId("");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="own">Canal propio</SelectItem>
                      <SelectItem value="partner">Partner / convenio</SelectItem>
                      <SelectItem value="client">Recomendación de cliente</SelectItem>
                    </SelectContent>
                  </Select>
                  {originType === "partner" ? (
                    <div>
                      <Label className="flex items-center gap-1.5 text-xs">
                        <Handshake className="h-3.5 w-3.5" />
                        Partner / convenio
                      </Label>
                      <Select value={partnerId} onValueChange={setPartnerId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona quién lo refirió" />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {activePartners.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  {originType === "client" ? (
                    <div>
                      <Label className="flex items-center gap-1.5 text-xs">
                        <UserRoundCheck className="h-3.5 w-3.5" />
                        Cliente que recomendó
                      </Label>
                      <Select value={referringClientId} onValueChange={setReferringClientId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Selecciona un cliente" />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {referralClients.map((client) => (
                            <SelectItem key={client.id} value={client.id}>{client.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={saving || personType === null}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
