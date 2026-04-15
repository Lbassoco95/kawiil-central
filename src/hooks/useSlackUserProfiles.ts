import { useQuery } from "@tanstack/react-query";
import { invokeSlackApi } from "@/lib/slackApi";

export type SlackUserProfile = {
  display_name: string | null;
  real_name: string | null;
  avatar_url: string | null;
};

/** Resuelve nombres y avatares de usuarios Slack (batch vía Edge). */
const SLACK_USER_PROFILES_MAX_IDS = 150;

export function useSlackUserProfiles(userIds: (string | undefined)[]) {
  const unique = [...new Set(userIds.filter((x): x is string => !!x && x.length > 0))].sort();
  const capped = unique.slice(0, SLACK_USER_PROFILES_MAX_IDS);
  const key = capped.join(",");

  return useQuery({
    queryKey: ["slack-user-profiles", key],
    queryFn: async () => {
      if (capped.length === 0) return {} as Record<string, SlackUserProfile>;
      try {
        const data = await invokeSlackApi<{
          ok?: boolean;
          users?: Record<string, SlackUserProfile>;
        }>({
          action: "users.info.batch",
          user_ids: capped,
        });
        if (!data.ok) return {};
        return data.users || {};
      } catch {
        return {};
      }
    },
    enabled: capped.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
