import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BANKS, bankSuggestion } from "@/lib/finance/banks";
import { useCreateAccount, useFinanceAccounts, type FinanceAccount } from "@/hooks/useFinanceBank";

/** Alta de cuenta: banco (lista de instituciones o texto libre), saldo inicial y, si aplica, dinero de terceros. */
export function AccountDialog({ open, onOpenChange, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; onCreated?: (a: FinanceAccount) => void;
}) {
  const { data: accounts = [] } = useFinanceAccounts();
  const create = useCreateAccount();
  const [institution, setInstitution] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [kind, setKind] = useState<"banco" | "efectivo" | "otro">("banco");
  const [opening, setOpening] = useState("");
  const [tail, setTail] = useState("");
  const [third, setThird] = useState(false);
  const [parentId, setParentId] = useState("");

  useEffect(() => { if (!nameTouched) setName(institution ? bankSuggestion(institution) : ""); }, [institution, nameTouched]);
  useEffect(() => { if (kind === "efectivo") { setInstitution(""); if (!nameTouched) setName("Efectivo"); } }, [kind, nameTouched]);

  const duplicate = accounts.some((a) => a.name.toLowerCase() === name.trim().toLowerCase());

  async function save() {
    if (!name.trim() || duplicate) return;
    const acc = await create.mutateAsync({
      name: name.trim(), kind, institution: institution.trim() || null, opening_balance: Number(opening) || 0,
      counts_as_available: !third, parent_account_id: third && parentId ? parentId : null,
      notes: tail.trim() ? `Cuenta/tarjeta ${tail.trim()}` : null,
    });
    onCreated?.(acc);
    setInstitution(""); setName(""); setNameTouched(false); setOpening(""); setTail(""); setThird(false); setParentId("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva cuenta</DialogTitle>
          <DialogDescription>Crea la cuenta antes de cargar sus movimientos. Puedes tener varias del mismo banco.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="banco">Cuenta bancaria / tarjeta</SelectItem>
              <SelectItem value="efectivo">Efectivo (caja)</SelectItem>
              <SelectItem value="otro">Otra (billetera, plataforma…)</SelectItem>
            </SelectContent>
          </Select>
          {kind !== "efectivo" && (
            <div>
              <Label className="text-xs">Banco o institución</Label>
              <Input list="finance-banks" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Escribe para buscar: Fondeadora, Banregio, STP…" />
              <datalist id="finance-banks">{BANKS.map((b) => <option key={b} value={b} />)}</datalist>
            </div>
          )}
          <div>
            <Label className="text-xs">Nombre de la cuenta</Label>
            <Input value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true); }} placeholder="Ej. Banregio Kawiil, Fondeadora" />
            {duplicate && <p className="text-[11px] text-red-600 mt-1">Ya existe una cuenta con ese nombre.</p>}
          </div>
          {kind !== "efectivo" && (
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">Últimos 4 dígitos (opcional)</Label><Input value={tail} maxLength={4} onChange={(e) => setTail(e.target.value.replace(/\D/g, ""))} /></div>
              <div><Label className="text-xs">Saldo inicial (MXN)</Label><Input type="number" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} /></div>
            </div>
          )}
          {kind === "efectivo" && <div><Label className="text-xs">Efectivo disponible hoy (MXN)</Label><Input type="number" step="0.01" value={opening} onChange={(e) => setOpening(e.target.value)} /></div>}
          <Label className="flex items-center gap-2 text-xs font-normal">
            <Checkbox checked={third} onCheckedChange={(v) => setThird(!!v)} /> Es dinero de terceros (impuestos de clientes; no suma a disponible)
          </Label>
          {third && (
            <Select value={parentId || "__none"} onValueChange={(v) => setParentId(v === "__none" ? "" : v)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Cuenta propia separada</SelectItem>
                {accounts.filter((a) => !a.parent_account_id).map((a) => <SelectItem key={a.id} value={a.id}>Depositado en {a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button className="w-full" onClick={save} disabled={!name.trim() || duplicate || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Crear cuenta
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
