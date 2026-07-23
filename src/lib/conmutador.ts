// Tipos y helpers de presentación del Conmutador para la UI (F7).
// La lógica de runtime (clasificación, urgencia, folio) vive en las Edge
// Functions (supabase/functions/_shared/conmutador.ts); aquí solo lo que la UI
// necesita para mostrar y editar.

export const CELULA_CODES = ["LIT", "CORP", "COMP", "CONT", "PROC"] as const;
export type CelulaCode = (typeof CELULA_CODES)[number];

export const CELULA_LABELS: Record<CelulaCode, string> = {
  LIT: "Litigio",
  CORP: "Corporativo",
  COMP: "Compliance (PLD-FT)",
  CONT: "Contable/Fiscal",
  PROC: "Procesos internos",
};

export type Urgencia = "urgent" | "medium" | "standard";

export const URGENCIA_LABELS: Record<Urgencia, string> = {
  urgent: "Urgente",
  medium: "Media",
  standard: "Estándar",
};

export function severityEmoji(u: Urgencia): string {
  return u === "urgent" ? "🔴" : u === "medium" ? "🟡" : "🟢";
}

// Variante de <Badge> según urgencia.
export function urgenciaBadgeVariant(u: Urgencia): "destructive" | "secondary" | "outline" {
  return u === "urgent" ? "destructive" : u === "medium" ? "secondary" : "outline";
}

export interface SwitchboardCall {
  id: string;
  organization_id: string;
  folio: string | null;
  celula: CelulaCode | null;
  urgencia: Urgencia;
  llamante: string | null;
  empresa: string | null;
  es_cliente: boolean | null;
  telefono: string | null;
  correo: string | null;
  motivo: string | null;
  ruta: "urgente" | "estandar" | null;
  g4_id: string | null;
  transferido: boolean;
  client_id: string | null;
  cartera_estado: string | null;
  brief: string | null;
  conversation_id: string | null;
  transcript_url: string | null;
  recording_url: string | null;
  followup_task_id: string | null;
  created_at: string;
}

export interface SwitchboardConfig {
  id: string;
  organization_id: string;
  celula: CelulaCode;
  celula_slug: string | null;
  g4_override_user_id: string | null;
  preguntas: string[];
  prompt_override: string | null;
  voz: string | null;
}

export interface G4PorCelula {
  celula: CelulaCode;
  celula_slug: string | null;
  g4_id: string | null;
  g4_nombre: string | null;
  g4_telefono: string | null;
  source: "override" | "rh" | null;
}

export function formatFechaHora(iso: string): string {
  try {
    return new Date(iso).toLocaleString("es-MX", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Normaliza el jsonb de preguntas (puede venir como array o string JSON).
export function parsePreguntas(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}
