import type { ChecklistItem } from "@/hooks/useAccountingPeriods";

/**
 * Lista estándar de información y documentos requeridos (intake de socios/cliente).
 *
 * Fuente única de verdad: se usa para precargar el paso de constitución
 * (@/lib/constitutionSteps) y para el botón reutilizable "Insertar checklist de
 * documentos" disponible en cualquier paso o tarea.
 */
export const REQUIRED_DOCUMENTS_CHECKLIST: string[] = [
  // Información personal de cada socio
  "Datos — Nombre completo",
  "Datos — Lugar de nacimiento",
  "Datos — Ocupación",
  "Datos — Estado civil",
  "Datos — Correo electrónico",
  "Datos — Número de contacto",
  // Documentación de cada socio
  "Doc — Acta de nacimiento",
  "Doc — CURP",
  "Doc — Constancia de Situación Fiscal (CSF)",
  "Doc — Identificación oficial vigente (INE o pasaporte)",
  "Doc — Comprobante de domicilio (antigüedad no mayor a 3 meses)",
  "Doc — Acta de matrimonio (solo si es casado)",
  "Doc — Identificación oficial del cónyuge (solo si es casado)",
  // Información de la empresa
  "Empresa — Objeto social o actividad principal (idea breve)",
  "Empresa — Domicilio de la sociedad (CDMX, Edo. Méx., etc.)",
  "Empresa — Participación accionaria de cada socio",
  "Empresa — Estimación de operaciones mensuales",
  "Empresa — Tipo de clientes (B2B / B2C, nacional / internacional)",
  "Empresa — Capital social",
  "Empresa — ¿Admitirán socios extranjeros?",
  "Empresa — Forma de administración (Admin. único o Consejo: Presidente/a y Secretario/a)",
];

/**
 * Construye ítems de checklist (solo para palomear, sin tarea vinculada) a partir
 * de la plantilla de documentos, saltando los que ya existan en `existing` por
 * texto para no duplicar al insertar dos veces.
 * Devuelve solo los ítems NUEVOS a agregar (vacío si ya están todos).
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
