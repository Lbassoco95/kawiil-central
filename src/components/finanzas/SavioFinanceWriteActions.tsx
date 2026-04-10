import { useState } from "react";
import { format } from "date-fns";
import { FilePlus2, Landmark } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSavioFinanceWriteMutation } from "@/hooks/useSavioFinanceWrite";
import { useSavioWriteAccess } from "@/hooks/useSavioWriteAccess";

export function SavioFinanceWriteActions() {
  const { data: canWrite = false, isLoading } = useSavioWriteAccess();
  const writeMut = useSavioFinanceWriteMutation();

  const [payOpen, setPayOpen] = useState(false);
  const [invOpen, setInvOpen] = useState(false);

  const [invoiceId, setInvoiceId] = useState("");
  const [amountPaid, setAmountPaid] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const [customerId, setCustomerId] = useState("");
  const [amountTotal, setAmountTotal] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");

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
      toast.success("Pago enviado a Savio. Si la API aceptó el formato, verás el cambio al actualizar.");
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

    try {
      await writeMut.mutateAsync({ operation: "create_invoice", payload });
      toast.success("Cargo enviado a Savio. Revisa en Savio si el formato fue aceptado.");
      setInvOpen(false);
      resetInvoiceForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al crear cargo");
    }
  }

  if (isLoading || !canWrite) return null;

  return (
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

      <Dialog open={payOpen} onOpenChange={(o) => !writeMut.isPending && setPayOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Registrar pago en Savio</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Usa el mismo identificador de cargo que muestra Savio (columna id en la tabla de cargos). Los nombres de
            campo deben coincidir con tu API; si Savio rechaza la petición, revisa app.savio.mx/docs.
          </p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sw-invoice-id">ID del cargo (factura)</Label>
              <Input
                id="sw-invoice-id"
                value={invoiceId}
                onChange={(e) => setInvoiceId(e.target.value)}
                placeholder="UUID o id Savio"
                className="font-mono text-xs"
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

      <Dialog open={invOpen} onOpenChange={(o) => !writeMut.isPending && setInvOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nuevo cargo en Savio</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Flujo mínimo con importe total. Si tu cuenta exige líneas de concepto, crea el cargo en Savio o amplía el
            formulario según OpenAPI.
          </p>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="sw-cust">ID cliente Savio</Label>
              <Input
                id="sw-cust"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="font-mono text-xs"
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
    </>
  );
}
