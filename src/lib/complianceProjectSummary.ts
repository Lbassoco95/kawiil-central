/** Filas compatibles con el select de client_compliance_config + compliance_entity_types */
export interface ComplianceConfigSummaryRow {
  registration_number: string | null;
  authorization_date: string | null;
  compliance_officer_name: string | null;
  compliance_entity_types?: { name: string; code: string; group_name: string } | null;
}

export function formatComplianceRegDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return iso;
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

/**
 * Texto para `projects.description` (visible en la cabecera del proyecto).
 */
export function buildComplianceProjectDescription(
  clientName: string,
  configs: ComplianceConfigSummaryRow[],
): string {
  if (!configs.length) {
    return [
      `${clientName} — Cumplimiento regulatorio.`,
      "",
      "Configura los tipos de entidad y el folio en la ficha del cliente (pestaña Cumplimiento).",
      "Después genera las tareas desde el panel de este proyecto o documenta obligaciones adicionales como tareas.",
    ].join("\n");
  }

  const lines: string[] = [
    `${clientName} — Alcance de cumplimiento regulatorio`,
    "",
    "Tipos de entidad:",
  ];

  for (const c of configs) {
    const et = c.compliance_entity_types;
    lines.push(et ? `• ${et.name} — ${et.group_name}` : "• (sin tipo asignado)");
  }

  const ref = configs[0];
  lines.push(
    "",
    "Referencia de registro:",
    `• Folio / registro: ${ref.registration_number?.trim() || "—"}`,
    `• Autorización / inicio: ${formatComplianceRegDate(ref.authorization_date)}`,
    `• Responsable en el cliente: ${ref.compliance_officer_name?.trim() || "—"}`,
    "",
    "Las tareas periódicas se arman desde plantillas por tipo de entidad. Si tu calendario oficial difiere, añade tareas manualmente o documenta criterios en adjuntos.",
  );

  return lines.join("\n");
}

/**
 * Bloque corto para añadir al final de la descripción de cada tarea generada.
 */
export function buildComplianceTaskDescriptionSuffix(configs: ComplianceConfigSummaryRow[]): string {
  if (!configs.length) return "";

  const typeLabels = configs
    .map((c) => c.compliance_entity_types?.name)
    .filter((n): n is string => Boolean(n && n.trim()));

  const ref = configs[0];
  const parts: string[] = [];
  if (typeLabels.length) parts.push(`Entidad: ${typeLabels.join(", ")}.`);
  if (ref.registration_number?.trim()) parts.push(`Folio: ${ref.registration_number.trim()}.`);
  if (ref.authorization_date) parts.push(`Autorización: ${formatComplianceRegDate(ref.authorization_date)}.`);
  if (ref.compliance_officer_name?.trim()) parts.push(`Oficial en cliente: ${ref.compliance_officer_name.trim()}.`);

  if (!parts.length) return "";
  return `\n\n——\nContexto regulatorio: ${parts.join(" ")}`;
}
