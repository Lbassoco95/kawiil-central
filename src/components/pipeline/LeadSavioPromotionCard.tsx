import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSavioWriteAccess } from "@/hooks/useSavioWriteAccess";
import { useSavioFinanceWriteMutation } from "@/hooks/useSavioFinanceWrite";
import { useUpdateLead, pipelineQueryKeys } from "@/hooks/usePipeline";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  extractSavioIdFromWriteData,
  extractSavioInvoiceIdFromWriteData,
} from "@/lib/clientSavioLink";
import { savioBillingVisibility } from "@/lib/pipelineSavioGate";

const SAVIO_APP_URL =
  typeof import.meta !== "undefined"
    ? (import.meta.env.VITE_SAVIO_APP_URL as string | undefined)
    : undefined;

export type LeadSavioPromotionCardProps = {
  leadId: string;
  organizationId: string;
  fullName: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  /** Slug de la etapa actual (`convertido` = trato ganado). */
  stageSlug: string | undefined;
  billingLegalName: string | null;
  billingRfc: string | null;
  billingServiceDescription: string | null;
  /** Valor al cierre (MXN); null si falta cargar/guardar en la ficha. */
  estimatedCloseMxn: number | null;
};

export function LeadSavioPromotionCard({
  leadId,
  organizationId,
  fullName,
  companyName,
  email,
  phone,
  stageSlug,
  billingLegalName,
  billingRfc,
  billingServiceDescription,
  estimatedCloseMxn,
}: LeadSavioPromotionCardProps) {
  const qc = useQueryClient();
  const visibility = savioBillingVisibility(stageSlug);
  // Comprobar permisos sólo importa con el trato ganado; antes del cierre no se
  // muestra formulario alguno.
  const { data: access, isLoading: accessLoading } = useSavioWriteAccess({
    enabled: visibility === "full",
  });
  const writeMut = useSavioFinanceWriteMutation();
  const updateLead = useUpdateLead();

  const [legalName, setLegalName] = useState("");
  const [rfc, setRfc] = useState("");
  const [serviceDescription, setServiceDescription] = useState("");
  const [amountStr, setAmountStr] = useState("");

  useEffect(() => {
    const defaultLegal =
      billingLegalName?.trim() || companyName?.trim() || fullName.trim() || "";
    setLegalName(defaultLegal);
    setRfc(billingRfc ?? "");
    setServiceDescription(billingServiceDescription ?? "");
  }, [
    leadId,
    billingLegalName,
    billingRfc,
    billingServiceDescription,
    companyName,
    fullName,
  ]);

  useEffect(() => {
    if (estimatedCloseMxn != null && Number.isFinite(estimatedCloseMxn) && estimatedCloseMxn > 0) {
      setAmountStr(String(estimatedCloseMxn));
    }
  }, [leadId, estimatedCloseMxn]);

  const canWrite = access?.canWrite === true;
  const rpcError = access?.rpcError;

  const noWriteHint = (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground space-y-1">
      {rpcError ? (
        <p>
          No pudimos comprobar permiso Savio ({rpcError}). Revisa RPC{" "}
          <code className="rounded bg-muted px-1">can_write_savio_finance</code>.
        </p>
      ) : (
        <p>
          Quién pueda crear cargos necesita «Crear cargos y registrar pagos» en Kawiil; el rol en app.savio.mx no es
          suficiente.
        </p>
      )}
    </div>
  );

  async function saveBillingDraft() {
    try {
      await updateLead.mutateAsync({
        id: leadId,
        billing_legal_name: legalName.trim() || null,
        billing_rfc: rfc.trim() || null,
        billing_service_description: serviceDescription.trim() || null,
      });
      toast.success("Datos fiscales guardados en el lead.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudieron guardar los datos.");
    }
  }

  async function promoteToSavio() {
    if (visibility !== "full") {
      toast.error("Primero marca el lead como ganado (etapa «Cerrado») antes de enviarlo a Savio.");
      return;
    }

    const legal = legalName.trim();
    const amtRaw = parseFloat(amountStr.replace(/,/g, ""));
    const rfcTrim = rfc.trim();
    if (!legal) {
      toast.error("Indica la razón social o nombre del cliente en Savio.");
      return;
    }
    if (!rfcTrim) {
      toast.error("Savio requiere RFC (tax_id) para validación SAT en la mayoría de las cuentas.");
      return;
    }
    if (!Number.isFinite(amtRaw) || amtRaw <= 0) {
      toast.error("Indica un monto de cargo mayor a cero (MXN).");
      return;
    }

    const customerPayload: Record<string, unknown> = {
      legal_name: legal,
      rfc: rfcTrim,
      tax_id: rfcTrim,
    };
    if (email?.trim()) customerPayload.email = email.trim();
    if (phone?.trim()) customerPayload.phone = phone.trim();

    let customerRes: Awaited<ReturnType<typeof writeMut.mutateAsync>>;
    try {
      customerRes = await writeMut.mutateAsync({
        operation: "create_customer",
        payload: customerPayload,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al crear cliente en Savio");
      return;
    }

    const customerId = extractSavioIdFromWriteData(customerRes.data);
    if (!customerId) {
      toast.error(
        "Savio creó cliente pero no obtuvimos un id válido en la respuesta. Revisa en Savio o el panel de Facturación.",
      );
      return;
    }

    const invoicePayload: Record<string, unknown> = {
      customer_id: customerId,
      amount_total: amtRaw,
    };
    const desc = serviceDescription.trim();
    if (desc) invoicePayload.description = desc;

    let invoiceRes: Awaited<ReturnType<typeof writeMut.mutateAsync>>;
    try {
      invoiceRes = await writeMut.mutateAsync({
        operation: "create_invoice",
        payload: invoicePayload,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al crear cargo en Savio (cliente ya creado).");
      return;
    }

    const invoiceId = extractSavioInvoiceIdFromWriteData(invoiceRes.data);

    const { data: u } = await supabase.auth.getUser();
    if (u.user) {
      const { error: actErr } = await supabase.from("lead_activities").insert({
        lead_id: leadId,
        user_id: u.user.id,
        organization_id: organizationId,
        type: "savio_promotion",
        metadata: {
          savio_customer_id: customerId,
          savio_invoice_id: invoiceId,
          savio_http_customer: customerRes.savio_http_status,
          savio_http_invoice: invoiceRes.savio_http_status,
        },
      });
      if (actErr) {
        console.warn("lead_activities savio_promotion:", actErr.message);
      }
    }

    void qc.invalidateQueries({ queryKey: pipelineQueryKeys.activities(leadId) });

    toast.success(
      invoiceId
        ? `Cliente y cargo creados en Savio (cargo ${invoiceId}).`
        : "Cliente y cargo enviados a Savio. Verifica el id del cargo en el panel de facturación.",
    );
  }

  // Lead perdido: no hay nada que facturar.
  if (visibility === "hidden") return null;

  // Seguimiento: sólo un aviso; los datos fiscales se piden al cerrar el cliente.
  if (visibility === "hint") {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-[12px] text-muted-foreground">
        <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p className="min-w-0">
          <strong className="font-medium text-foreground">Facturación y Savio</strong> se habilita cuando muevas el lead a{" "}
          <strong className="font-medium text-foreground">Cerrado</strong> (trato ganado). Ahí pediremos razón social, RFC y
          monto; durante el seguimiento no hacen falta.
        </p>
      </div>
    );
  }

  if (accessLoading) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Facturación y Savio</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Comprobando permisos…</CardContent>
      </Card>
    );
  }

  if (!canWrite) {
    return (
      <Card className="border-dashed">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Facturación y Savio</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">
            No tienes permiso de escritura Savio en esta plataforma. Un referente puede activarlo en tu usuario.
          </p>
          {noWriteHint}
          {SAVIO_APP_URL ? (
            <Button variant="outline" size="sm" asChild>
              <a href={SAVIO_APP_URL} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Abrir Savio
              </a>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">Facturación y Savio</CardTitle>
          {SAVIO_APP_URL ? (
            <Button variant="ghost" size="sm" className="h-8 text-xs" asChild>
              <a href={SAVIO_APP_URL} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5 mr-1" />
                Savio
              </a>
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground font-normal">
          El trato está en <strong className="text-foreground font-medium">cerrado ganado</strong>. Revisa datos y RFC
          (requeridos para SAT) y crea cliente y cargo en Savio cuando estés listo.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {rpcError ? (
          <p className="text-[11px] text-amber-800 dark:text-amber-200">
            Aviso: hubo advertencia al comprobar permisos ({rpcError}).
          </p>
        ) : null}
        <div>
          <Label>Razón social / nombre (Savio)</Label>
          <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Empresa o nombre fiscal" />
        </div>
        <div>
          <Label>RFC (obligatorio para SAT)</Label>
          <Input value={rfc} onChange={(e) => setRfc(e.target.value)} placeholder="Ej. XAXX010101000" />
        </div>
        <div>
          <Label>Monto del cargo (MXN)</Label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={amountStr}
            onChange={(e) => setAmountStr(e.target.value)}
            placeholder={estimatedCloseMxn != null ? String(estimatedCloseMxn) : "45000"}
          />
          {estimatedCloseMxn == null ? (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
              En “Datos del lead” también puedes cargar el <strong>valor estimado al cierre</strong>; si no está guardado ahí,
              indica aquí el monto que usarás al crear el cargo en Savio.
            </p>
          ) : null}
        </div>
        <div>
          <Label>Servicio / descripción del cargo</Label>
          <Textarea
            rows={2}
            value={serviceDescription}
            onChange={(e) => setServiceDescription(e.target.value)}
            placeholder="Ej. Constitución de empresa — honorarios"
          />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            variant="secondary"
            disabled={updateLead.isPending}
            onClick={() => void saveBillingDraft()}
            className="w-full sm:w-auto"
          >
            {updateLead.isPending ? "Guardando…" : "Guardar datos fiscales en el lead"}
          </Button>
          <Button
            type="button"
            disabled={writeMut.isPending}
            onClick={() => void promoteToSavio()}
            className="w-full sm:w-auto"
          >
            {writeMut.isPending ? "Enviando a Savio…" : "Crear cliente y cargo en Savio"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
