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

/**
 * Registra page_view por ruta y, al cambiar de página, page_exit con duration_ms si estuvo > 2s.
 */
export function useActivityTracker() {
  const { user } = useAuth();
  const location = useLocation();
  const lastPath = useRef<string | null>(null);
  const pathStartMs = useRef<number | null>(null);

  const { data: orgId } = useQuery({
    queryKey: ["activity-tracker-org", user?.id],
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
    if (path === "/login" || path.startsWith("/cambiar-contrasena")) return;

    const prev = lastPath.current;
    const started = pathStartMs.current;

    if (prev && started != null && prev !== path) {
      const duration_ms = Date.now() - started;
      if (duration_ms >= 2000) {
        void logActivity(user.id, orgId, sectionFromPath(prev), "page_exit", {
          path: prev,
          duration_ms,
          kind: "navigation",
        });
      }
    }

    if (path === lastPath.current) return;
    lastPath.current = path;
    pathStartMs.current = Date.now();

    void logActivity(user.id, orgId, sectionFromPath(path), "page_view", {
      path,
      kind: "navigation",
    });
  }, [location.pathname, user?.id, orgId]);
}

/** @deprecated Usa useActivityTracker; se mantiene alias para compatibilidad. */
export const useSectionActivityLogger = useActivityTracker;
