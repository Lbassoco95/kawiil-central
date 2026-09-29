/**
 * Sesión del portal: cuenta, clientes y cliente activo. El cliente activo es
 * solo una preferencia de pantalla; el permiso real lo aplica la base.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { db } from "./supabase";
import { callApi } from "./api";

export interface PortalClient {
  client_id: string;
  client_name: string;
  rfc: string | null;
  role: "administrador" | "operativo" | "consulta";
  emission_enabled: boolean;
  origin: "kawiil" | "basico";
  tickets_enabled: boolean;
}
export interface PortalMe {
  is_portal_account: boolean;
  user_id?: string;
  email?: string;
  full_name?: string | null;
  status?: "pendiente" | "activa" | "suspendida";
  tier?: "premier" | "basico" | null;
  clients?: PortalClient[];
  pending_legal?: { kind: string; version: string; title: string }[];
}

interface Ctx {
  session: Session | null;
  loading: boolean;
  me: PortalMe | null;
  active: PortalClient | null;
  setActive: (clientId: string) => void;
  refresh: () => Promise<void>;
}

const SessionCtx = createContext<Ctx | null>(null);
const ACTIVE_KEY = "kawiil-portal-cliente-activo";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<PortalMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(() => {
    try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
  });

  const refresh = useCallback(async () => {
    setMe(await callApi<PortalMe>("sesion.actual").catch(() => null));
  }, []);

  useEffect(() => {
    db.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await refresh();
      setLoading(false);
    });
    const { data: sub } = db.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (s && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED")) {
        void refresh();
        if (event === "SIGNED_IN") void callApi("sesion.registrar_acceso");
      }
      if (!s) setMe(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [refresh]);

  const active = useMemo(() => {
    const list = me?.clients ?? [];
    return list.find((c) => c.client_id === activeId) ?? list[0] ?? null;
  }, [me, activeId]);

  const setActive = (id: string) => {
    setActiveId(id);
    try { localStorage.setItem(ACTIVE_KEY, id); } catch { /* sin almacenamiento */ }
  };

  return <SessionCtx.Provider value={{ session, loading, me, active, setActive, refresh }}>{children}</SessionCtx.Provider>;
}

export function usePortal() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("usePortal fuera de SessionProvider");
  return c;
}
