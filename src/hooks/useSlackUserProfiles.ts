import { useQuery } from "@tanstack/react-query";
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

export function useSlackUserProfiles(userIds: (string | undefined)[]) {
  const unique = [...new Set(userIds.filter((x): x is string => !!x && x.length > 0))].sort();
  const capped = unique.slice(0, SLACK_USER_PROFILES_MAX_TOTAL);
  const key = capped.join(",");

  return useQuery({
    queryKey: ["slack-user-profiles", key],
    queryFn: async () => {
      if (capped.length === 0) return {} as Record<string, SlackUserProfile>;
      try {
        const merged: Record<string, SlackUserProfile> = {};
        for (let i = 0; i < capped.length; i += SLACK_USER_PROFILES_BATCH) {
          const chunk = capped.slice(i, i + SLACK_USER_PROFILES_BATCH);
          const data = await invokeSlackApi<{
            ok?: boolean;
            users?: Record<string, SlackUserProfile>;
          }>(
            {
              action: "users.info.batch",
              user_ids: chunk,
            },
            { timeoutMs: 55_000 },
          );
          if (data.ok && data.users) {
            Object.assign(merged, data.users);
          }
        }
        return merged;
      } catch {
        return {};
      }
    },
    enabled: capped.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
