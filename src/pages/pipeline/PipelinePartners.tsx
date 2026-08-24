import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Handshake,
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  ArrowRight,
  Users,
  BadgeCheck,
  Coins,
} from "lucide-react";
import { usePipelineStages } from "@/hooks/usePipeline";
import { useProfiles } from "@/hooks/useTasks";
import {
  usePipelinePartners,
  usePartnerCommissions,
  useReferredLeads,
  useCreatePartner,
  useUpdatePartner,
  useDeletePartner,
  useUpdateCommission,
  type PipelinePartner,
} from "@/hooks/usePartners";
import {
  COMMISSION_BASE_LABELS,
  COMMISSION_STATUS_LABELS,
  COMMISSION_TYPE_LABELS,
  PARTNER_KIND_LABELS,
  PARTNER_STATUS_LABELS,
  estimateCommission,
  formatArrangement,
  type CommissionBase,
  type CommissionStatus,
  type CommissionType,
  type PartnerKind,
  type PartnerStatus,
} from "@/lib/partnerArrangement";
import { formatMxnShort } from "@/lib/pipelineFormat";
import { cn } from "@/lib/utils";

const WON_SLUG = "convertido";

function moneyLabel(amount: number | null | undefined, currency = "MXN"): string {
  if (amount == null) return "—";
  return `${formatMxnShort(amount)} ${currency}`;
}

// ─── Formulario de partner ───────────────────────────────────────────────────

interface PartnerFormState {
  name: string;
  kind: PartnerKind;
  status: PartnerStatus;
  contact_name: string;
  email: string;
  phone: string;
  website: string;
  commission_type: CommissionType;
  commission_value: string;
  commission_base: CommissionBase;
  commission_currency: "MXN" | "USD";
  payment_terms: string;
  agreement_start: string;
  agreement_end: string;
  agreement_notes: string;
  owner_id: string;
}

function emptyForm(): PartnerFormState {
  return {
    name: "",
    kind: "partner",
    status: "activo",
    contact_name: "",
    email: "",
    phone: "",
    website: "",
    commission_type: "porcentaje",
    commission_value: "",
    commission_base: "primer_pago",
    commission_currency: "MXN",
    payment_terms: "",
    agreement_start: "",
    agreement_end: "",
    agreement_notes: "",
    owner_id: "",
  };
}

function formFromPartner(p: PipelinePartner): PartnerFormState {
  return {
    name: p.name,
    kind: (p.kind as PartnerKind) || "partner",
    status: (p.status as PartnerStatus) || "activo",
    contact_name: p.contact_name || "",
    email: p.email || "",
    phone: p.phone || "",
    website: p.website || "",
    commission_type: (p.commission_type as CommissionType) || "porcentaje",
    commission_value: p.commission_value != null ? String(p.commission_value) : "",
    commission_base: (p.commission_base as CommissionBase) || "primer_pago",
    commission_currency: p.commission_currency === "USD" ? "USD" : "MXN",
    payment_terms: p.payment_terms || "",
    agreement_start: p.agreement_start || "",
    agreement_end: p.agreement_end || "",
    agreement_notes: p.agreement_notes || "",
    owner_id: p.owner_id || "",
  };
}

function PartnerDialog({
  open,
  onOpenChange,
  partner,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  partner: PipelinePartner | null;
}) {
  const [form, setForm] = useState<PartnerFormState>(
    partner ? formFromPartner(partner) : emptyForm(),
  );
  const createPartner = useCreatePartner();
  const updatePartner = useUpdatePartner();
  const { data: profiles = [] } = useProfiles();
  const saving = createPartner.isPending || updatePartner.isPending;

  const set = <K extends keyof PartnerFormState>(k: K, v: PartnerFormState[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));

  const needsValue = form.commission_type === "porcentaje" || form.commission_type === "monto_fijo";

  const submit = async () => {
    if (!form.name.trim()) {
      toast.error("El nombre del partner es requerido");
      return;
    }
    if (needsValue && !form.commission_value.trim()) {
      toast.error(
        form.commission_type === "porcentaje"
          ? "Indica el porcentaje acordado"
          : "Indica el monto fijo acordado",
      );
      return;
    }
    const payload = {
      name: form.name.trim(),
      kind: form.kind,
      status: form.status,
      contact_name: form.contact_name.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      website: form.website.trim() || null,
      commission_type: form.commission_type,
      commission_value: needsValue ? Number(form.commission_value) : null,
      commission_base: form.commission_base,
      commission_currency: form.commission_currency,
      payment_terms: form.payment_terms.trim() || null,
      agreement_start: form.agreement_start || null,
      agreement_end: form.agreement_end || null,
      agreement_notes: form.agreement_notes.trim() || null,
      owner_id: form.owner_id || null,
    };
    try {
      if (partner) {
        await updatePartner.mutateAsync({ id: partner.id, ...payload });
        toast.success("Partner actualizado");
      } else {
        await createPartner.mutateAsync(payload);
        toast.success("Partner creado");
      }
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{partner ? `Editar ${partner.name}` : "Nuevo partner / convenio"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Nombre *</Label>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Despacho González y Asociados"
              />
            </div>
            <div>
              <Label>Tipo</Label>
              <Select value={form.kind} onValueChange={(v) => set("kind", v as PartnerKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PARTNER_KIND_LABELS).map(([v, label]) => (
                    <SelectItem key={v} value={v}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Estatus</Label>
              <Select value={form.status} onValueChange={(v) => set("status", v as PartnerStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(PARTNER_STATUS_LABELS).map(([v, label]) => (
                    <SelectItem key={v} value={v}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Contacto</Label>
              <Input
                value={form.contact_name}
                onChange={(e) => set("contact_name", e.target.value)}
                placeholder="Lic. Ana González"
              />
            </div>
            <div>
              <Label>Responsable de la relación</Label>
              <Select
                value={form.owner_id || "__none__"}
                onValueChange={(v) => set("owner_id", v === "__none__" ? "" : v)}
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
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div>
              <Label>Teléfono</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label>Sitio web</Label>
              <Input
                value={form.website}
                onChange={(e) => set("website", e.target.value)}
                placeholder="https://…"
              />
            </div>
          </div>

          {/* Arreglo comercial */}
          <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Arreglo comercial
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Tipo de comisión</Label>
                <Select
                  value={form.commission_type}
                  onValueChange={(v) => set("commission_type", v as CommissionType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(COMMISSION_TYPE_LABELS).map(([v, label]) => (
                      <SelectItem key={v} value={v}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {needsValue ? (
                <div>
                  <Label>{form.commission_type === "porcentaje" ? "Porcentaje (%)" : "Monto"}</Label>
                  <Input
                    type="number"
                    min={0}
                    step={form.commission_type === "porcentaje" ? "0.5" : "0.01"}
                    value={form.commission_value}
                    onChange={(e) => set("commission_value", e.target.value)}
                    placeholder={form.commission_type === "porcentaje" ? "10" : "5000"}
                  />
                </div>
              ) : null}
              <div>
                <Label>Se calcula sobre</Label>
                <Select
                  value={form.commission_base}
                  onValueChange={(v) => set("commission_base", v as CommissionBase)}
                  disabled={!needsValue}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(COMMISSION_BASE_LABELS).map(([v, label]) => (
                      <SelectItem key={v} value={v}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Moneda</Label>
                <Select
                  value={form.commission_currency}
                  onValueChange={(v) => set("commission_currency", v as "MXN" | "USD")}
                  disabled={form.commission_type === "porcentaje"}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MXN">MXN</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                  </SelectContent>
                </Select>
                {form.commission_type === "porcentaje" ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    El porcentaje aplica sobre el valor estimado del lead, que está en MXN.
                  </p>
                ) : null}
              </div>
              <div className="sm:col-span-2">
                <Label>Condiciones de pago</Label>
                <Input
                  value={form.payment_terms}
                  onChange={(e) => set("payment_terms", e.target.value)}
                  placeholder="Ej. a 15 días de que el cliente pague, contra factura"
                />
              </div>
              <div>
                <Label>Vigencia desde</Label>
                <Input
                  type="date"
                  value={form.agreement_start}
                  onChange={(e) => set("agreement_start", e.target.value)}
                />
              </div>
              <div>
                <Label>Vigencia hasta</Label>
                <Input
                  type="date"
                  value={form.agreement_end}
                  onChange={(e) => set("agreement_end", e.target.value)}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Notas del convenio</Label>
                <Textarea
                  rows={3}
                  value={form.agreement_notes}
                  onChange={(e) => set("agreement_notes", e.target.value)}
                  placeholder="Alcance, exclusividad, servicios cubiertos, quién factura a quién…"
                />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Resumen: <strong>{formatArrangement({
                commission_type: form.commission_type,
                commission_value: form.commission_value ? Number(form.commission_value) : null,
                commission_base: form.commission_base,
                commission_currency: form.commission_currency,
              })}</strong>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Comisión (fila editable) ───────────────────────────────────────────────

function CommissionRow({
  commissionId,
  leadName,
  amount,
  currency,
  status,
  baseAmount,
  isManual,
}: {
  commissionId: string;
  leadName: string;
  amount: number | null;
  currency: string;
  status: string;
  baseAmount: number | null;
  isManual: boolean;
}) {
  const updateCommission = useUpdateCommission();
  const [draftAmount, setDraftAmount] = useState(amount != null ? String(amount) : "");

  const changeStatus = (next: string) => {
    updateCommission.mutate(
      {
        id: commissionId,
        status: next,
        paid_at: next === "pagada" ? new Date().toISOString() : null,
      },
      {
        onSuccess: () => toast.success(`Comisión marcada como ${COMMISSION_STATUS_LABELS[next as CommissionStatus]?.toLowerCase() ?? next}`),
        onError: (e: Error) => toast.error(e.message || "No se pudo actualizar"),
      },
    );
  };

  const saveAmount = () => {
    const value = draftAmount.trim() === "" ? null : Number(draftAmount);
    if (value != null && !Number.isFinite(value)) {
      toast.error("Monto inválido");
      return;
    }
    updateCommission.mutate(
      { id: commissionId, amount: value },
      {
        onSuccess: () => toast.success("Monto de comisión actualizado"),
        onError: (e: Error) => toast.error(e.message || "No se pudo actualizar"),
      },
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2">
      <span className="min-w-0 flex-1 truncate text-xs font-medium">{leadName}</span>
      <span className="text-[11px] text-muted-foreground">
        base {moneyLabel(baseAmount)}
      </span>
      {isManual ? (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={draftAmount}
            onChange={(e) => setDraftAmount(e.target.value)}
            className="h-7 w-24 text-xs"
            placeholder="Monto"
          />
          <Button
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-xs"
            onClick={saveAmount}
            disabled={updateCommission.isPending}
          >
            Guardar
          </Button>
        </div>
      ) : (
        <span className="text-xs font-semibold tabular-nums">
          {moneyLabel(amount, currency)}
        </span>
      )}
      <Select value={status} onValueChange={changeStatus}>
        <SelectTrigger className="h-7 w-[130px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {Object.entries(COMMISSION_STATUS_LABELS).map(([v, label]) => (
            <SelectItem key={v} value={v}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ─── Página ─────────────────────────────────────────────────────────────────

export default function PipelinePartners() {
  const { data: partners = [], isLoading } = usePipelinePartners();
  const { data: commissions = [] } = usePartnerCommissions();
  const { data: referred = [] } = useReferredLeads();
  const { data: stages = [] } = usePipelineStages();
  const deletePartner = useDeletePartner();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PipelinePartner | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s] as const)), [stages]);

  const leadsByPartner = useMemo(() => {
    const m = new Map<string, typeof referred>();
    for (const l of referred) {
      const arr = m.get(l.partner_id) || [];
      arr.push(l);
      m.set(l.partner_id, arr);
    }
    return m;
  }, [referred]);

  const commissionsByPartner = useMemo(() => {
    const m = new Map<string, typeof commissions>();
    for (const c of commissions) {
      const arr = m.get(c.partner_id) || [];
      arr.push(c);
      m.set(c.partner_id, arr);
    }
    return m;
  }, [commissions]);

  const leadNameById = useMemo(
    () => new Map(referred.map((l) => [l.id, l.full_name] as const)),
    [referred],
  );

  const totals = useMemo(() => {
    const activos = partners.filter((p) => p.status === "activo").length;
    const convertidos = referred.filter(
      (l) => stageById.get(l.stage_id)?.slug === WON_SLUG,
    ).length;
    let porPagar = 0;
    let pagado = 0;
    for (const c of commissions) {
      const amount = c.amount ?? 0;
      if (c.status === "devengada" || c.status === "facturada") porPagar += amount;
      else if (c.status === "pagada") pagado += amount;
    }
    return { activos, referidos: referred.length, convertidos, porPagar, pagado };
  }, [partners, referred, commissions, stageById]);

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (p: PipelinePartner) => {
    setEditing(p);
    setDialogOpen(true);
  };

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removePartner = (p: PipelinePartner) => {
    const referidos = leadsByPartner.get(p.id)?.length ?? 0;
    const msg = referidos
      ? `¿Eliminar ${p.name}? Sus ${referidos} lead(s) referidos se quedan, pero pierden la atribución.`
      : `¿Eliminar ${p.name}?`;
    if (!window.confirm(msg)) return;
    deletePartner.mutate(p.id, {
      onSuccess: () => toast.success("Partner eliminado"),
      onError: (e: Error) => toast.error(e.message || "No se pudo eliminar"),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Handshake className="h-5 w-5" />
            Partners y convenios
          </h2>
          <p className="text-xs text-muted-foreground">
            Terceros que nos refieren prospectos, qué clientes llegaron por cada uno y la comisión
            pactada.
          </p>
        </div>
        <Button size="sm" onClick={openNew}>
          <Plus className="mr-1 h-4 w-4" />
          Nuevo partner
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-2 p-3">
            <Handshake className="h-4 w-4 text-primary" />
            <div>
              <p className="text-[11px] text-muted-foreground">Partners activos</p>
              <p className="text-lg font-bold tabular-nums">{totals.activos}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-2 p-3">
            <Users className="h-4 w-4 text-sky-500" />
            <div>
              <p className="text-[11px] text-muted-foreground">Leads referidos</p>
              <p className="text-lg font-bold tabular-nums">{totals.referidos}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-2 p-3">
            <BadgeCheck className="h-4 w-4 text-emerald-500" />
            <div>
              <p className="text-[11px] text-muted-foreground">Convertidos</p>
              <p className="text-lg font-bold tabular-nums">{totals.convertidos}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-2 p-3">
            <Coins className="h-4 w-4 text-amber-500" />
            <div>
              <p className="text-[11px] text-muted-foreground">Comisiones por pagar</p>
              <p className="text-lg font-bold tabular-nums">{moneyLabel(totals.porPagar)}</p>
              <p className="text-[10px] text-muted-foreground">
                Pagadas: {moneyLabel(totals.pagado)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {partners.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Handshake className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">Todavía no hay partners registrados</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              Registra al despacho, consultor o convenio que te manda prospectos. Después, en la
              ficha de cada lead, elige de quién viene: aquí verás qué clientes trajo y cuánto se le
              debe.
            </p>
            <Button size="sm" className="mt-3" onClick={openNew}>
              <Plus className="mr-1 h-4 w-4" />
              Registrar el primero
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {partners.map((p) => {
            const leads = leadsByPartner.get(p.id) || [];
            const partnerCommissions = commissionsByPartner.get(p.id) || [];
            const convertidos = leads.filter(
              (l) => stageById.get(l.stage_id)?.slug === WON_SLUG,
            ).length;
            const pipelineValue = leads
              .filter((l) => stageById.get(l.stage_id)?.slug !== WON_SLUG && l.is_active)
              .reduce((acc, l) => acc + (l.estimated_value || 0), 0);
            const devengado = partnerCommissions
              .filter((c) => c.status !== "cancelada")
              .reduce((acc, c) => acc + (c.amount || 0), 0);
            const isOpen = expanded.has(p.id);

            return (
              <Card key={p.id}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        {p.name}
                        <Badge variant="secondary" className="text-[10px]">
                          {PARTNER_KIND_LABELS[(p.kind as PartnerKind)] || p.kind}
                        </Badge>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[10px]",
                            p.status === "activo" && "border-emerald-300 text-emerald-700 dark:text-emerald-300",
                            p.status === "pausado" && "border-amber-300 text-amber-700 dark:text-amber-300",
                            p.status === "terminado" && "border-border text-muted-foreground",
                          )}
                        >
                          {PARTNER_STATUS_LABELS[(p.status as PartnerStatus)] || p.status}
                        </Badge>
                      </CardTitle>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {[p.contact_name, p.email, p.phone].filter(Boolean).join(" · ") ||
                          "Sin datos de contacto"}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => removePartner(p)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge className="bg-primary/10 text-primary hover:bg-primary/15">
                      {formatArrangement(p)}
                    </Badge>
                    {p.payment_terms ? (
                      <span className="text-[11px] text-muted-foreground">
                        Pago: {p.payment_terms}
                      </span>
                    ) : null}
                    {p.agreement_start || p.agreement_end ? (
                      <span className="text-[11px] text-muted-foreground">
                        Vigencia: {p.agreement_start || "—"} → {p.agreement_end || "sin fin"}
                      </span>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
                      <p className="text-[10px] text-muted-foreground">Referidos</p>
                      <p className="text-sm font-semibold tabular-nums">{leads.length}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
                      <p className="text-[10px] text-muted-foreground">Convertidos</p>
                      <p className="text-sm font-semibold tabular-nums">{convertidos}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
                      <p className="text-[10px] text-muted-foreground">En pipeline</p>
                      <p className="text-sm font-semibold tabular-nums">{moneyLabel(pipelineValue)}</p>
                    </div>
                    <div className="rounded-md bg-muted/40 px-2.5 py-1.5">
                      <p className="text-[10px] text-muted-foreground">Comisión devengada</p>
                      <p className="text-sm font-semibold tabular-nums">{moneyLabel(devengado)}</p>
                    </div>
                  </div>

                  {p.agreement_notes ? (
                    <p className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-2 text-[12px] leading-snug text-muted-foreground">
                      {p.agreement_notes}
                    </p>
                  ) : null}

                  <Collapsible open={isOpen} onOpenChange={() => toggleExpanded(p.id)}>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
                        {isOpen ? (
                          <>
                            <ChevronUp className="mr-1 h-3.5 w-3.5" /> Ocultar detalle
                          </>
                        ) : (
                          <>
                            <ChevronDown className="mr-1 h-3.5 w-3.5" /> Ver clientes referidos y
                            comisiones
                          </>
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-3 pt-2">
                      <div>
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Clientes / prospectos referidos
                        </p>
                        {leads.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Aún no hay leads atribuidos. Asigna este partner en la ficha del lead
                            (pestaña Contacto → “Viene de”).
                          </p>
                        ) : (
                          <ul className="space-y-1">
                            {leads.map((l) => {
                              const stage = stageById.get(l.stage_id);
                              const est = estimateCommission(p, l.estimated_value);
                              return (
                                <li
                                  key={l.id}
                                  className="flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 py-2"
                                >
                                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                                    {l.full_name}
                                    {l.company_name ? (
                                      <span className="text-muted-foreground"> · {l.company_name}</span>
                                    ) : null}
                                  </span>
                                  {stage ? (
                                    <Badge
                                      variant="outline"
                                      className="text-[10px]"
                                      style={{ borderColor: stage.color, color: stage.color }}
                                    >
                                      {stage.name}
                                    </Badge>
                                  ) : null}
                                  <span className="text-[11px] tabular-nums text-muted-foreground">
                                    {moneyLabel(l.estimated_value)}
                                  </span>
                                  <span className="text-[11px] tabular-nums">
                                    {est.manual
                                      ? "comisión a capturar"
                                      : `comisión ${moneyLabel(est.amount, est.currency)}`}
                                  </span>
                                  <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
                                    <Link to={`/pipeline/leads/${l.id}`}>
                                      <ArrowRight className="h-3 w-3" />
                                    </Link>
                                  </Button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>

                      <div>
                        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Comisiones devengadas
                        </p>
                        {partnerCommissions.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Se devengan automáticamente cuando un lead referido llega a la etapa
                            “Cerrado”.
                          </p>
                        ) : (
                          <div className="space-y-1">
                            {partnerCommissions.map((c) => (
                              <CommissionRow
                                key={c.id}
                                commissionId={c.id}
                                leadName={leadNameById.get(c.lead_id) || "Lead"}
                                amount={c.amount}
                                currency={c.currency}
                                status={c.status}
                                baseAmount={c.base_amount}
                                isManual={c.commission_type === "otro" || c.amount == null}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {dialogOpen ? (
        <PartnerDialog
          key={editing?.id || "new"}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          partner={editing}
        />
      ) : null}
    </div>
  );
}
