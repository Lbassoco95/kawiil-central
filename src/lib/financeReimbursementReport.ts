import type { Expense } from "@/hooks/useExpenses";

const CATEGORY_LABELS: Record<string, string> = {
  terceros: "Terceros / cliente",
  viaticos: "Viáticos",
  operativo: "Operativo interno",
  contratacion_externa: "Contratación externa",
};

/** Plantilla por defecto si la de la base de datos aún no está disponible. */
export const DEFAULT_REIMBURSEMENT_TEMPLATE = {
  subject: "Reembolso de gastos — {{cliente}}",
  body_html: `<p>Estimado(a) {{cliente}}:</p>
<p>Por medio del presente le compartimos el desglose de los gastos que el despacho cubrió por su cuenta y que corresponden a reembolso. Agradecemos su atención para gestionar el pago correspondiente.</p>
{{tabla_gastos}}
<p><strong>Total a reembolsar: {{total}}</strong></p>
<p>Quedamos atentos a cualquier aclaración.</p>
<p>Saludos cordiales,<br/>Área de Finanzas</p>`,
};

export function formatMoney(n: number, currency = "MXN"): string {
  return `$${Number(n).toLocaleString("es-MX", { minimumFractionDigits: 2 })} ${currency}`;
}

/** Suma de montos (asume misma moneda; agrupa por la del primer gasto). */
export function sumExpenses(expenses: Expense[]): number {
  return expenses.reduce((s, e) => s + Number(e.amount), 0);
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Tabla HTML con el desglose de gastos para el reporte. */
export function buildExpenseTableHtml(expenses: Expense[]): string {
  const rows = expenses
    .map((e) => {
      const date = new Date(e.expense_date).toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
      const cat = CATEGORY_LABELS[e.category] || e.category;
      return `<tr>
  <td style="padding:6px 10px;border:1px solid #e2e8f0;">${esc(date)}</td>
  <td style="padding:6px 10px;border:1px solid #e2e8f0;">${esc(e.description || "—")}</td>
  <td style="padding:6px 10px;border:1px solid #e2e8f0;">${esc(cat)}</td>
  <td style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;white-space:nowrap;">${esc(formatMoney(Number(e.amount), e.currency))}</td>
</tr>`;
    })
    .join("\n");

  return `<table style="border-collapse:collapse;width:100%;font-size:13px;margin:12px 0;">
  <thead>
    <tr style="background:#f1f5f9;">
      <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left;">Fecha</th>
      <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left;">Concepto</th>
      <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:left;">Categoría</th>
      <th style="padding:6px 10px;border:1px solid #e2e8f0;text-align:right;">Monto</th>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>`;
}

/** Reemplaza los placeholders {{var}} del cuerpo/asunto de la plantilla. */
export function fillTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key: string) =>
    key in vars ? vars[key] : "",
  );
}

export interface ReimbursementReport {
  subject: string;
  bodyHtml: string;
  total: number;
  currency: string;
}

/** Construye el reporte de reembolso para un cliente a partir de la plantilla. */
export function buildReimbursementReport(params: {
  clientName: string;
  expenses: Expense[];
  template?: { subject: string; body_html: string } | null;
}): ReimbursementReport {
  const { clientName, expenses } = params;
  const tpl = params.template ?? DEFAULT_REIMBURSEMENT_TEMPLATE;
  const currency = expenses[0]?.currency || "MXN";
  const total = sumExpenses(expenses);
  const vars = {
    cliente: clientName,
    tabla_gastos: buildExpenseTableHtml(expenses),
    total: formatMoney(total, currency),
  };
  return {
    subject: fillTemplate(tpl.subject, vars),
    bodyHtml: fillTemplate(tpl.body_html, vars),
    total,
    currency,
  };
}
