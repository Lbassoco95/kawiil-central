import type { AccountingStep, ChecklistItem } from "@/hooks/useAccountingPeriods";
import { REQUIRED_DOCUMENTS_CHECKLIST } from "@/lib/documentChecklist";

/**
 * Fuente única de verdad para los pasos del proceso de Constitución
 * (constitución nacional y softlanding).
 *
 * Se usa tanto para inicializar proyectos nuevos (plantilla) como para
 * reconciliar proyectos YA creados: al abrir el tablero se insertan los
 * pasos/checklists faltantes sin borrar el progreso capturado.
 */
export interface ConstitutionStep extends AccountingStep {
  description: string;
  icon: string;
  status: "pendiente" | "en_progreso" | "completado";
  conditional?: boolean;
  appointment_date?: string | null;
}

/**
 * Construye ítems de checklist con ids estables por paso.
 * El id estable (`${stepKey}::${índice}`) permite reconciliar sin duplicar:
 * si el ítem ya existe en el proyecto se conserva, y solo se agregan los
 * nuevos definidos en la plantilla.
 */
function seedChecklist(stepKey: string, items: string[], assignedTo: string | null): ChecklistItem[] {
  return items.map((text, i) => ({
    id: `${stepKey}::${i}`,
    text,
    completed: false,
    assigned_to: assignedTo,
    due_date: null,
    task_id: null,
  }));
}

/**
 * Checklist de intake (info + documentación) que se precarga en el paso 1.
 * Reutiliza la fuente única de documentos requeridos.
 */
const DOCUMENTACION_SOCIOS_CHECKLIST = REQUIRED_DOCUMENTS_CHECKLIST;

/** Checklist del nuevo paso de solicitud de denominación / razón social. */
const DENOMINACION_CHECKLIST = [
  "Opción 1 de denominación / razón social",
  "Opción 2 de denominación / razón social",
  "Opción 3 de denominación / razón social",
  "Solicitud de autorización de uso enviada a la SRE (Secretaría de Economía)",
  "Autorización de uso de denominación recibida",
];

/**
 * Plantilla ordenada de pasos de constitución. El orden de este arreglo es
 * la fuente de verdad para la reconciliación (posición del nuevo paso, etc.).
 */
export function buildDefaultConstitutionSteps(responsibleId: string | null): ConstitutionStep[] {
  const base = (
    key: string,
    label: string,
    description: string,
    icon: string,
    extra: Partial<ConstitutionStep> = {},
  ): ConstitutionStep => ({
    key,
    label,
    description,
    icon,
    status: "pendiente",
    completed: false,
    completed_at: null,
    completed_by: null,
    notes: "",
    assigned_to: responsibleId,
    due_date: null,
    document_ids: [],
    collaborators: [],
    checklist: [],
    ...extra,
  });

  return [
    base(
      "documentacion_socios",
      "Recopilación de documentación de socios",
      "Integrar documentos de identidad, poderes y datos de los socios/accionistas, así como la información de la empresa.",
      "FileText",
      { checklist: seedChecklist("documentacion_socios", DOCUMENTACION_SOCIOS_CHECKLIST, responsibleId) },
    ),
    base(
      "denominacion_social",
      "Solicitud de denominación / razón social (SRE)",
      "Solicitar la autorización de uso de denominación o razón social ante la Secretaría de Economía (SRE), con las 3 opciones propuestas por el cliente.",
      "Stamp",
      { checklist: seedChecklist("denominacion_social", DENOMINACION_CHECKLIST, responsibleId) },
    ),
    base(
      "envio_notaria",
      "Envío de información a notaría",
      "Enviar la documentación completa de socios a la notaría.",
      "Building2",
    ),
    base(
      "proyecto_constitucion",
      "Proyecto de constitución",
      "La notaría prepara el proyecto de acta constitutiva para revisión.",
      "Stamp",
    ),
    base(
      "firma_socios",
      "Firma de socios",
      "Los socios firman el acta constitutiva ante notario.",
      "PenLine",
    ),
    base(
      "contratacion_linea",
      "Contratación de línea telefónica",
      "Contratar línea telefónica a nombre de la empresa para comprobante de domicilio.",
      "Phone",
    ),
    base(
      "recibo_comprobante",
      "Comprobante de domicilio generado",
      "Verificar que ya se generó el recibo de la línea contratada.",
      "Home",
    ),
    base(
      "cita_rfc",
      "Agendar cita ante el SAT (RFC)",
      "El gestor solicita cita en el SAT para la inscripción al RFC.",
      "CalendarClock",
      { appointment_date: null },
    ),
    base(
      "obtencion_rfc",
      "Obtención del RFC",
      "Acudir a la cita y completar la inscripción al RFC.",
      "Receipt",
    ),
    base(
      "cita_efirma",
      "Agendar cita ante el SAT (e.firma)",
      "El gestor solicita cita para obtener la firma electrónica.",
      "CalendarClock",
      { appointment_date: null },
    ),
    base(
      "firma_electronica",
      "Obtención de e.firma (FIEL)",
      "Acudir a la cita y completar el trámite de firma electrónica avanzada.",
      "KeyRound",
    ),
    base(
      "cuenta_bancaria",
      "Alta de cuenta bancaria",
      "Apertura de cuenta bancaria corporativa.",
      "Landmark",
    ),
    base(
      "registro_rpc",
      "Registro ante el RPC (boleta)",
      "Inscripción en el Registro Público de Comercio.",
      "BookOpen",
    ),
    base(
      "inscripcion_rnie",
      "Inscripción al RNIE",
      "Registro Nacional de Inversiones Extranjeras (socios extranjeros).",
      "Globe",
      { conditional: true },
    ),
  ];
}

/**
 * Reconcilia los pasos de un proyecto YA creado contra la plantilla vigente:
 * - Inserta pasos faltantes (p. ej. `denominacion_social`) en su posición.
 * - Precarga el checklist de plantilla en un paso que aún no tenga checklist.
 * - Agrega ítems de checklist de plantilla que falten, sin tocar los existentes.
 * - Conserva todo el progreso, asignaciones, notas, documentos y pasos custom.
 * Devuelve `changed: true` solo si hubo alguna diferencia que persistir.
 */
export function reconcileConstitutionSteps(
  existing: ConstitutionStep[] | undefined | null,
  responsibleId: string | null,
): { steps: ConstitutionStep[]; changed: boolean } {
  const defaults = buildDefaultConstitutionSteps(responsibleId);
  const existingList = existing ?? [];
  const existingByKey = new Map(existingList.map((s) => [s.key, s]));
  let changed = false;

  const merged: ConstitutionStep[] = defaults.map((def) => {
    const cur = existingByKey.get(def.key);
    if (!cur) {
      changed = true;
      return def;
    }
    existingByKey.delete(def.key);

    let next = cur;
    const defChecklist = def.checklist ?? [];
    if (defChecklist.length > 0) {
      const curChecklist = cur.checklist ?? [];
      const curIds = new Set(curChecklist.map((c) => c.id));
      const missing = defChecklist.filter((c) => !curIds.has(c.id));
      if (missing.length > 0) {
        next = { ...cur, checklist: [...curChecklist, ...missing] };
        changed = true;
      }
    }
    return next;
  });

  // Conservar cualquier paso personalizado que no esté en la plantilla.
  for (const leftover of existingList) {
    if (existingByKey.has(leftover.key)) {
      merged.push(leftover);
    }
  }

  // Detectar reordenamiento (p. ej. inserción del nuevo paso).
  const existingKeys = existingList.map((s) => s.key).join("|");
  const mergedKeys = merged.map((s) => s.key).join("|");
  if (existingKeys !== mergedKeys) changed = true;

  return { steps: merged, changed };
}
