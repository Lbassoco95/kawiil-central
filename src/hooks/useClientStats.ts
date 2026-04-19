import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients, type Client } from "@/hooks/useClients";

export interface ClientStats {
  activos: number | null;
  alCorriente: number | null;
  requierenAtencion: number | null;
  onboarding: number | null;
  ingresosMes: number | null;
  /** Total de clientes activos PM (sub del KPI Activos). */
  activosMorales: number | null;
  /** Total de clientes activos PF (sub del KPI Activos). */
  activosFisicas: number | null;
  /** Cantidad de facturas (sub del KPI Ingresos). */
  facturasEmitidas: number | null;
  /** Lista corta de clientes que requieren atención (para el AI brief). */
  attentionList: Array<{ id: string; name: string; reason: string }>;
  isLoading: boolean;
}

const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * KPIs de la cartera de clientes para el hero v2.4.
 * Cualquier campo `null` significa que la fuente no está disponible (e.g.
 * tabla `savio_invoices` no migrada todavía); el consumidor debe omitir
 * silenciosamente esos stats del render en lugar de mostrar 0.
 */
export function useClientStats(): ClientStats {
  const { user } = useAuth();
  const { data: clients, isLoading: clientsLoading } = useClients();

  // Cuenta de tareas vencidas (no completadas / canceladas) por client_id.
  const overdueByClient = useQuery({
    queryKey: ["client-stats", "overdue-tasks-by-client"],
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const { data, error } = await supabase
        .from("tasks")
        .select("client_id")
        .lt("due_date", nowIso)
        .not("client_id", "is", null)
        .not("status", "in", "(completada,cancelada)");
      if (error) throw error;
      const map = new Map<string, number>();
      for (const row of (data ?? []) as Array<{ client_id: string | null }>) {
        if (!row.client_id) continue;
        map.set(row.client_id, (map.get(row.client_id) ?? 0) + 1);
      }
      return map;
    },
    enabled: !!user,
  });

  // Ingresos del mes desde Savio si la tabla existe; null si no.
  const ingresos = useQuery({
    queryKey: ["client-stats", "ingresos-mes"],
    queryFn: async () => {
      try {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
        const supa = supabase as unknown as {
          from: (t: string) => {
            select: (cols: string) => {
              gte: (col: string, v: string) => {
                lt: (col: string, v: string) => Promise<{
                  data: Array<{ total?: number | null; amount?: number | null }> | null;
                  error: unknown;
                }>;
              };
            };
          };
        };
        const { data, error } = await supa
          .from("savio_invoices")
          .select("total,amount,issued_at")
          .gte("issued_at", start)
          .lt("issued_at", end);
        if (error) return null;
        const list = data ?? [];
        const total = list.reduce(
          (acc, r) => acc + (Number(r.total ?? r.amount ?? 0) || 0),
          0,
        );
        return { total, count: list.length };
      } catch {
        return null;
      }
    },
    enabled: !!user,
    retry: false,
  });

  if (clientsLoading || !clients) {
    return {
      activos: null,
      alCorriente: null,
      requierenAtencion: null,
      onboarding: null,
      ingresosMes: null,
      activosMorales: null,
      activosFisicas: null,
      facturasEmitidas: null,
      attentionList: [],
      isLoading: true,
    };
  }

  const activosArr = clients.filter((c) => c.status === "activo");
  const activos = activosArr.length;
  const activosMorales = activosArr.filter(
    (c) => c.client_type === "persona_moral",
  ).length;
  const activosFisicas = activosArr.filter(
    (c) => c.client_type === "persona_fisica",
  ).length;

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const onboarding = clients.filter((c) => {
    if (c.status === "prospecto") return true;
    if (!c.created_at) return false;
    return new Date(c.created_at).getTime() >= startOfMonth.getTime();
  }).length;

  const overdueMap = overdueByClient.data;
  const now = Date.now();

  let alCorriente: number | null = null;
  let requierenAtencion: number | null = null;
  if (overdueMap) {
    let ok = 0;
    let warn = 0;
    for (const c of activosArr) {
      const overdue = overdueMap.get(c.id) ?? 0;
      const stale =
        c.updated_at &&
        now - new Date(c.updated_at).getTime() > FORTY_FIVE_DAYS_MS;
      const needsAttention = overdue > 0 || stale;
      if (needsAttention) {
        warn += 1;
      } else if (c.savio_customer_id) {
        ok += 1;
      }
    }
    alCorriente = ok;
    requierenAtencion = warn;
  }

  const ingresosData = ingresos.data ?? null;
  const attentionList = listClientsRequiringAttention(activosArr, overdueMap, 4);

  return {
    activos,
    alCorriente,
    requierenAtencion,
    onboarding,
    ingresosMes: ingresosData?.total ?? null,
    activosMorales,
    activosFisicas,
    facturasEmitidas: ingresosData?.count ?? null,
    attentionList,
    isLoading: false,
  };
}

/** Helper para listar clientes que requieren atención (lo usa el AI brief). */
export function listClientsRequiringAttention(
  clients: Client[] | undefined,
  overdueMap: Map<string, number> | undefined,
  limit = 4,
): Array<{ id: string; name: string; reason: string }> {
  if (!clients || !overdueMap) return [];
  const now = Date.now();
  const out: Array<{ id: string; name: string; reason: string }> = [];
  for (const c of clients) {
    if (c.status !== "activo") continue;
    const overdue = overdueMap.get(c.id) ?? 0;
    const stale =
      c.updated_at &&
      now - new Date(c.updated_at).getTime() > FORTY_FIVE_DAYS_MS;
    if (overdue > 0) {
      out.push({
        id: c.id,
        name: c.name,
        reason: `${overdue} tarea${overdue === 1 ? "" : "s"} vencida${overdue === 1 ? "" : "s"}`,
      });
    } else if (stale) {
      out.push({
        id: c.id,
        name: c.name,
        reason: "sin movimiento >45d",
      });
    }
    if (out.length >= limit) break;
  }
  return out;
}
