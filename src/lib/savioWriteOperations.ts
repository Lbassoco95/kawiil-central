/**
 * Contrato de escritura Savio (Kawiil → savio-finance-write).
 * Las rutas son POST /payment, POST /invoice y POST /customer (misma base que lectura).
 * Ajustar nombres de campos si tu OpenAPI en app.savio.mx/docs difiere.
 */

export type SavioWriteOperation = "create_payment" | "create_invoice" | "create_customer";

export type CreateSavioPaymentPayload = {
  invoice_id: string;
  amount_paid: number;
  payment_date?: string;
  reference?: string;
  notes?: string;
  payment_method?: string;
  customer_id?: string;
  currency?: string;
};

export type CreateSavioInvoicePayload = {
  customer_id: string;
  amount_total?: number;
  due_date?: string;
  invoice_date?: string;
  description?: string;
  currency?: string;
  items?: unknown[];
  concepts?: unknown[];
};

/** POST /customer — campos según OpenAPI de tu entorno Savio. */
export type CreateSavioCustomerPayload = {
  name?: string;
  legal_name?: string;
  company_name?: string;
  email?: string;
  phone?: string;
  tax_id?: string;
  rfc?: string;
  address?: string;
  currency?: string;
  metadata?: unknown;
};
