import { useMemo, useState } from "react";
import { AlertTriangle, Banknote, CalendarClock, Landmark, Plus, Sparkles, Upload, Wallet, Check, Inbox, Brain, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BankImportDialog } from "./BankImportDialog";
import { CategoryPicker } from "./CategoryPicker";
import { AccountDialog } from "./AccountDialog";
import { CommitmentsPanel } from "./CommitmentsPanel";
import { MonthlyClosePanel } from "./MonthlyClosePanel";
import { ReconciliationPanel } from "./ReconciliationPanel";
import { ThirdPartyPanel } from "./ThirdPartyPanel";
import {
  useAddManualMovement, useClassifyMovements, useCreateAccount, useFinanceAccounts, useFinanceCategories,
  useFinanceMovements, useFinanceCommitments, useFinanceRules, useRuleIndex, type FinanceMovement,
} from "@/hooks/useFinanceBank";
import { proposeNewCategories, suggestCategory } from "@/lib/finance/classifier";
import { accountBalances, monthlyClose, summarizeCommitments } from "@/lib/finance/planning";

const money = (n: number, d = 0) => n.toLocaleString("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: d });
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" });
function ManualMovementDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: accounts = [] } = useFinanceAccounts();
  const createAccount = useCreateAccount();
  const add = useAddManualMovement();
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [dir, setDir] = useState<"out" | "in">("out");
  const [category, setCategory] = useState("");
  const cash = accounts.find((a) => a.kind === "efectivo");

  async function save() {
    let id = accountId;
    if (!id) {
      const acc = cash ?? (await createAccount.mutateAsync({ name: "Efectivo", kind: "efectivo", opening_balance: 0, counts_as_available: true }));
      id = acc.id;
    }
    const n = Number(amount);
    if (!n || n <= 0 || !desc.trim()) return;
    await add.mutateAsync({ account_id: id, movement_date: date, description: desc.trim(), debit: dir === "out" ? n : 0, credit: dir === "in" ? n : 0, category: category || null });
    setDesc(""); setAmount(""); onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Registrar movimiento manual / efectivo</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Select value={accountId || "__cash"} onValueChange={(v) => setAccountId(v === "__cash" ? "" : v)}>
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__cash">Efectivo (caja){cash ? "" : " — se creará"}</SelectItem>
              {accounts.filter((a) => a.kind !== "efectivo").map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <Select value={dir} onValueChange={(v) => setDir(v as "in" | "out")}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="out">Salida (gasto)</SelectItem><SelectItem value="in">Entrada (ingreso)</SelectItem></SelectContent>
            </Select>
          </div>
          <Input placeholder="Descripción" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <Input type="number" min="0" step="0.01" placeholder="Monto" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <CategoryPicker value={category} onChange={setCategory} className="w-full" />
          <Button className="w-full" onClick={save} disabled={add.isPending}>Guardar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PendingQueue({ pending }: { pending: FinanceMovement[] }) {
  const ruleIndex = useRuleIndex();
  const classify = useClassifyMovements();
  const { data: accounts = [] } = useFinanceAccounts();
  const accName = (id: string) => accounts.find((a) => a.id === id)?.name ?? "";
  const rows = useMemo(
    () => pending.slice(0, 150).map((m) => ({ m, s: suggestCategory({ description: m.description, reference: m.reference, debit: Number(m.debit), credit: Number(m.credit) }, ruleIndex) })),
    [pending, ruleIndex],
  );
  const withSuggestion = rows.filter((r) => r.s && r.s.confidence >= 0.5);

  if (pending.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2"><Check className="h-4 w-4 text-green-600" /> Todo clasificado.</p>;
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {pending.length} movimientos sin categoría{pending.length > 150 ? " (mostrando 150)" : ""}. Aquí se asigna <b>de qué es cada gasto</b>; no tiene que ver con la conciliación con el banco (pestaña «Conciliación»). Cada confirmación enseña al sistema.
        </p>
        {withSuggestion.length > 0 && (
          <Button size="sm" variant="secondary" disabled={classify.isPending} onClick={async () => {
            const byCat = new Map<string, FinanceMovement[]>();
            withSuggestion.forEach(({ m, s }) => byCat.set(s!.category, [...(byCat.get(s!.category) ?? []), m]));
            for (const [category, items] of byCat) await classify.mutateAsync({ items, category, source: "sugerida" });
          }}>
            <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Aceptar {withSuggestion.length} sugerencias
          </Button>
        )}
      </div>
      <div className="rounded-xl border border-border/50 overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead className="text-right">Monto</TableHead><TableHead>Categoría</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map(({ m, s }) => (
              <TableRow key={m.id}>
                <TableCell className="text-xs whitespace-nowrap">{day(m.movement_date)}<div className="text-[10px] text-muted-foreground">{accName(m.account_id)}</div></TableCell>
                <TableCell className="text-xs max-w-[340px] truncate" title={m.description}>{m.description}</TableCell>
                <TableCell className={`text-right text-xs tabular-nums ${Number(m.credit) > 0 ? "text-green-700" : ""}`}>
                  {Number(m.credit) > 0 ? `+${money(Number(m.credit), 2)}` : `−${money(Number(m.debit), 2)}`}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {s && (
                      <Button size="sm" variant="outline" className="h-8 text-xs" disabled={classify.isPending}
                        onClick={() => classify.mutate({ items: [m], category: s.category, source: "sugerida" })}>
                        <Sparkles className="h-3 w-3 mr-1" />{s.category}<span className="ml-1 text-muted-foreground">{Math.round(s.confidence * 100)}%</span>
                      </Button>
                    )}
                    <CategoryPicker value="" onChange={(category, kind) => classify.mutate({ items: [m], category, kind })} className="w-36" />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function LearningPanel({ movements }: { movements: FinanceMovement[] }) {
  const classify = useClassifyMovements();
  const { data: rules = [] } = useFinanceRules();
  const proposals = useMemo(() => {
    const pool = movements.filter((m) => m.review_status === "pendiente" || m.category === "Otros gastos" || m.category === "Otros ingresos");
    return proposeNewCategories(pool.map((m) => ({ id: m.id, description: m.description, debit: Number(m.debit), credit: Number(m.credit) })));
  }, [movements]);
  const byId = useMemo(() => new Map(movements.map((m) => [m.id, m])), [movements]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Brain className="h-4 w-4" /> El sistema ha aprendido <b>{rules.length}</b> patrones de tus clasificaciones.
      </div>
      <h3 className="text-sm font-medium">Categorías que te propone crear</h3>
      {proposals.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no hay comercios o personas recurrentes sin categoría. Sigue cargando movimientos.</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {proposals.map((p) => (
            <Card key={p.key} variant="glass"><CardContent className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{p.suggestedName}</p>
                <p className="text-xs text-muted-foreground">{p.count} movimientos · {money(p.total)} · «{p.sample.slice(0, 40)}»</p>
              </div>
              <Button size="sm" variant="outline" disabled={classify.isPending}
                onClick={() => classify.mutate({ items: p.movementIds.map((id) => byId.get(id)!).filter(Boolean), category: p.suggestedName, kind: p.kind })}>
                Crear y aplicar
              </Button>
            </CardContent></Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function BankTab() {
  const { data: accounts = [], isLoading: la } = useFinanceAccounts();
  const { data: movements = [], isLoading: lm } = useFinanceMovements();
  const { data: commitments = [] } = useFinanceCommitments();
  const { categories } = useFinanceCategories();
  const [importOpen, setImportOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountFilter, setAccountFilter] = useState("todas");
  const [catFilter, setCatFilter] = useState("todas");
  const [search, setSearch] = useState("");

  const bal = useMemo(() => accountBalances(accounts, movements.map((m) => ({
    account_id: m.account_id, debit: Number(m.debit), credit: Number(m.credit), movement_date: m.movement_date,
    row_seq: m.row_seq, reported_balance: m.reported_balance == null ? null : Number(m.reported_balance),
  }))), [accounts, movements]);
  // Meses donde la suma de movimientos no cuadra con el saldo que reporta el banco (por cuenta).
  const driftMonths = useMemo(() => {
    const out: Record<string, { label: string; amount: number }[]> = {};
    const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    for (const a of accounts) {
      const ms = movements.filter((m) => m.account_id === a.id).map((m) => ({ account_id: m.account_id, debit: Number(m.debit), credit: Number(m.credit), movement_date: m.movement_date, row_seq: m.row_seq, reported_balance: m.reported_balance == null ? null : Number(m.reported_balance) }));
      out[a.id] = monthlyClose(Number(a.opening_balance), ms).filter((r) => r.monthDrift != null && Math.abs(r.monthDrift) > 1).map((r) => ({ label: `${MES[Number(r.key.slice(5)) - 1]} ${r.key.slice(0, 4)}`, amount: r.monthDrift as number }));
    }
    return out;
  }, [accounts, movements]);
  // Meses con estado de cuenta del banco cargado, por cuenta (para saber si «no está en el banco» tiene sentido).
  const bankMonths = useMemo(() => new Set(movements.filter((m) => m.bank_confirmed_at).map((m) => `${m.account_id}|${m.movement_date.slice(0, 7)}`)), [movements]);
  const cs = useMemo(() => summarizeCommitments(commitments, new Date().toISOString().slice(0, 10), bal.available), [commitments, bal.available]);
  const pending = useMemo(() => movements.filter((m) => m.review_status === "pendiente"), [movements]);
  const lastDate = movements[0]?.movement_date;
  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return movements.filter((m) =>
      (accountFilter === "todas" || m.account_id === accountFilter) &&
      (catFilter === "todas" || (catFilter === "__sin" ? !m.category : m.category === catFilter)) &&
      (!s || m.description.toLowerCase().includes(s))).slice(0, 200);
  }, [movements, accountFilter, catFilter, search]);

  if (la || lm) return <Skeleton className="h-64 w-full rounded-2xl" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold tabular-nums">{money(bal.available)}</p>
          <p className="text-xs text-muted-foreground">
            Disponible propio en bancos y efectivo{lastDate ? ` · último movimiento ${day(lastDate)}` : ""}
            {bal.held !== 0 && ` · ${money(bal.held)} en cuentas de terceros (no incluido)`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setAccountOpen(true)}><Landmark className="h-4 w-4 mr-1.5" /> Nueva cuenta</Button>
          <Button variant="outline" size="sm" onClick={() => setManualOpen(true)}><Banknote className="h-4 w-4 mr-1.5" /> Efectivo / manual</Button>
          <Button size="sm" onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 mr-1.5" /> Cargar movimientos</Button>
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Card variant="glass"><CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><CalendarClock className="h-3.5 w-3.5" /> Comprometido a 30 días</div>
            <p className="text-lg font-semibold tabular-nums">{money(cs.payable30)}</p>
            <p className="text-[11px] text-muted-foreground">{cs.overdue > 0 ? `${money(cs.overdue)} ya vencido · ` : ""}total por pagar {money(cs.payablePending)}</p>
          </CardContent></Card>
          <Card variant="glass"><CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><ShieldCheck className="h-3.5 w-3.5" /> Disponible libre</div>
            <p className={`text-lg font-semibold tabular-nums ${cs.free < 0 ? "text-red-600" : ""}`}>{money(cs.free)}</p>
            <p className="text-[11px] text-muted-foreground">disponible − comprometido 30 d</p>
          </CardContent></Card>
          <Card variant="glass"><CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><Banknote className="h-3.5 w-3.5" /> Por cobrar (compromisos)</div>
            <p className="text-lg font-semibold tabular-nums">{money(cs.receivablePending)}</p>
            <p className="text-[11px] text-muted-foreground">fuera de Savio · Excel y manuales</p>
          </CardContent></Card>
          <Card variant="glass"><CardContent className="p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><Landmark className="h-3.5 w-3.5" /> Faltaría por cobrar</div>
            <p className={`text-lg font-semibold tabular-nums ${cs.shortfall > 0 ? "text-amber-600" : ""}`}>{money(cs.shortfall)}</p>
            <p className="text-[11px] text-muted-foreground">{cs.shortfall > 0 ? "para cubrir lo comprometido" : "lo comprometido está cubierto"}</p>
          </CardContent></Card>
        </div>
      )}

      {accounts.length === 0 ? (
        <Card variant="glass"><CardContent className="p-8 text-center space-y-3">
          <Landmark className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm">Aún no hay cuentas. Sube el Excel de movimientos (crea las cuentas solo) o crea una cuenta a mano para pegar movimientos.</p>
          <div className="flex justify-center gap-2">
            <Button onClick={() => setImportOpen(true)}><Upload className="h-4 w-4 mr-1.5" /> Subir Excel</Button>
            <Button variant="outline" onClick={() => setAccountOpen(true)}><Plus className="h-4 w-4 mr-1.5" /> Crear cuenta</Button>
          </div>
        </CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {accounts.filter((a) => a.is_active).map((a) => {
              const drift = bal.anchored[a.id] ? bal.byAccount[a.id] - bal.computed[a.id] : 0;
              const parent = accounts.find((p) => p.id === a.parent_account_id);
              return (
                <Card key={a.id} variant="glass"><CardContent className="p-4">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
                    {a.kind === "efectivo" ? <Wallet className="h-3.5 w-3.5" /> : <Landmark className="h-3.5 w-3.5" />}{a.name}
                    {!a.counts_as_available && <Badge variant="outline" className="text-[10px] ml-auto">{parent ? `en ${parent.name}` : "terceros"}</Badge>}
                  </div>
                  <p className="text-lg font-semibold tabular-nums">{money(bal.byAccount[a.id] ?? 0)}</p>
                  {Math.abs(drift) > 1 && (
                    <p className="mt-1 flex items-start gap-1 text-[10px] text-amber-600" title="El saldo que se muestra es el que reporta el banco. La suma de los movimientos cargados no llega a ese saldo: falta algún movimiento en el registro de los meses indicados. Detalle en «Cierre mensual».">
                      <AlertTriangle className="h-3 w-3 shrink-0 mt-px" />
                      <span>
                        La suma de movimientos no cuadra con el saldo del banco: diferencia de {money(Math.abs(drift))}
                        {(driftMonths[a.id] ?? []).length > 0 && <> en {(driftMonths[a.id] ?? []).slice(0, 2).map((d) => `${d.label} (${money(Math.abs(d.amount))})`).join(" y ")}</>}. Se corrige cargando ese mes.
                      </span>
                    </p>
                  )}
                </CardContent></Card>
              );
            })}
          </div>

          <Tabs defaultValue={pending.length ? "pendientes" : "movimientos"}>
            <TabsList className="h-9">
              <TabsTrigger value="pendientes" className="text-xs gap-1.5"><Inbox className="h-3.5 w-3.5" /> Por clasificar{pending.length > 0 && <Badge className="h-4 px-1.5 text-[10px]">{pending.length}</Badge>}</TabsTrigger>
              <TabsTrigger value="movimientos" className="text-xs">Movimientos</TabsTrigger>
              <TabsTrigger value="conciliacion" className="text-xs gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Conciliación</TabsTrigger>
              <TabsTrigger value="cierres" className="text-xs gap-1.5"><Check className="h-3.5 w-3.5" /> Cierre mensual</TabsTrigger>
              <TabsTrigger value="compromisos" className="text-xs gap-1.5"><CalendarClock className="h-3.5 w-3.5" /> Compromisos</TabsTrigger>
              <TabsTrigger value="terceros" className="text-xs gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Terceros (impuestos)</TabsTrigger>
              <TabsTrigger value="aprendizaje" className="text-xs gap-1.5"><Brain className="h-3.5 w-3.5" /> Aprendizaje</TabsTrigger>
            </TabsList>
            <TabsContent value="pendientes" className="mt-4"><PendingQueue pending={pending} /></TabsContent>
            <TabsContent value="movimientos" className="mt-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                <Input placeholder="Buscar descripción…" value={search} onChange={(e) => setSearch(e.target.value)} className="h-8 w-56" />
                <Select value={accountFilter} onValueChange={setAccountFilter}>
                  <SelectTrigger className="h-8 w-40 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="todas">Todas las cuentas</SelectItem>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={catFilter} onValueChange={setCatFilter}>
                  <SelectTrigger className="h-8 w-48 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="todas">Todas las categorías</SelectItem><SelectItem value="__sin">Sin categoría</SelectItem>{categories.map((c) => <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="rounded-xl border border-border/50 overflow-hidden">
                <Table>
                  <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Descripción</TableHead><TableHead>Categoría</TableHead><TableHead>Conciliación</TableHead><TableHead className="text-right">Monto</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {filtered.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="text-xs whitespace-nowrap">{day(m.movement_date)}</TableCell>
                        <TableCell className="text-xs max-w-[360px] truncate" title={m.description}>{m.description}</TableCell>
                        <TableCell className="text-xs">{m.category ? <Badge variant="outline" className="text-[10px]">{m.category}</Badge> : <span className="text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {m.bank_confirmed_at
                            ? (m.has_record ? <span className="text-green-700">✓ Conciliado</span> : <span className="text-amber-600">Solo en el banco</span>)
                            : bankMonths.has(`${m.account_id}|${m.movement_date.slice(0, 7)}`) ? <span className="text-amber-600">No está en el banco</span>
                            : <span className="text-muted-foreground">Falta estado de cuenta</span>}
                        </TableCell>
                        <TableCell className={`text-right text-xs tabular-nums ${Number(m.credit) > 0 ? "text-green-700" : ""}`}>
                          {Number(m.credit) > 0 ? `+${money(Number(m.credit), 2)}` : `−${money(Number(m.debit), 2)}`}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-[11px] text-muted-foreground">Mostrando hasta 200 de {movements.length} movimientos.</p>
            </TabsContent>
            <TabsContent value="conciliacion" className="mt-4"><ReconciliationPanel accounts={accounts} movements={movements} /></TabsContent>
            <TabsContent value="cierres" className="mt-4"><MonthlyClosePanel accounts={accounts} movements={movements} /></TabsContent>
            <TabsContent value="compromisos" className="mt-4"><CommitmentsPanel /></TabsContent>
            <TabsContent value="terceros" className="mt-4"><ThirdPartyPanel accounts={accounts} movements={movements} /></TabsContent>
            <TabsContent value="aprendizaje" className="mt-4"><LearningPanel movements={movements} /></TabsContent>
          </Tabs>
        </>
      )}

      <BankImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <ManualMovementDialog open={manualOpen} onOpenChange={setManualOpen} />
      <AccountDialog open={accountOpen} onOpenChange={setAccountOpen} />
    </div>
  );
}
