import type {
  CashflowPoint,
  ChatMessage,
  GroupItem,
  InsightItem,
  InvoiceRow,
  LineageStep,
  RankItem,
  RequestItem,
  TeamMember,
} from "../design/types";

export const SAMPLE_CLIENT = "Bassoco, Vega, Salas, Morales, Servicios Empresariales S.C.";
export const SAMPLE_PERIOD = "Septiembre 2026";

export const CASHFLOW: CashflowPoint[] = [
  { label: "Abr", ingresos: 412000, egresos: 298000, emitidas: 18, recibidas: 31 },
  { label: "May", ingresos: 465000, egresos: 331000, emitidas: 21, recibidas: 36 },
  { label: "Jun", ingresos: 438000, egresos: 352000, emitidas: 19, recibidas: 40 },
  { label: "Jul", ingresos: 520000, egresos: 361000, emitidas: 24, recibidas: 38 },
  { label: "Ago", ingresos: 498000, egresos: 405000, emitidas: 22, recibidas: 44 },
  { label: "Sep", ingresos: 571000, egresos: 389000, emitidas: 26, recibidas: 41 },
];

export const INCOME_LINEAGE: LineageStep[] = [
  {
    state: "done",
    title: "Kawiil publicó tus CFDI en el portal",
    detail: "Central obtuvo los comprobantes (SAT vía SatGo/Moffin, con e.firma solo en central) y los publicó firmados a Kawiil OS. Aquí ya están como representación local.",
    source: "sat",
    meta: "67 comprobantes en septiembre",
    uuids: ["3F9A71C2…B04E", "A1D4E8F0…77C2"],
  },
  {
    state: "done",
    title: "Dejamos solo lo que cuenta",
    detail: "Emitidos, vigentes y de tipo Ingreso; sin cancelados. El filtro ocurre antes de publicar.",
    meta: "26 de 31 entran",
  },
  {
    state: "done",
    title: "Sumamos por mes",
    detail: "Total en MXN por fecha de emisión, ya guardado en el espejo del portal.",
    meta: "$571,000",
  },
  {
    state: "pending",
    title: "Estados financieros",
    detail: "Disponible desde enero 2027.",
    source: "pendiente",
  },
];

export const TOP_CLIENTS: RankItem[] = [
  { name: "Constructora Aldea del Sol", amount: 185000, share: 32, meta: "4 facturas" },
  { name: "Grupo Hotelero Costa Maya", amount: 142000, share: 25, meta: "3 facturas" },
  { name: "Servicios Tulum Norte", amount: 98000, share: 17, meta: "5 facturas" },
  { name: "Otros clientes", amount: 146000, share: 26, meta: "14 facturas", other: true },
];

export const TOP_SUPPLIERS: RankItem[] = [
  { name: "Papelería del Centro", amount: 42000, share: 11, meta: "8 facturas" },
  { name: "Combustibles del Sureste", amount: 68000, share: 17, meta: "12 facturas" },
  { name: "Renta Oficina Caribe", amount: 95000, share: 24, meta: "1 factura" },
  { name: "Otros proveedores", amount: 184000, share: 48, meta: "20 facturas", other: true },
];

export const INCOME_INVOICES: InvoiceRow[] = [
  {
    date: "28 sep 2026",
    party: "Constructora Aldea del Sol",
    rfc: "CAS120304AB1",
    folio: "8C1E4A27-5D3B-4F90-A6E2-7B90D1C3F548",
    total: 120000,
    status: "vigente",
    proposal: { account: "Ingreso por servicio", code: "401.01*", status: "sugerida" },
  },
  {
    date: "22 sep 2026",
    party: "Grupo Hotelero Costa Maya",
    rfc: "GHC150918XY9",
    folio: "A91B22D0-11C4-4AA1-9E10-55F0C2B8D901",
    total: 85000,
    status: "vigente",
    proposal: { account: "Ingreso por servicio", code: "401.01*", status: "cliente", note: "Servicio de supervisión" },
  },
  {
    date: "10 sep 2026",
    party: "Servicios Tulum Norte",
    rfc: "STN180201ZZ2",
    folio: "B0C3E811-77AA-4D22-B901-0AA11CC22DD3",
    total: 45000.5,
    status: "vigente",
    proposal: { account: "Ingreso por producto", code: "401.02*", status: "revisar" },
  },
];

export const EXPENSE_INVOICES: InvoiceRow[] = [
  {
    date: "29 sep 2026",
    party: "Renta Oficina Caribe",
    rfc: "ROC100101AA1",
    folio: "D11A22B3-4455-6677-8899-AABBCCDDEE01",
    total: 95000,
    status: "vigente",
    proposal: { account: "Renta de oficina", code: "601.01*", status: "sugerida" },
  },
  {
    date: "25 sep 2026",
    party: "Combustibles del Sureste",
    rfc: "CDS120202BB2",
    folio: "E22B33C4-5566-7788-9900-BBCCDDEEFF02",
    total: 12450.75,
    status: "vigente",
    proposal: { account: "Gasolina de la operación", code: "601.12*", status: "sugerida" },
  },
  {
    date: "18 sep 2026",
    party: "Café Plaza Maya",
    rfc: "CPM190303CC3",
    folio: "F33C44D5-6677-8899-0011-CCDDEEFF0011",
    total: 1860,
    status: "vigente",
    proposal: { account: "Sin clasificar", status: "revisar" },
  },
];

export const INCOME_GROUPS: GroupItem[] = [
  { name: "Servicios de supervisión", amount: 320000, share: 56, count: 12 },
  { name: "Consultoría", amount: 140000, share: 25, count: 8 },
  { name: "Otros ingresos", amount: 78000, share: 14, count: 4 },
  { name: "Sin clasificar", amount: 33000, share: 5, count: 2, unclassified: true },
];

export const EXPENSE_GROUPS: GroupItem[] = [
  { name: "Renta y servicios", amount: 145000, share: 37, count: 6 },
  { name: "Combustible", amount: 68000, share: 17, count: 12 },
  { name: "Insumos de oficina", amount: 42000, share: 11, count: 8 },
  { name: "Sin clasificar", amount: 134000, share: 35, count: 15, unclassified: true },
];

export const TEAM: TeamMember[] = [
  { name: "Sebastián Reyes", area: "Contable" },
  { name: "Alan Anastasio", area: "Contable" },
  { name: "Jesús García", area: "Legal" },
];

export const CHAT: ChatMessage[] = [
  {
    from: "eq",
    name: "Alan Anastasio",
    area: "Contable",
    time: "Ayer 16:40",
    text: "Ya revisamos tus facturas de septiembre. Dejamos una pregunta sobre la factura de Tulum.",
  },
  {
    from: "yo",
    time: "Ayer 17:02",
    text: "Fue el anticipo de la obra. Te mando el contrato.",
    attachment: "contrato-tulum.pdf",
  },
  {
    from: "eq",
    name: "Jesús García",
    area: "Legal",
    time: "Hoy 09:15",
    text: "Recibido. Lo revisamos y te confirmamos hoy.",
  },
];

export const REQUESTS: RequestItem[] = [
  {
    kind: "factura",
    title: "Factura a Constructora Aldea del Sol por $120,000",
    date: "02 oct 2026",
    detail: "Supervisión de obra, septiembre.",
    step: 1,
  },
  {
    kind: "factura",
    title: "Factura a Grupo Hotelero Costa Maya por $85,000",
    date: "28 sep 2026",
    detail: "Emitida y subida por tu equipo.",
    step: 2,
    folio: "8C1E4A27-5D3B-4F90-A6E2-7B90D1C3F548",
  },
  {
    kind: "recibo",
    title: "Recibo de gasolina, 3 fotos",
    date: "30 sep 2026",
    detail: "Tu contador lo revisa.",
    step: 1,
  },
];

export const INSIGHTS: InsightItem[] = [
  {
    title: "Concentración de ingresos en supervisión de obra",
    detail: "Más de la mitad de lo facturado en septiembre se agrupa así. Tu contador lo anotó tras revisar CFDI y tus confirmaciones.",
    basis: "Origen: seguimiento en kawiil-central · 12 CFDI emitidos",
    followUp: "Revisar mix de clientes para octubre contigo",
    owner: "Ana López · Contable",
    status: "en_seguimiento",
  },
  {
    title: "Café Plaza Maya sin clasificar",
    detail: "Hay varios tickets/CFDI de este proveedor. Falta tu respuesta cerrada para que el equipo registre el gasto igual la próxima vez.",
    basis: "Origen: tarea de seguimiento en central · 6 CFDI recibidos",
    followUp: "Pedirte clasificación (oficina vs comida con cliente)",
    owner: "Ana López · Contable",
    status: "abierto",
  },
  {
    title: "Requerimiento SAT 2025 en revisión",
    detail: "El equipo legal ya abrió el mensaje del buzón y prepara la respuesta. Aquí solo ves el seguimiento, no un feed genérico.",
    basis: "Origen: buzón tributario + nota de seguimiento en central",
    followUp: "Entregar borrador de respuesta en 5 días hábiles",
    owner: "Jesús García · Legal",
    status: "en_seguimiento",
  },
];
