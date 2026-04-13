import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ExternalLink, FilePlus2, Landmark, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SavioSearchablePick } from "@/components/finanzas/SavioSearchablePick";
import { useSavioFinanceWriteMutation } from "@/hooks/useSavioFinanceWrite";
import { useSavioWriteAccess } from "@/hooks/useSavioWriteAccess";

export type SavioPickOption = { id: string; label: string; subtitle?: string };

export interface SavioFinanceWriteActionsProps {
  /** Cargos recientes (GET /invoice) para autocompletar `invoice_id` (OpenAPI). */
  invoicePickOptions?: SavioPickOption[];
  /** Clientes (GET /customer) para `customer_id`. */
  customerPickOptions?: SavioPickOption[];
  /** URL del panel Savio (`VITE_SAVIO_APP_URL`). */
  savioAppUrl?: string | null;
  /** Prellenar cliente Savio en «Nuevo cargo» (p. ej. desde ficha cliente). */
  initialCustomerId?: string | null;
}

export function SavioFinanceWriteActions({
  invoicePickOptions,
  customerPickOptions,
  savioAppUrl,
  initialCustomerId,
}: SavioFinanceWriteActionsProps) {
  const { data: access, isLoading } = useSavioWriteAccess();
  const writeMut = useSavioFinanceWriteMutation();

  const invoiceComboOptions = useMemo(
    () =>
      (invoicePickOptions ?? []).map((o) => ({
        id: o.id,
        label: o.label,
        subtitle: o.subtitle,
      })),
    [invoicePickOptions],
  );

  const customerComboOptions = useMemo(
    () =>
      (customerPickOptions ?? []).map((o) => ({
        id: o.id,
        label: o.label,
        subtitle: o.subtitle,
      })),
    [customerPickOptions],
  );

  const [payOpen, setPayOpen] = useState(false);
  const [invOpen, setInvOpen] = useState(false);
  const [custOpen, setCustOpen] = useState(false);

  const [invoiceId, setInvoiceId] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const [customerId, setCustomerId] = useState("");
  const [amountTotal, setAmountTotal] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [invoiceItemsJson, setInvoiceItemsJson] = useState("");

  useEffect(() => {
    const v = initialCustomerId?.trim();
    if (v) setCustomerId(v);
  }, [initialCustomerId]);

  const [custLegalName, setCustLegalName] = useState("");
  const [custEmail, setCustEmail] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custRfc, setCustRfc] = useState("");

  const canWrite = access?.canWrite === true;
  const rpcError = access?.rpcError;

  function resetPaymentForm() {
    setInvoiceId("");
    setAmountPaid("");
    setPaymentDate(format(new Date(), "yyyy-MM-dd"));
    setReference("");
    setNotes("");
  }

  function resetInvoiceForm() {
    setCustomerId("");
    setAmountTotal("");
    setDescription("");
    setDueDate("");
    setInvoiceItemsJson("");
  }

  function resetCustomerForm() {
    setCustLegalName("");
    setCustEmail("");
    setCustPhone("");
    setCustRfc("");
  }

  async function submitPayment() {
    const amt = parseFloat(amountPaid.replace(/,/g, ""));
    if (!invoiceId.trim() || !Number.isFinite(amt) || amt <= 0) {
      toast.error("Indica el ID del cargo y un monto válido.");
      return;
    }
    const payload: Record<string, unknown> = {
      invoice_id: invoiceId.trim(),
      amount_paid: amt,
    };
    if (paymentDate.trim()) payload.payment_date = paymentDate.trim();
    if (reference.trim()) payload.reference = reference.trim();
    if (notes.trim()) payload.notes = notes.trim();

    try {
      await writeMut.mutateAsync({ operation: "create_payment", payload });
      toast.success("Pago enviado. Si Savio aceptó el cuerpo, verás el movimiento al refrescar la vista.");
      setPayOpen(false);
      resetPaymentForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al registrar pago");
    }
  }

  async function submitInvoice() {
    if (!customerId.trim()) {
      toast.error("Indica el ID del cliente en Savio.");
      return;
    }
    const amt = amountTotal.trim() ? parseFloat(amountTotal.replace(/,/g, "")) : NaN;
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error("Indica un importe total válido (o usa el panel Savio para cargos con conceptos).");
      return;
    }
    const payload: Record<string, unknown> = {
      customer_id: customerId.trim(),
      amount_total: amt,
    };
    if (description.trim()) payload.description = description.trim();
    if (dueDate.trim()) payload.due_date = dueDate.trim();

    if (invoiceItemsJson.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(invoiceItemsJson.trim());
      } catch {
        toast.error("El JSON de conceptos no es válido.");
        return;
      }
      if (Array.isArray(parsed)) {
        payload.items = parsed;
      } else if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const o = parsed as Record<string, unknown>;
        if (Array.isArray(o.items)) payload.items = o.items;
        else if (Array.isArray(o.concepts)) payload.concepts = o.concepts;
        else {
          toast.error('Usa un arreglo de líneas o un objeto { "items": [...] } / { "concepts": [...] }.');
          return;
        }
      } else {
        toast.error("Formato de conceptos no reconocido.");
        return;
      }
    }

    try {
      await writeMut.mutateAsync({ operation: "create_invoice", payload });
      toast.success("Cargo enviado. Comprueba en Savio que el importe y el cliente coincidan con lo esperado.");
      setInvOpen(false);
      resetInvoiceForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al crear cargo");
    }
  }

  async function submitCustomer() {
    const legal = custLegalName.trim();
    if (!legal) {
      toast.error("Indica al menos el nombre o razón social del cliente.");
      return;
    }
    const payload: Record<string, unknown> = { legal_name: legal };
    if (custEmail.trim()) payload.email = custEmail.trim();
    if (custPhone.trim()) payload.phone = custPhone.trim();
    if (custRfc.trim()) {
      payload.rfc = custRfc.trim();
      payload.tax_id = custRfc.trim();
    }

    try {
      await writeMut.mutateAsync({ operation: "create_customer", payload });
      toast.success("Cliente enviado. Comprueba en Savio que el alta se registró correctamente.");
      setCustOpen(false);
      resetCustomerForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al crear cliente");
    }
  }

  const permissionHint = (
    <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground space-y-1 max-w-xl">
      {rpcError ? (
        <p>
          <span className="font-medium text-foreground">No pudimos comprobar el permiso de escritura.</span> Detalle:{" "}
          {rpcError}. Suele deberse a que el RPC{" "}
          <code className="rounded bg-muted px-1">can_write_savio_finance</code> no existe aún o falló la llamada;
          revisa migraciones y el editor de usuario en administración.
        </p>
      ) : (
        <p>
          En <strong className="text-foreground">Kawiil</strong> el rol «admin» de la app Savio no aplica: hace falta
          permiso en esta plataforma. Los usuarios con rol <strong className="text-foreground">Transformador</strong> y
          acceso a ingresos Savio pueden escribir por política de organización; el resto necesita que un referente o
          transformador active «Crear cargos y registrar pagos» en tu ficha de usuario.
        </p>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Consultando permiso de escritura en Savio…</p>
      ) : canWrite ? (
        <>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setPayOpen(true)}
          >
            <Landmark className="h-3.5 w-3.5 mr-1" />
            Registrar pago
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setInvOpen(true)}
          >
            <FilePlus2 className="h-3.5 w-3.5 mr-1" />
            Nuevo cargo
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 text-xs"
            onClick={() => setCustOpen(true)}
          >
            <UserPlus className="h-3.5 w-3.5 mr-1" />
            Nuevo cliente
          </Button>
        </>
      ) : (
        permissionHint
      )}

      {savioAppUrl ? (
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" asChild>
          <a href={savioAppUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="h-3.5 w-3.5 mr-1" />
            Abrir en Savio
          </a>
        </Button>
      ) : null}

      <Dialog open={payOpen} onOpenChange={(o) => !writeMut.isPending && setPayOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar pago</DialogTitle>
            <p className="text-sm text-muted-foreground font-normal pt-1">
              Aplica un pago a un cargo ya existente. Elige el cargo en la lista o pega el identificador que ves en
              Savio.
            </p>
          </DialogHeader>
          <Collapsible className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-left text-[11px] text-muted-foreground hover:text-foreground">
              Detalle técnico (integración)
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 text-[11px] text-muted-foreground space-y-1">
              <p>
                Petición equivalente a POST <code className="rounded bg-background px-1">/payment</code> en Savio;
                Kawiil envía solo campos permitidos por <code className="rounded bg-background px-1">create_payment</code>.
              </p>
            </CollapsibleContent>
          </Collapsible>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Factura o cargo a pagar</Label>
              {invoiceComboOptions.length > 0 ? (
                <SavioSearchablePick
                  options={invoiceComboOptions}
                  value={invoiceId}
                  onChange={setInvoiceId}
                  placeholder="Buscar por folio, cliente o id…"
                  searchPlaceholder="Buscar cargo…"
                  disabled={writeMut.isPending}
                />
              ) : null}
              <Label htmlFor="sw-invoice-id" className="text-[11px] text-muted-foreground">
                Identificador (editable)
              </Label>
              <Input
                id="sw-invoice-id"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                placeholder="UUID o id del cargo en Savio"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-amount">Monto pagado</Label>
              <Input
                id="sw-amount"
                type="text"
                inputMode="decimal"
                value={amountPaid}
                onChange={(e) => setAmountPaid(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-pay-date">Fecha de pago</Label>
              <Input
                id="sw-pay-date"
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-ref">Referencia (opcional)</Label>
              <Input id="sw-ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-notes">Notas (opcional)</Label>
              <Input id="sw-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setPayOpen(false)} disabled={writeMut.isPending}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void submitPayment()} disabled={writeMut.isPending}>
              {writeMut.isPending ? "Enviando…" : "Enviar a Savio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={custOpen} onOpenChange={(o) => !writeMut.isPending && setCustOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Alta de cliente</DialogTitle>
            <p className="text-sm text-muted-foreground font-normal pt-1">
              Registra un cliente en Savio para poder emitirle cargos. Si tu cuenta exige campos extra, complétalos en
              Savio.
            </p>
          </DialogHeader>
          <Collapsible className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-left text-[11px] text-muted-foreground hover:text-foreground">
              Detalle técnico (integración)
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 text-[11px] text-muted-foreground">
              POST <code className="rounded bg-background px-1">/customer</code>. Campos según OpenAPI de tu entorno.
            </CollapsibleContent>
          </Collapsible>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sw-cust-name">Nombre o razón social</Label>
              <Input
                id="sw-cust-name"
                value={custLegalName}
                onChange={(e) => setCustLegalName(e.target.value)}
                placeholder="Ej. Empresa Demo S.A. de C.V."
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-cust-email">Correo (opcional)</Label>
              <Input
                id="sw-cust-email"
                type="email"
                value={custEmail}
                onChange={(e) => setCustEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-cust-phone">Teléfono (opcional)</Label>
              <Input id="sw-cust-phone" value={custPhone} onChange={(e) => setCustPhone(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-cust-rfc">RFC / tax_id (opcional)</Label>
              <Input id="sw-cust-rfc" value={custRfc} onChange={(e) => setCustRfc(e.target.value)} className="font-mono text-xs" />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setCustOpen(false)} disabled={writeMut.isPending}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void submitCustomer()} disabled={writeMut.isPending}>
              {writeMut.isPending ? "Enviando…" : "Enviar a Savio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={invOpen} onOpenChange={(o) => !writeMut.isPending && setInvOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo cargo (factura simple)</DialogTitle>
            <p className="text-sm text-muted-foreground font-normal pt-1">
              Crea un cargo con importe total para un cliente. Si tu cuenta Savio exige conceptos detallados o
              impuestos, usa el panel Savio o amplía la integración.
            </p>
          </DialogHeader>
          <Collapsible className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-left text-[11px] text-muted-foreground hover:text-foreground">
              Detalle técnico (integración)
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 text-[11px] text-muted-foreground">
              POST <code className="rounded bg-background px-1">/invoice</code> con <code className="rounded bg-background px-1">customer_id</code> y{" "}
              <code className="rounded bg-background px-1">amount_total</code>.
            </CollapsibleContent>
          </Collapsible>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Cliente</Label>
              {customerComboOptions.length > 0 ? (
                <SavioSearchablePick
                  options={customerComboOptions}
                  value={customerId}
                  onChange={setCustomerId}
                  placeholder="Buscar cliente por nombre…"
                  searchPlaceholder="Buscar cliente…"
                  disabled={writeMut.isPending}
                />
              ) : null}
              <Label htmlFor="sw-cust" className="text-[11px] text-muted-foreground">
                Identificador de cliente en Savio (editable)
              </Label>
              <Input
                id="sw-cust"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-total">Importe total</Label>
              <Input
                id="sw-total"
                type="text"
                inputMode="decimal"
                value={amountTotal}
                onChange={(e) => setAmountTotal(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-desc">Descripción (opcional)</Label>
              <Input id="sw-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sw-due">Vencimiento (opcional)</Label>
              <Input id="sw-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <Collapsible className="rounded-md border border-border/60 bg-muted/20 px-2 py-1.5">
              <CollapsibleTrigger className="flex w-full items-center justify-between text-left text-[11px] text-muted-foreground hover:text-foreground">
                Conceptos avanzados (JSON opcional)
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2 space-y-1.5">
                <p className="text-[11px] text-muted-foreground">
                  Si tu cuenta Savio exige líneas de detalle, pega un arreglo JSON o{" "}
                  <code className="rounded bg-background px-0.5">{"{ \"items\": [...] }"}</code> según OpenAPI.
                </p>
                <Textarea
                  id="sw-inv-items"
                  value={invoiceItemsJson}
                  onChange={(e) => setInvoiceItemsJson(e.target.value)}
                  placeholder='[{"description":"Servicio","quantity":1,"unit_price":1000}]'
                  className="font-mono text-[11px] min-h-[88px]"
                  disabled={writeMut.isPending}
                />
              </CollapsibleContent>
            </Collapsible>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setInvOpen(false)} disabled={writeMut.isPending}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void submitInvoice()} disabled={writeMut.isPending}>
              {writeMut.isPending ? "Enviando…" : "Enviar a Savio"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
