import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type CurrentProfile = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  area: string | null;
};

/**
 * Hook ligero que devuelve el perfil del usuario autenticado para usarlo
 * en el shell (saludo, sidebar footer). Cachea 5 minutos.
 */
export function useCurrentProfile() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["current-profile", user?.id],
    queryFn: async (): Promise<CurrentProfile | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name, email, avatar_url, area")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      return (data as CurrentProfile | null) ?? null;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

export function getFirstName(profile: CurrentProfile | null | undefined, fallbackEmail?: string | null): string {
  const full = profile?.full_name?.trim();
  if (full) return full.split(/\s+/)[0];
  const email = profile?.email || fallbackEmail || "";
  if (email) {
    const local = email.split("@")[0];
    if (local) return local.charAt(0).toUpperCase() + local.slice(1);
  }
  return "Kawiiler";
}

export function getInitials(profile: CurrentProfile | null | undefined, fallbackEmail?: string | null): string {
  const full = profile?.full_name?.trim();
  if (full) {
    const parts = full.split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (first + last).toUpperCase() || "K";
  }
  const email = profile?.email || fallbackEmail || "";
  return (email[0] || "K").toUpperCase();
}

export function getGreeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 12) return "Buenos días";
  if (h < 19) return "Buenas tardes";
  return "Buenas noches";
}
