export type Source = "sat" | "savio" | "manual" | "estados" | "buzon" | "pendiente";
export type Pose = "saluda" | "listo" | "cifras" | "duda" | "datos" | "pendientes";
export type KpiTone = "ingreso" | "egreso" | "neto" | "impuesto";
export type PeriodId = "mes" | "trimestre" | "anio";
export type ProposalStatus = "sugerida" | "cliente" | "confirmada" | "revisar";

export interface CashflowPoint {
  label: string;
  ingresos: number;
  egresos: number;
  emitidas?: number;
  recibidas?: number;
}

export interface LineageStep {
  title: string;
  detail?: string;
  state?: "done" | "pending";
  source?: Source;
  meta?: string;
  uuids?: string[];
}

export interface RankItem {
  name: string;
  amount: number;
  share: number;
  meta?: string;
  other?: boolean;
}

export interface InvoiceRow {
  date: string;
  party: string;
  rfc?: string;
  folio: string;
  total: number;
  status: "vigente" | "cancelado";
  proposal?: { account: string; code?: string; status: ProposalStatus; note?: string };
}

export interface GroupItem {
  name: string;
  amount: number;
  share: number;
  count?: number;
  unclassified?: boolean;
}

export interface MailPoint {
  label: string;
  value: string;
}

export interface TeamMember {
  name: string;
  area: "Contable" | "Legal" | string;
}

export interface ChatMessage {
  from: "eq" | "yo";
  name?: string;
  area?: string;
  time: string;
  text: string;
  attachment?: string;
}

export interface RequestItem {
  kind: "factura" | "recibo";
  title: string;
  date: string;
  detail?: string;
  step: number;
  folio?: string;
}

/** Estatus legible para filtros del demo (espejo de step). */
export type RequestFilter = "todas" | "pendiente" | "en_proceso" | "hecha";

export interface InsightItem {
  title: string;
  detail: string;
  basis?: string;
  /** Acción o seguimiento del equipo Kawiil en central */
  followUp?: string;
  owner?: string;
  status?: "abierto" | "en_seguimiento" | "cerrado";
}
