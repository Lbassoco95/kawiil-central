import { useMemo, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { KAWIIL_AI_HEADER_BG } from "@/lib/kawiilAi";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { HandCoins, X, FileText, Copy, Printer, Check } from "lucide-react";
import {
  useMarkReimbursementDone,
  type Expense,
} from "@/hooks/useExpenses";
import { useClients } from "@/hooks/useClients";
import { useFinanceReimbursementTemplate } from "@/hooks/useFinanceReimbursementTemplate";
import {
  buildReimbursementReport,
  formatMoney,
  sumExpenses,
} from "@/lib/financeReimbursementReport";

const CATEGORY_LABELS: Record<string, string> = {
  terceros: "Terceros",
  viaticos: "Viáticos",
  operativo: "Operativo",
  contratacion_externa: "Contratación ext.",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expenses: Expense[];
}

interface ClientGroup {
  clientId: string | null;
  clientName: string;
  clientEmail: string | null;
  expenses: Expense[];
  total: number;
}

export function ClientReimbursementDialog({ open, onOpenChange, expenses }: Props) {
  const { data: clients = [] } = useClients();
  const { data: template } = useFinanceReimbursementTemplate();
  const markDone = useMarkReimbursementDone();
  const [report, setReport] = useState<{ client: string; subject: string; html: string } | null>(null);

  const groups = useMemo<ClientGroup[]>(() => {
    const clientMap = new Map(clients.map((c) => [c.id, c]));
    const pending = expenses.filter(
      (e) =>
        e.reimbursement_type === "cobrar_cliente" &&
        e.reimbursement_status === "pendiente" &&
        e.status !== "rechazado",
    );
    const byClient = new Map<string, Expense[]>();
    for (const e of pending) {
      const key = e.client_id ?? "__none__";
      if (!byClient.has(key)) byClient.set(key, []);
      byClient.get(key)!.push(e);
    }
    return [...byClient.entries()]
      .map(([key, exps]) => {
        const client = key === "__none__" ? null : clientMap.get(key);
        return {
          clientId: key === "__none__" ? null : key,
          clientName: client?.name ?? "Sin cliente asignado",
          clientEmail: (client as { email?: string | null } | undefined)?.email ?? null,
          expenses: exps.sort((a, b) => a.expense_date.localeCompare(b.expense_date)),
          total: sumExpenses(exps),
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [expenses, clients]);

  const grandTotal = groups.reduce((s, g) => s + g.total, 0);

  const generateReport = (g: ClientGroup) => {
    if (g.clientId === null) {
      toast.error("Asigna un cliente a estos gastos antes de generar el reporte.");
      return;
    }
    const r = buildReimbursementReport({
      clientName: g.clientName,
      expenses: g.expenses,
      template,
    });
    setReport({ client: g.clientName, subject: r.subject, html: r.bodyHtml });
  };

  const copyReport = async () => {
    if (!report) return;
    try {
      // Copia texto plano derivado del HTML (fallback amplio).
      const tmp = document.createElement("div");
      tmp.innerHTML = report.html;
      const text = `${report.subject}\n\n${tmp.innerText}`;
      await navigator.clipboard.writeText(text);
      toast.success("Reporte copiado al portapapeles");
    } catch {
      toast.error("No se pudo copiar");
    }
  };

  const printReport = () => {
    if (!report) return;
    const w = window.open("", "_blank", "noopener,noreferrer,width=800,height=900");
    if (!w) {
      toast.error("Habilita las ventanas emergentes para imprimir");
      return;
    }
    w.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${report.subject}</title>` +
        `<style>body{font-family:system-ui,Arial,sans-serif;color:#0f172a;padding:32px;line-height:1.5;}</style>` +
        `</head><body>${report.html}</body></html>`,
    );
    w.document.close();
    w.focus();
    w.print();
  };

  const markGroupDone = async (g: ClientGroup) => {
    await Promise.all(g.expenses.map((e) => markDone.mutateAsync({ id: e.id })));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden p-0 [&>button.absolute]:hidden flex flex-col rounded-2xl border-sky-200/40 dark:border-sky-900/40">
        <header
          className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5 text-white shrink-0"
          style={{ background: KAWIIL_AI_HEADER_BG }}
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/15 backdrop-blur-sm">
              <HandCoins className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold leading-tight">Cobros a clientes por reembolsar</p>
              <p className="mt-0.5 truncate text-[11px] leading-tight text-white/80">
                {groups.length} cliente{groups.length === 1 ? "" : "s"} · Total {formatMoney(grandTotal)}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1.5 text-white/90 hover:bg-white/15"
            onClick={() => onOpenChange(false)}
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="overflow-y-auto px-4 py-4 sm:px-5">
          {groups.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No hay gastos por cobrar a clientes.
            </div>
          ) : (
            <Accordion type="multiple" className="space-y-2">
              {groups.map((g) => (
                <AccordionItem
                  key={g.clientId ?? "__none__"}
                  value={g.clientId ?? "__none__"}
                  className="rounded-xl border border-border/60 bg-card/60 px-3"
                >
                  <AccordionTrigger className="hover:no-underline">
                    <div className="flex w-full items-center justify-between gap-3 pr-2">
                      <div className="min-w-0 text-left">
                        <p className="truncate text-sm font-medium">{g.clientName}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {g.expenses.length} gasto{g.expenses.length === 1 ? "" : "s"}
                          {g.clientEmail ? ` · ${g.clientEmail}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                        {formatMoney(g.total, g.expenses[0]?.currency)}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ul className="space-y-1.5 pb-2">
                      {g.expenses.map((e) => (
                        <li
                          key={e.id}
                          className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs"
                        >
                          <span className="shrink-0 text-muted-foreground w-16">
                            {format(new Date(e.expense_date), "dd MMM", { locale: es })}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{e.description}</span>
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            {CATEGORY_LABELS[e.category] || e.category}
                          </Badge>
                          <span className="shrink-0 font-medium tabular-nums">
                            {formatMoney(Number(e.amount), e.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="flex flex-wrap gap-2 pb-1">
                      <Button size="sm" onClick={() => generateReport(g)} disabled={g.clientId === null}>
                        <FileText className="h-3.5 w-3.5 mr-1" /> Generar reporte
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => markGroupDone(g)}
                        disabled={markDone.isPending}
                        className="border-amber-300/70 text-amber-700 hover:bg-amber-50 dark:border-amber-500/40 dark:text-amber-300 dark:hover:bg-amber-950/30"
                      >
                        <Check className="h-3.5 w-3.5 mr-1" /> Marcar todo cobrado
                      </Button>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      </DialogContent>

      {/* Vista previa del reporte */}
      <Dialog open={!!report} onOpenChange={(o) => !o && setReport(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden p-0 flex flex-col rounded-2xl">
          <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5 text-white shrink-0" style={{ background: KAWIIL_AI_HEADER_BG }}>
            <div className="min-w-0">
              <p className="truncate text-[14px] font-semibold leading-tight">Reporte de reembolso</p>
              <p className="mt-0.5 truncate text-[11px] leading-tight text-white/80">{report?.client}</p>
            </div>
          </header>
          <div className="overflow-y-auto px-5 py-4">
            <p className="mb-2 text-xs text-muted-foreground">
              Asunto sugerido: <span className="font-medium text-foreground">{report?.subject}</span>
            </p>
            <div
              className="prose prose-sm max-w-none rounded-lg border border-border/60 bg-white p-4 text-slate-900 dark:bg-white"
              // El reporte se arma con contenido interno controlado (plantilla + datos de gastos escapados).
              dangerouslySetInnerHTML={{ __html: report?.html ?? "" }}
            />
          </div>
          <div className="flex flex-wrap gap-2 border-t px-5 py-3">
            <Button size="sm" onClick={copyReport}>
              <Copy className="h-3.5 w-3.5 mr-1" /> Copiar
            </Button>
            <Button size="sm" variant="outline" onClick={printReport}>
              <Printer className="h-3.5 w-3.5 mr-1" /> Imprimir / PDF
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReport(null)}>
              Cerrar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
