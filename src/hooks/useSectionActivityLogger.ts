import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activityLog";

function sectionFromPath(pathname: string): string {
  const seg = pathname.replace(/^\//, "").split("/")[0] || "inicio";
  if (!seg || seg === "") return "inicio";
  return seg;
}

export function useSectionActivityLogger() {
  const { user } = useAuth();
  const location = useLocation();
  const lastPath = useRef<string | null>(null);

  const { data: orgId } = useQuery({
    queryKey: ["logger-org", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data?.organization_id as string | null;
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (!user?.id || !orgId) return;
    const path = location.pathname;
    if (path === lastPath.current) return;
    lastPath.current = path;
    if (path === "/login" || path.startsWith("/cambiar-contrasena")) return;
    const section = sectionFromPath(path);
    void logActivity(user.id, orgId, section, "view", { path });
  }, [location.pathname, user?.id, orgId]);
}
