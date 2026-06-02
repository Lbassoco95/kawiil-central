/** Expediente digital del colaborador — tipos y constantes compartidas. */

export interface EmployeeProfile {
  user_id: string;
  organization_id: string;
  rfc: string | null;
  curp: string | null;
  nss: string | null;
  clabe: string | null;
  bank_name: string | null;
  birth_date: string | null;
  address: string | null;
  postal_code: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  updated_at: string;
}

export type DocStatus = "uploaded" | "verified" | "rejected";

export interface EmployeeDocument {
  id: string;
  organization_id: string;
  user_id: string;
  doc_type: string;
  file_path: string;
  file_name: string | null;
  status: DocStatus;
  note: string | null;
  verified_by: string | null;
  verified_at: string | null;
  uploaded_at: string;
}

/** Documentos del expediente estándar de nómina (todos requeridos). */
export const EXPEDIENTE_DOC_TYPES: { key: string; label: string; hint?: string }[] = [
  { key: "ine", label: "Identificación oficial", hint: "INE o pasaporte vigente" },
  { key: "curp", label: "CURP" },
  { key: "rfc", label: "RFC / Constancia de Situación Fiscal", hint: "CSF reciente del SAT" },
  { key: "nss", label: "Número de Seguridad Social (NSS)", hint: "Constancia del IMSS" },
  { key: "domicilio", label: "Comprobante de domicilio", hint: "No mayor a 3 meses" },
  { key: "clabe", label: "Estado de cuenta / CLABE", hint: "Para depósito de nómina" },
  { key: "acta", label: "Acta de nacimiento" },
  { key: "estudios", label: "Comprobante de estudios", hint: "Certificado, título o cédula" },
];

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  uploaded: "En revisión",
  verified: "Verificado",
  rejected: "Rechazado",
};

export const DOC_STATUS_STYLE: Record<DocStatus, string> = {
  uploaded: "border-amber-300 text-amber-700 dark:text-amber-400",
  verified: "border-emerald-300 text-emerald-700 dark:text-emerald-400",
  rejected: "border-red-300 text-red-700 dark:text-red-400",
};

/** % de avance del expediente según documentos verificados sobre los requeridos. */
export function expedienteProgress(docs: EmployeeDocument[]): {
  uploaded: number;
  verified: number;
  total: number;
  pct: number;
} {
  const total = EXPEDIENTE_DOC_TYPES.length;
  const byType = new Map(docs.map((d) => [d.doc_type, d]));
  let uploaded = 0;
  let verified = 0;
  for (const t of EXPEDIENTE_DOC_TYPES) {
    const d = byType.get(t.key);
    if (!d) continue;
    uploaded += 1;
    if (d.status === "verified") verified += 1;
  }
  return { uploaded, verified, total, pct: total ? Math.round((verified / total) * 100) : 0 };
}
