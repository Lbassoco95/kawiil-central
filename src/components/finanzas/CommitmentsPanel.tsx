import { useMemo, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFinanceCommitments, useSaveCommitment, type FinanceCommitment } from "@/hooks/useFinanceBank";

const money = (n: number, d = 0) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: d });
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" }) : "Sin fecha");
const today = () => new Date().toISOString().slice(0, 10);

function NewCommitmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const save = useSaveCommitment();
  const [direction, setDirection] = useState<"pagar" | "cobrar">("pagar");
  const [counterparty, setCounterparty] = useState("");
  const [concept, setConcept] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [category, setCategory] = useState("");
  async function submit() {
    const n = Number(amount);
    if (!concept.trim() || !n) return;
    await save.mutateAsync({ direction, counterparty: counterparty.trim() || null, concept: concept.trim(), amount: n, due_date: due || null, category: category.trim() || null, status: "pendiente", currency: "MXN" });
    setConcept(""); setAmount(""); setCounterparty(""); setDue(""); onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nuevo compromiso</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Select value={direction} onValueChange={(v) => setDirection(v as "pagar" | "cobrar")}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="pagar">Por pagar (compromiso)</SelectItem><SelectItem value="cobrar">Por cobrar</SelectItem></SelectContent>
          </Select>
          <Input placeholder="Concepto (ej. Nómina 1ra quincena dic)" value={concept} onChange={(e) => setConcept(e.target.value)} />
          <Input placeholder="Proveedor / cliente (opcional)" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <Input type="number" min="0" step="0.01" placeholder="Monto MXN" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </div>
          <Input placeholder="Categoría (opcional)" value={category} onChange={(e) => setCategory(e.target.value)} />
          <Button className="w-full" onClick={submit} disabled={save.isPending}>Guardar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CommitmentsPanel() {
  const { data: items = [] } = useFinanceCommitments();
  const save = useSaveCommitment();
  const [dir, setDir] = useState<"todos" | "pagar" | "cobrar">("todos");
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState(false);

  const rows = useMemo(() => items
    .filter((c) => (dir === "todos" || c.direction === dir) && (showDone || c.status === "pendiente"))
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999")), [items, dir, showDone]);

  const settle = (c: FinanceCommitment) => save.mutate({ id: c.id, status: "pagado", settled_at: today() });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2 items-center">
          <Select value={dir} onValueChange={(v) => setDir(v as typeof dir)}>
            <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="todos">Todos</SelectItem><SelectItem value="pagar">Por pagar</SelectItem><SelectItem value="cobrar">Por cobrar</SelectItem></SelectContent>
          </Select>
          <Button size="sm" variant={showDone ? "secondary" : "ghost"} className="h-8 text-xs" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "Ocultar cerrados" : "Ver cerrados"}
          </Button>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> Nuevo compromiso</Button>
      </div>
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Sin compromisos. Se cargan desde el Excel (notaría, pagos planeados, por cobrar) o con «Nuevo compromiso».</p>
      ) : (
        <div className="rounded-xl border border-border/50 overflow-hidden">
          <Table>
            <TableHeader><TableRow><TableHead>Vence</TableHead><TableHead>Concepto</TableHead><TableHead>Tipo</TableHead><TableHead className="text-right">Monto</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rows.map((c) => {
                const late = c.status === "pendiente" && c.due_date && c.due_date < today();
                return (
                  <TableRow key={c.id}>
                    <TableCell className={`text-xs whitespace-nowrap ${late ? "text-red-600 font-medium" : ""}`}>{day(c.due_date)}</TableCell>
                    <TableCell className="text-xs max-w-[320px]">
                      <div className="truncate" title={c.concept}>{c.concept}</div>
                      {(c.counterparty || c.category) && <div className="text-[10px] text-muted-foreground truncate">{[c.counterparty, c.category].filter(Boolean).join(" · ")}</div>}
                    </TableCell>
                    <TableCell><Badge variant={c.direction === "pagar" ? "outline" : "secondary"} className="text-[10px]">{c.direction === "pagar" ? "Por pagar" : "Por cobrar"}</Badge></TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {money(Number(c.amount), 2)}
                      {c.original_amount && c.currency !== "MXN" && <div className="text-[10px] text-muted-foreground">{c.original_amount} {c.currency}</div>}
                    </TableCell>
                    <TableCell className="text-right">
                      {c.status === "pendiente"
                        ? <Button size="sm" variant="outline" className="h-7 text-xs" disabled={save.isPending} onClick={() => settle(c)}><Check className="h-3 w-3 mr-1" />{c.direction === "pagar" ? "Pagado" : "Cobrado"}</Button>
                        : <Badge variant="outline" className="text-[10px]">{c.status}</Badge>}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <NewCommitmentDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}
