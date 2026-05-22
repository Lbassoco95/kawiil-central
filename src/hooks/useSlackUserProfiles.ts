import { useQuery, useQueryClient } from "@tanstack/react-query";
import { invokeSlackApi } from "@/lib/slackApi";

export type SlackUserProfile = {
  display_name: string | null;
  real_name: string | null;
  avatar_url: string | null;
};

/** Máximo por petición `users.info.batch` en la Edge (slack-api). */
const SLACK_USER_PROFILES_BATCH = 200;
/** Tope de ids por vista para no disparar demasiadas llamadas; 3 batches típicos. */
const SLACK_USER_PROFILES_MAX_TOTAL = 600;

/**
 * Devuelve un mapa id→perfil para los IDs solicitados.
 *
 * Estrategia de caché incremental:
 * - Cada perfil individual se almacena en queryKey ["slack-user-profile", id].
 * - En el queryFn solo se piden a la Edge los IDs que aún no están en caché.
 * - La queryKey del hook usa el conjunto de IDs *nuevos* para que React Query
 *   no re-ejecute cuando todos los perfiles ya están disponibles.
 */
export function useSlackUserProfiles(userIds: (string | undefined)[]) {
  const qc = useQueryClient();

  const unique = [...new Set(userIds.filter((x): x is string => !!x && x.length > 0))].sort();
  const capped = unique.slice(0, SLACK_USER_PROFILES_MAX_TOTAL);

  // IDs que aún no tienen perfil en caché — determinan si hay que hacer fetch
  const uncached = capped.filter((id) => !qc.getQueryData<SlackUserProfile>(["slack-user-profile", id]));
  const uncachedKey = uncached.join(",");

  const query = useQuery({
    queryKey: ["slack-user-profiles-batch", uncachedKey],
    queryFn: async () => {
      if (uncached.length === 0) return {};
      try {
        for (let i = 0; i < uncached.length; i += SLACK_USER_PROFILES_BATCH) {
          const chunk = uncached.slice(i, i + SLACK_USER_PROFILES_BATCH);
          const data = await invokeSlackApi<{
            ok?: boolean;
            users?: Record<string, SlackUserProfile>;
          }>(
            { action: "users.info.batch", user_ids: chunk },
            { timeoutMs: 55_000 },
          );
          if (data.ok && data.users) {
            // Almacenar cada perfil individualmente para reutilización futura
            for (const [id, profile] of Object.entries(data.users)) {
              qc.setQueryData(["slack-user-profile", id], profile);
            }
          }
        }
      } catch {
        // devolver lo que haya en caché aunque el fetch falle
      }
      // Reconstruir mapa completo desde caché individual
      return buildMapFromCache(capped, qc);
    },
    enabled: uncached.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  // Combinar resultado del fetch con perfiles ya en caché para los IDs solicitados
  const merged = buildMapFromCache(capped, qc);

  return {
    ...query,
    data: Object.keys(merged).length > 0 ? merged : (query.data ?? {}),
  };
}

function buildMapFromCache(
  ids: string[],
  qc: ReturnType<typeof useQueryClient>,
): Record<string, SlackUserProfile> {
  const out: Record<string, SlackUserProfile> = {};
  for (const id of ids) {
    const p = qc.getQueryData<SlackUserProfile>(["slack-user-profile", id]);
    if (p) out[id] = p;
  }
  return out;
}
