import type { Database } from "@/integrations/supabase/types";

type ServiceArea = Database["public"]["Enums"]["service_area"];

export const SERVICE_LABELS: Record<ServiceArea, string> = {
  contabilidad: "Contabilidad",
  legal: "Legal",
  softlanding: "Soft Landing",
  pld_ft: "PLD/FT",
  juicios: "Juicios",
  gestoria: "Gestoría",
  constitucion_nacional: "Constitución Nacional",
  cumplimiento: "Cumplimiento",
};
