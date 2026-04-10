import { useQuery } from "@tanstack/react-query";
import { invokeSlackApi } from "@/lib/slackApi";

export type SlackUserProfile = {
  display_name: string | null;
  real_name: string | null;
  avatar_url: string | null;
};

/** Resuelve nombres y avatares de usuarios Slack (batch vía Edge). */
export function useSlackUserProfiles(userIds: (string | undefined)[]) {
  const unique = [...new Set(userIds.filter((x): x is string => !!x && x.length > 0))].sort();
  const key = unique.join(",");

  return useQuery({
    queryKey: ["slack-user-profiles", key],
    queryFn: async () => {
      if (unique.length === 0) return {} as Record<string, SlackUserProfile>;
      try {
        const data = await invokeSlackApi<{
          ok?: boolean;
          users?: Record<string, SlackUserProfile>;
        }>({
          action: "users.info.batch",
          user_ids: unique,
        });
        if (!data.ok) return {};
        return data.users || {};
      } catch {
        return {};
      }
    },
    enabled: unique.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}
