import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { useClients } from "@/hooks/useClients";
import { useGroupCompanies } from "@/hooks/useGroupCompanies";
import {
  useCreateRecurringExpense,
  useUpdateRecurringExpense,
  FREQUENCY_LABELS,
  type RecurringExpense,
  type RecurringFrequency,
  type RecurringChargeTo,
} from "@/hooks/useRecurringExpenses";
import { toast } from "sonner";

const CATEGORY_OPTIONS = [
  { value: "operativo", label: "Operativo interno" },
  { value: "terceros", label: "Gastos por terceros / cliente" },
  { value: "viaticos", label: "Viáticos" },
  { value: "contratacion_externa", label: "Contrataciones externas" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: RecurringExpense | null;
}

export function RecurringExpenseFormDialog({ open, onOpenChange, editing }: Props) {
  const { data: clients = [] } = useClients();
  const { data: groupCompanies = [] } = useGroupCompanies();
  const createRecurring = useCreateRecurringExpense();
  const updateRecurring = useUpdateRecurringExpense();

  const [name, setName] = useState("");
  const [category, setCategory] = useState("operativo");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("MXN");
  const [frequency, setFrequency] = useState<RecurringFrequency>("mensual");
  const [dayOfMonth, setDayOfMonth] = useState("");
  const [vendor, setVendor] = useState("");
  const [chargeTo, setChargeTo] = useState<RecurringChargeTo>("kawiil");
  const [clientId, setClientId] = useState("");
  const [groupCompanyId, setGroupCompanyId] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setCategory(editing.category);
      setAmount(String(editing.amount));
      setCurrency(editing.currency);
      setFrequency(editing.frequency);
      setDayOfMonth(editing.day_of_month ? String(editing.day_of_month) : "");
      setVendor(editing.vendor ?? "");
      setChargeTo(editing.charge_to);
      setClientId(editing.client_id ?? "");
      setGroupCompanyId(editing.group_company_id ?? "");
      setStartDate(editing.start_date);
      setEndDate(editing.end_date ?? "");
      setNotes(editing.notes ?? "");
    } else {
      setName("");
      setCategory("operativo");
      setAmount("");
      setCurrency("MXN");
      setFrequency("mensual");
      setDayOfMonth("");
      setVendor("");
      setChargeTo("kawiil");
      setClientId("");
      setGroupCompanyId("");
      setStartDate(new Date().toISOString().slice(0, 10));
      setEndDate("");
      setNotes("");
    }
  }, [open, editing]);

  const handleSubmit = async () => {
    const amt = Number(amount);
    if (!name.trim()) return toast.error("Escribe un nombre para el gasto recurrente.");
    if (!amt || amt <= 0) return toast.error("El monto debe ser mayor a 0.");
    if (chargeTo === "cliente" && !clientId) return toast.error("Selecciona el cliente al que se cobra.");
    if (chargeTo === "empresa_grupo" && !groupCompanyId)
      return toast.error("Selecciona la empresa del grupo.");

    const payload = {
      name,
      category,
      amount: amt,
      currency,
      frequency,
      day_of_month: dayOfMonth ? Number(dayOfMonth) : null,
      vendor: vendor || null,
      charge_to: chargeTo,
      client_id: chargeTo === "cliente" ? clientId : clientId || null,
      group_company_id: chargeTo === "empresa_grupo" ? groupCompanyId : null,
      start_date: startDate,
      end_date: endDate || null,
      notes: notes || null,
    };

    if (editing) {
      await updateRecurring.mutateAsync({ id: editing.id, ...payload });
    } else {
      await createRecurring.mutateAsync(payload);
    }
    onOpenChange(false);
  };

  const clientOptions = [{ value: "", label: "Ninguno" }, ...clients.map((c) => ({ value: c.id, label: c.name }))];
  const groupOptions = [
    { value: "", label: "Seleccionar…" },
    ...groupCompanies.map((g) => ({ value: g.id, label: g.name })),
  ];
  const busy = createRecurring.isPending || updateRecurring.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar gasto recurrente" : "Nuevo gasto recurrente"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Nombre *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Renta oficina, Adobe, Nómina…" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Categoría</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Frecuencia</Label>
              <Select value={frequency} onValueChange={(v) => setFrequency(v as RecurringFrequency)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(FREQUENCY_LABELS) as RecurringFrequency[]).map((f) => (
                    <SelectItem key={f} value={f}>{FREQUENCY_LABELS[f]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1 col-span-1">
              <Label className="text-xs">Monto *</Label>
              <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Moneda</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MXN">MXN</SelectItem>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="EUR">EUR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Día del mes</Label>
              <Input type="number" min="1" max="31" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} placeholder="1-31" />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Proveedor</Label>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Ej. Adobe, arrendador…" />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">¿A cuenta de quién?</Label>
            <Select value={chargeTo} onValueChange={(v) => setChargeTo(v as RecurringChargeTo)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="kawiil">A cuenta de Kawiil (interno)</SelectItem>
                <SelectItem value="cliente">A cuenta del cliente (se le cobra)</SelectItem>
                <SelectItem value="empresa_grupo">A cuenta de empresa del grupo</SelectItem>
                <SelectItem value="reembolsar_trabajador">Reembolso a trabajador</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {chargeTo === "cliente" && (
            <div className="space-y-1">
              <Label className="text-xs">Cliente *</Label>
              <SearchableSelect options={clientOptions} value={clientId} onValueChange={setClientId} placeholder="Selecciona cliente…" />
            </div>
          )}
          {chargeTo === "empresa_grupo" && (
            <div className="space-y-1">
              <Label className="text-xs">Empresa del grupo *</Label>
              <SearchableSelect options={groupOptions} value={groupCompanyId} onValueChange={setGroupCompanyId} placeholder="Selecciona empresa…" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Inicio</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Fin (opcional)</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notas</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Información adicional…" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} disabled={busy}>
              {busy ? "Guardando…" : editing ? "Guardar cambios" : "Crear"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
