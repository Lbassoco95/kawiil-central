import type { Client } from "@/hooks/useClients";

const SERVICE_LABELS: Record<string, string> = {
  contabilidad: "Contabilidad",
  nomina: "Nómina",
  legal: "Legal",
  pld_ft: "PLD/FT",
  cumplimiento: "Cumplimiento",
  softlanding: "Softlanding",
  constitucion_nacional: "Constitución Nacional",
  gestoria: "Gestoría",
  representacion: "Representación",
};

const STATUS_LABELS: Record<string, string> = {
  activo: "Activo",
  inactivo: "Inactivo",
  prospecto: "Prospecto",
};

const TYPE_LABELS: Record<string, string> = {
  persona_moral: "Persona Moral",
  persona_fisica: "Persona Física",
};

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes(";")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function defaultFilename(): string {
  const d = new Date();
  return `clientes-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.csv`;
}

/**
 * Exporta una lista de clientes como CSV (UTF-8 con BOM para Excel) y dispara
 * la descarga en el navegador. Sin dependencias de Storage ni edge functions.
 */
export function exportClientsCsv(clients: Client[], filename?: string): void {
  const headers = [
    "Nombre",
    "RFC",
    "Tipo",
    "Estado",
    "Email",
    "Teléfono",
    "Área principal",
    "Servicios",
    "Savio",
    "Creado",
  ];
  const rows = clients.map((c) => [
    c.name,
    c.rfc ?? "",
    TYPE_LABELS[c.client_type] ?? c.client_type,
    STATUS_LABELS[c.status] ?? c.status,
    c.email ?? "",
    c.phone ?? "",
    c.primary_area ?? "",
    (c.services ?? [])
      .map((s) => SERVICE_LABELS[s] ?? s)
      .join(" · "),
    c.savio_customer_id ? "Sí" : "No",
    c.created_at ? c.created_at.slice(0, 10) : "",
  ]);

  const lines = [headers, ...rows]
    .map((row) => row.map(csvEscape).join(","))
    .join("\n");

  const blob = new Blob(["\ufeff" + lines], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? defaultFilename();
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
