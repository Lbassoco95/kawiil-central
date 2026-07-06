import type { ChecklistItem } from "@/hooks/useAccountingPeriods";

/**
 * Fuente única de verdad de la información y documentos requeridos para
 * constitución. Se usa para:
 *  - precargar el paso 1 (@/lib/constitutionSteps),
 *  - generar el checklist POR SOCIO (registro por socio),
 *  - el botón reutilizable "Insertar checklist de documentos" en cualquier
 *    paso o tarea.
 */

export interface DocDef {
  key: string;
  label: string;
}

/** Un socio/accionista del proyecto de constitución. */
export interface ConstitutionPartner {
  id: string;
  name: string;
  /** Si está casado, aplica documentación adicional del cónyuge. */
  married?: boolean;
}

/** Información personal + documentación que se solicita a CADA socio. */
export const PARTNER_DOCUMENTS: DocDef[] = [
  { key: "nombre", label: "Nombre completo" },
  { key: "lugar_nacimiento", label: "Lugar de nacimiento" },
  { key: "ocupacion", label: "Ocupación" },
  { key: "estado_civil", label: "Estado civil" },
  { key: "correo", label: "Correo electrónico" },
  { key: "contacto", label: "Número de contacto" },
  { key: "acta_nacimiento", label: "Acta de nacimiento" },
  { key: "curp", label: "CURP" },
  { key: "csf", label: "Constancia de Situación Fiscal (CSF)" },
  { key: "identificacion", label: "Identificación oficial vigente (INE o pasaporte)" },
  { key: "comprobante_domicilio", label: "Comprobante de domicilio (antigüedad no mayor a 3 meses)" },
];

/** Documentación adicional que aplica solo si el socio está casado. */
export const PARTNER_MARRIED_DOCUMENTS: DocDef[] = [
  { key: "acta_matrimonio", label: "Acta de matrimonio" },
  { key: "id_conyuge", label: "Identificación oficial del cónyuge" },
];

/** Información a nivel empresa (se captura una sola vez, no por socio). */
export const COMPANY_INFO: DocDef[] = [
  { key: "objeto_social", label: "Objeto social o actividad principal (idea breve)" },
  { key: "domicilio", label: "Domicilio de la sociedad (CDMX, Edo. Méx., etc.)" },
  { key: "participacion", label: "Participación accionaria de cada socio" },
  { key: "operaciones", label: "Estimación de operaciones mensuales" },
  { key: "tipo_clientes", label: "Tipo de clientes (B2B / B2C, nacional / internacional)" },
  { key: "capital", label: "Capital social" },
  { key: "socios_extranjeros", label: "¿Admitirán socios extranjeros?" },
  { key: "administracion", label: "Forma de administración (Admin. único o Consejo: Presidente/a y Secretario/a)" },
];

/**
 * Lista plana (texto) de todos los documentos requeridos. La usa el botón
 * reutilizable "Insertar checklist de documentos" en pasos/tareas genéricas.
 */
export const REQUIRED_DOCUMENTS_CHECKLIST: string[] = [
  ...PARTNER_DOCUMENTS.map((d) => `Socio — ${d.label}`),
  ...PARTNER_MARRIED_DOCUMENTS.map((d) => `Socio (si es casado) — ${d.label}`),
  ...COMPANY_INFO.map((c) => `Empresa — ${c.label}`),
];

const EMPRESA_PREFIX = "empresa::";
const SOCIO_PREFIX = "socio::";

/** Ítems de checklist de la información de empresa (ids estables `empresa::<key>`). */
export function buildCompanyInfoItems(prevCompleted: Map<string, boolean> = new Map()): ChecklistItem[] {
  return COMPANY_INFO.map((c) => {
    const id = `${EMPRESA_PREFIX}${c.key}`;
    return { id, text: `Empresa — ${c.label}`, completed: !!prevCompleted.get(id), assigned_to: null, due_date: null, task_id: null };
  });
}

/**
 * Genera el checklist del paso "Recopilación de documentación de socios" a
 * partir de la lista de socios: un bloque de documentos por socio (con su
 * nombre) + la información de empresa (una vez). Conserva el estado de
 * palomeado de los ítems que ya existían (por id estable) y respeta los ítems
 * personalizados que el usuario haya agregado a mano.
 */
export function buildSociosChecklist(
  socios: ConstitutionPartner[],
  existing: ChecklistItem[] = [],
): ChecklistItem[] {
  const prevCompleted = new Map(existing.map((i) => [i.id, i.completed]));

  const socioItems: ChecklistItem[] = socios.flatMap((socio) => {
    const docs = [...PARTNER_DOCUMENTS, ...(socio.married ? PARTNER_MARRIED_DOCUMENTS : [])];
    return docs.map((d) => {
      const id = `${SOCIO_PREFIX}${socio.id}::${d.key}`;
      return {
        id,
        text: `${socio.name?.trim() || "Socio"} — ${d.label}`,
        completed: !!prevCompleted.get(id),
        assigned_to: null,
        due_date: null,
        task_id: null,
      };
    });
  });

  const companyItems = buildCompanyInfoItems(prevCompleted);

  // Conservar ítems personalizados (no generados por socio/empresa ni por la
  // semilla plana anterior `documentacion_socios::N`, que se migra al modelo
  // por socio).
  const custom = existing.filter(
    (i) =>
      !i.id.startsWith(SOCIO_PREFIX) &&
      !i.id.startsWith(EMPRESA_PREFIX) &&
      !i.id.startsWith("documentacion_socios::"),
  );

  return [...socioItems, ...companyItems, ...custom];
}

/** Progreso de documentos de un socio específico dentro del checklist. */
export function partnerDocProgress(
  socio: ConstitutionPartner,
  checklist: ChecklistItem[] = [],
): { completed: number; total: number } {
  const prefix = `${SOCIO_PREFIX}${socio.id}::`;
  const items = checklist.filter((i) => i.id.startsWith(prefix));
  return { completed: items.filter((i) => i.completed).length, total: items.length };
}

/**
 * Construye ítems de checklist (solo para palomear, sin tarea vinculada) a partir
 * de la plantilla plana de documentos, saltando los que ya existan por texto para
 * no duplicar. Devuelve solo los ítems NUEVOS a agregar.
 */
export function buildDocumentChecklistAdditions(
  existing: ChecklistItem[] = [],
  assignedTo: string | null = null,
  idSeed = 0,
): ChecklistItem[] {
  const existingTexts = new Set(existing.map((c) => (c.text || "").trim().toLowerCase()));
  return REQUIRED_DOCUMENTS_CHECKLIST.filter(
    (text) => !existingTexts.has(text.trim().toLowerCase()),
  ).map((text, i) => ({
    id: `doc-${idSeed}-${i}`,
    text,
    completed: false,
    assigned_to: assignedTo,
    due_date: null,
    task_id: null,
  }));
}
