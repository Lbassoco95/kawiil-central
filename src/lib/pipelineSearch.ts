import type { Lead } from "@/hooks/usePipeline";

/** Búsqueda global del pipeline (tablero + lista): contacto, empresa, email, campaña. */
export function leadMatchesPipelineSearch(l: Lead, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (
    (l.full_name || "").toLowerCase().includes(s) ||
    (l.email || "").toLowerCase().includes(s) ||
    (l.company_name || "").toLowerCase().includes(s) ||
    (l.campaign_name || "").toLowerCase().includes(s)
  );
}
