import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Cobertura SAT (Moffin) para el dashboard de Conocimiento.
 *
 * "Con acceso a CSF/32D" = cliente activo con al menos un proyecto de contabilidad
 * o softlanding no cancelado (la descarga mensual automática cubre justo a esos).
 * Por mes se marca si la CSF y la opinión 32D quedaron en `success`.
 */

export type SatCoverageClient = {
  clientId: string;
  name: string;
  responsibleUserId: string | null;
  responsibleName: string | null;
  hasCiec: boolean;
  csfDownloaded: boolean;
  opinionDownloaded: boolean;
};

export type SatCoverageData = {
  clients: SatCoverageClient[];
  totals: {
    withAccess: number;
    withResponsible: number;
    withCiec: number;
    withoutCiec: number;
    csfDownloaded: number;
    opinionDownloaded: number;
  };
};

const SAT_PROJECT_AREAS = ["contabilidad", "softlanding"];

function monthRangeIso(year: number, month0: number): { start: string; end: string } {
  // month0: 0-11. Rango [primer día del mes, primer día del mes siguiente).
  const start = new Date(Date.UTC(year, month0, 1)).toISOString();
  const end = new Date(Date.UTC(year, month0 + 1, 1)).toISOString();
  return { start, end };
}

export function useSatCoverage(year: number, month0: number) {
  const { user } = useAuth();
  return useQuery<SatCoverageData>({
    queryKey: ["sat-coverage", year, month0],
    enabled: !!user,
    queryFn: async () => {
      const { start, end } = monthRangeIso(year, month0);

      const [clientsRes, projectsRes, ciecRes, consultsRes, profilesRes] = await Promise.all([
        supabase.from("clients").select("id, name, responsible_user_id").eq("status", "activo"),
        supabase.from("projects").select("client_id, area, status"),
        supabase.from("moffin_client_sat_ciec").select("client_id, ciec_ciphertext"),
        supabase
          .from("moffin_consults")
          .select("client_id, consult_type, status, created_at")
          .in("consult_type", ["constancia_situacion_fiscal", "opinion_cumplimiento"])
          .eq("status", "success")
          .gte("created_at", start)
          .lt("created_at", end),
        supabase.from("profiles").select("id, full_name"),
      ]);

      if (clientsRes.error) throw clientsRes.error;
      if (projectsRes.error) throw projectsRes.error;
      if (ciecRes.error) throw ciecRes.error;
      if (consultsRes.error) throw consultsRes.error;
      if (profilesRes.error) throw profilesRes.error;

      // Clientes con proyecto de contabilidad/softlanding no cancelado → con acceso a SAT.
      const accessClientIds = new Set<string>();
      for (const p of projectsRes.data ?? []) {
        const area = (p as { area: string | null }).area ?? "";
        const status = (p as { status: string | null }).status ?? "";
        const clientId = (p as { client_id: string | null }).client_id;
        if (clientId && SAT_PROJECT_AREAS.includes(area) && status !== "cancelado") {
          accessClientIds.add(clientId);
        }
      }

      const ciecClientIds = new Set(
        (ciecRes.data ?? [])
          .filter((r) => !!(r as { ciec_ciphertext: string | null }).ciec_ciphertext)
          .map((r) => (r as { client_id: string }).client_id),
      );

      const csfClientIds = new Set<string>();
      const opinionClientIds = new Set<string>();
      for (const c of consultsRes.data ?? []) {
        const clientId = (c as { client_id: string | null }).client_id;
        const type = (c as { consult_type: string }).consult_type;
        if (!clientId) continue;
        if (type === "constancia_situacion_fiscal") csfClientIds.add(clientId);
        else if (type === "opinion_cumplimiento") opinionClientIds.add(clientId);
      }

      const profileName = new Map<string, string>();
      for (const p of profilesRes.data ?? []) {
        const id = (p as { id: string }).id;
        const name = (p as { full_name: string | null }).full_name;
        if (id && name) profileName.set(id, name);
      }

      const clients: SatCoverageClient[] = (clientsRes.data ?? [])
        .filter((c) => accessClientIds.has((c as { id: string }).id))
        .map((c) => {
          const clientId = (c as { id: string }).id;
          const responsibleUserId = (c as { responsible_user_id: string | null }).responsible_user_id;
          return {
            clientId,
            name: (c as { name: string }).name,
            responsibleUserId,
            responsibleName: responsibleUserId ? profileName.get(responsibleUserId) ?? null : null,
            hasCiec: ciecClientIds.has(clientId),
            csfDownloaded: csfClientIds.has(clientId),
            opinionDownloaded: opinionClientIds.has(clientId),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, "es"));

      const totals = {
        withAccess: clients.length,
        withResponsible: clients.filter((c) => !!c.responsibleUserId).length,
        withCiec: clients.filter((c) => c.hasCiec).length,
        withoutCiec: clients.filter((c) => !c.hasCiec).length,
        csfDownloaded: clients.filter((c) => c.csfDownloaded).length,
        opinionDownloaded: clients.filter((c) => c.opinionDownloaded).length,
      };

      return { clients, totals };
    },
  });
}
