/** Reexporta el motor fiscal compartido (Edge + portal + pruebas). */
export {
  calculateFiscalEstimate,
  calculatePeriodIncome,
  ivaBasisLabel,
  type FiscalEstimate,
  type FiscalInvoice,
} from "../../../supabase/functions/_shared/portal/fiscalEstimate.ts";
