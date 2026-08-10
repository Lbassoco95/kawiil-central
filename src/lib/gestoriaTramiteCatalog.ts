// Catálogo de trámites de gestoría por autoridad: RPC (Registro Público de Comercio),
// COFEPRIS (sanitario) e IMPI (marcas/patentes). Cada trámite define sus fases y los
// pasos de cada fase. Fuente única de verdad para GestoriaDashboard.
//
// Nota: el trámite del SAT (RFC / e.firma) NO se ofrece aquí — pertenece al área de
// Contabilidad. Los proyectos de gestoría existentes con el flujo SAT (guardado sin
// `tramite_type`) siguen mostrándose vía el fallback legacy en el dashboard.

export interface GestoriaPhaseSeed {
  number: number;
  label: string;
}

export interface GestoriaStepSeed {
  key: string;
  label: string;
  description: string;
  icon: string;
  phase: number;
  /** Si true, el paso muestra un campo de fecha/hora de cita. */
  hasAppointment?: boolean;
}

export interface GestoriaTramiteTemplate {
  phases: GestoriaPhaseSeed[];
  steps: GestoriaStepSeed[];
}

export interface CatalogOption {
  value: string;
  label: string;
}

/** Tipos de trámite de gestoría disponibles (para crear un proyecto nuevo). */
export const GESTORIA_TRAMITE_TYPES: CatalogOption[] = [
  { value: "rpc", label: "RPC — Registro Público de Comercio" },
  { value: "cofepris", label: "COFEPRIS — Trámite sanitario" },
  { value: "impi", label: "IMPI — Marcas y patentes" },
];

export const GESTORIA_TRAMITE_LABELS: Record<string, string> = Object.fromEntries(
  GESTORIA_TRAMITE_TYPES.map((t) => [t.value, t.label]),
);

export function getGestoriaTramiteLabel(value?: string | null): string {
  if (!value) return "Gestoría";
  return GESTORIA_TRAMITE_LABELS[value] || value;
}

const step = (
  key: string,
  label: string,
  phase: number,
  description: string,
  icon = "ClipboardList",
  hasAppointment = false,
): GestoriaStepSeed => ({ key, label, description, icon, phase, hasAppointment });

const RPC: GestoriaTramiteTemplate = {
  phases: [
    { number: 1, label: "Documentación y requisitos" },
    { number: 2, label: "Pago de derechos" },
    { number: 3, label: "Ingreso al RPC" },
    { number: 4, label: "Seguimiento / prevenciones" },
    { number: 5, label: "Inscripción y entrega" },
  ],
  steps: [
    step("rpc_instrumento", "Instrumento notarial / acta", 1, "Recopilar el instrumento a inscribir (acta constitutiva, acta de asamblea, poder, etc.).", "FileText"),
    step("rpc_docs", "Documentación soporte", 1, "Identificaciones, comprobante de domicilio y poderes de los otorgantes.", "FileText"),
    step("rpc_derechos", "Cálculo y pago de derechos", 2, "Determinar los derechos registrales y realizar el pago.", "Receipt"),
    step("rpc_ingreso", "Ingreso al Registro Público", 3, "Presentar el instrumento en ventanilla / SIGER y obtener folio de entrada.", "Send"),
    step("rpc_prevenciones", "Atención de prevenciones", 4, "Atender observaciones o prevenciones que emita el registro.", "ClipboardList"),
    step("rpc_inscripcion", "Boleta de inscripción", 5, "Obtener la boleta/constancia de inscripción registral.", "CheckCircle2"),
    step("rpc_entrega", "Entrega al cliente", 5, "Entregar el instrumento inscrito y los acuses al cliente.", "Send"),
  ],
};

const COFEPRIS: GestoriaTramiteTemplate = {
  phases: [
    { number: 1, label: "Documentación y requisitos" },
    { number: 2, label: "Pago de derechos" },
    { number: 3, label: "Ingreso del trámite" },
    { number: 4, label: "Requerimientos / prevenciones" },
    { number: 5, label: "Resolución y entrega" },
  ],
  steps: [
    step("cofepris_expediente", "Integración del expediente técnico", 1, "Reunir la documentación técnica y legal requerida por COFEPRIS para el trámite.", "FileText"),
    step("cofepris_requisitos", "Verificación de requisitos", 1, "Validar que el expediente cumpla los requisitos del trámite específico.", "ClipboardList"),
    step("cofepris_pago", "Línea de captura y pago", 2, "Generar la línea de captura (e5cinco) y realizar el pago de derechos.", "Receipt"),
    step("cofepris_ingreso", "Ingreso del trámite", 3, "Ingresar el trámite (ventanilla / DIGIPRIS) y obtener número de entrada.", "Send"),
    step("cofepris_requerimientos", "Atención de requerimientos", 4, "Atender requerimientos o prevenciones de la autoridad sanitaria.", "ClipboardList"),
    step("cofepris_resolucion", "Resolución / registro sanitario", 5, "Obtener la resolución, aviso, licencia o registro sanitario.", "CheckCircle2"),
    step("cofepris_entrega", "Entrega al cliente", 5, "Entregar la resolución y acuses al cliente.", "Send"),
  ],
};

const IMPI: GestoriaTramiteTemplate = {
  phases: [
    { number: 1, label: "Búsqueda de anterioridades" },
    { number: 2, label: "Documentación y requisitos" },
    { number: 3, label: "Pago de derechos" },
    { number: 4, label: "Presentación de la solicitud" },
    { number: 5, label: "Examen y requerimientos" },
    { number: 6, label: "Registro / título" },
  ],
  steps: [
    step("impi_busqueda", "Búsqueda fonética / figurativa", 1, "Realizar la búsqueda de anterioridades y evaluar la viabilidad del registro.", "ClipboardList"),
    step("impi_datos", "Datos del solicitante y del signo", 2, "Integrar datos del titular, descripción del signo y clase(s) de Niza.", "FileText"),
    step("impi_poder", "Poder / documentación", 2, "Recopilar poder y documentación soporte del solicitante.", "FileText"),
    step("impi_pago", "Pago de tarifa IMPI", 3, "Generar y pagar la tarifa correspondiente ante el IMPI.", "Receipt"),
    step("impi_solicitud", "Presentación de la solicitud", 4, "Ingresar la solicitud (PASE / ventanilla) y obtener número de expediente.", "Send"),
    step("impi_examen", "Examen y oficios", 5, "Atender el examen de forma/fondo y responder oficios o requerimientos.", "ClipboardList"),
    step("impi_titulo", "Título de registro", 6, "Obtener la resolución y el título de registro, y entregarlo al cliente.", "CheckCircle2"),
  ],
};

const TEMPLATES: Record<string, GestoriaTramiteTemplate> = {
  rpc: RPC,
  cofepris: COFEPRIS,
  impi: IMPI,
};

/** Fases legacy del flujo SAT (RFC/e.firma) para gestorías creadas antes del catálogo. */
export const LEGACY_SAT_PHASES: GestoriaPhaseSeed[] = [
  { number: 1, label: "Documentación y requisitos previos" },
  { number: 2, label: "Trámite de RFC" },
  { number: 3, label: "Trámite de e.firma" },
  { number: 4, label: "Entrega" },
];

/** Plantilla completa (fases + pasos) para un tipo de trámite. */
export function getGestoriaTemplate(tramiteType?: string | null): GestoriaTramiteTemplate | null {
  if (!tramiteType) return null;
  return TEMPLATES[tramiteType] ?? null;
}

/** Fases a mostrar: por tipo de trámite, o fallback legacy SAT si no hay tipo. */
export function getGestoriaPhases(tramiteType?: string | null): GestoriaPhaseSeed[] {
  const tpl = getGestoriaTemplate(tramiteType);
  return tpl ? tpl.phases : LEGACY_SAT_PHASES;
}

/** Pasos iniciales (semilla) para un tipo de trámite, listos para persistir. */
export function getGestoriaDefaultSteps(tramiteType: string) {
  const tpl = getGestoriaTemplate(tramiteType);
  if (!tpl) return [];
  return tpl.steps.map((s) => ({
    key: s.key,
    label: s.label,
    description: s.description,
    icon: s.icon,
    phase: s.phase,
    status: "pendiente" as const,
    completed: false,
    completed_at: null,
    completed_by: null,
    notes: "",
    assigned_to: null,
    due_date: null,
    document_ids: [] as string[],
    collaborators: [] as string[],
    ...(s.hasAppointment ? { appointment_date: null } : {}),
  }));
}
