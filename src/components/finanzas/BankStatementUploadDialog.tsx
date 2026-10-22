import { useEffect, useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  useCreateBankAccount, useImportStatement, type BankAccount,
} from "@/hooks/useBankFinance";
import { parseMoney, parseStatementFile, type ParsedStatement } from "@/lib/bankStatement";

const NEW_ACCOUNT = "__new__";
const fmt = (n: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  accounts: BankAccount[];
  defaultAccountId?: string | null;
}

export function BankStatementUploadDialog({ open, onOpenChange, accounts, defaultAccountId }: Props) {
  const [accountId, setAccountId] = useState<string>("");
  const [newName, setNewName] = useState("");
  const [newBank, setNewBank] = useState("");
  const [newLast4, setNewLast4] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [closingText, setClosingText] = useState("");
  const createAccount = useCreateBankAccount();
  const importer = useImportStatement();

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setParsed(null);
    setParseError(null);
    setClosingText("");
    setNewName("");
    setNewBank("");
    setNewLast4("");
    setAccountId(defaultAccountId ?? (accounts.length === 0 ? NEW_ACCOUNT : accounts[0]?.id ?? ""));
  }, [open, defaultAccountId, accounts]);

  const onFile = async (f: File | null) => {
    setFile(f);
    setParsed(null);
    setParseError(null);
    if (!f) return;
    try {
      setParsed(await parseStatementFile(f));
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "No pudimos leer el archivo.");
    }
  };

  const closingOverride = closingText.trim() ? parseMoney(closingText) : null;
  const needsClosing = !!parsed && parsed.closingBalance == null;
  const creatingAccount = accountId === NEW_ACCOUNT;
  const canSubmit =
    !!file && !!parsed && (!creatingAccount || newName.trim().length > 0) && (!needsClosing || closingOverride != null);
  const busy = createAccount.isPending || importer.isPending;

  const submit = async () => {
    if (!file || !parsed) return;
    try {
      let targetId = accountId;
      if (creatingAccount) {
        const acc = await createAccount.mutateAsync({
          name: newName.trim(), bank: newBank.trim(), last4: newLast4.trim(),
        });
        targetId = acc.id;
      }
      const r = await importer.mutateAsync({
        accountId: targetId, file, parsed, closingBalanceOverride: closingOverride,
      });
      toast.success(
        r.duplicates > 0
          ? `Estado cargado: ${r.inserted} movimientos nuevos, ${r.duplicates} ya estaban`
          : `Estado cargado: ${r.inserted} movimientos`,
      );
      onOpenChange(false);
    } catch (e) {
      toast.error("No pudimos cargar el estado de cuenta", {
        description: e instanceof Error ? e.message : undefined,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="zen-dialog zen-dash max-w-lg">
        <DialogHeader>
          <DialogTitle>Cargar estado de cuenta</DialogTitle>
          <DialogDescription>
            Sube el archivo Excel o CSV que descargas del banco. Leemos los movimientos y el saldo final.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Cuenta</Label>
            <Select value={accountId} onValueChange={setAccountId}>
              <SelectTrigger><SelectValue placeholder="Elige una cuenta" /></SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}{a.last4 ? ` ····${a.last4}` : ""}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_ACCOUNT}>+ Nueva cuenta</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {creatingAccount && (
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-3 space-y-1.5">
                <Label className="text-xs">Nombre de la cuenta</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ej. BBVA operativa" />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Banco (opcional)</Label>
                <Input value={newBank} onChange={(e) => setNewBank(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Últimos 4</Label>
                <Input value={newLast4} maxLength={4} onChange={(e) => setNewLast4(e.target.value.replace(/\D/g, ""))} />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Archivo</Label>
            <Input
              type="file"
              accept=".csv,.xlsx,.xls,.pdf"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {parseError && <p className="text-xs text-amber-700 dark:text-amber-400">{parseError}</p>}

          {parsed && (
            <div className="rounded-xl border border-border/50 bg-muted/30 p-3 text-xs space-y-1">
              <p className="flex items-center gap-1.5 font-medium">
                <FileSpreadsheet className="h-3.5 w-3.5" />
                {parsed.transactions.length} movimientos · {parsed.periodStart} a {parsed.periodEnd}
              </p>
              <p className="text-muted-foreground">
                Entradas {fmt(parsed.transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0))}
                {" · "}Salidas {fmt(-parsed.transactions.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0))}
              </p>
              {parsed.closingBalance != null && (
                <p className="text-muted-foreground">Saldo final detectado: {fmt(parsed.closingBalance)}</p>
              )}
              {parsed.skipped > 0 && (
                <p className="text-muted-foreground">{parsed.skipped} filas no se pudieron leer y se omitieron.</p>
              )}
            </div>
          )}

          {needsClosing && (
            <div className="space-y-1.5">
              <Label className="text-xs">Saldo final de la cuenta</Label>
              <Input
                inputMode="decimal"
                value={closingText}
                onChange={(e) => setClosingText(e.target.value)}
                placeholder="El archivo no trae saldo; escríbelo del estado"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancelar</Button>
          <Button onClick={submit} disabled={!canSubmit || busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Cargar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
