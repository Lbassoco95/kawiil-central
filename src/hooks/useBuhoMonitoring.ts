import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface BuhoExpediente {
  id: string;
  project_id: string;
  buho_id: number | null;
  entidad: string;
  expediente: string;
  juzgado_id: number | null;
  tipo_expediente: string | null;
  nombre: string | null;
  last_synced_at: string | null;
}

export interface BuhoAcuerdo {
  id: string;
  project_id: string;
  expediente: string | null;
  fuente: string | null;
  fecha_acuerdo: string | null;
  tipo_acuerdo: string | null;
  contenido: string | null;
  juzgado: string | null;
  seen: boolean;
  created_at: string;
}

export interface BuhoCatalogItem {
  id: number;
  nombre: string;
  ciudad?: string;
}

interface ProxyResult<T> {
  ok?: boolean;
  success?: boolean;
  data?: T;
  message?: string;
  error?: string;
}

/** Mapea la rama/jurisdicción interna a la `entidad` de Búho. */
export function jurisdictionToEntidad(jurisdiction?: string | null): string | null {
  switch (jurisdiction) {
    case "cdmx":
      return "cdmx";
    case "edomex":
      return "estado_mexico";
    case "federal":
      return "federal";
    default:
      return null;
  }
}

async function callProxy<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("buho-proxy", {
    body: { action, ...params },
  });
  if (error) throw new Error(error.message);
  const res = data as ProxyResult<T>;
  if (res && (res.ok === false || res.success === false)) {
    throw new Error(res.message || res.error || "Error de Búho Legal");
  }
  return (res?.data ?? (res as unknown)) as T;
}

export function useBuhoMonitoring(projectId: string | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Las tablas buho_* se agregan a los tipos generados al aplicar la migración;
  // mientras tanto accedemos vía un cliente sin tipar por tabla.
  const db = supabase as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (col: string, val: unknown) => {
          maybeSingle: () => Promise<{ data: unknown; error: { message: string } | null }>;
          order: (col: string, o: { ascending: boolean }) => Promise<{ data: unknown; error: { message: string } | null }>;
        };
      };
    };
  };

  const linkQuery = useQuery({
    queryKey: ["buho-expediente", projectId],
    queryFn: async () => {
      const { data, error } = await db
        .from("buho_expedientes")
        .select("*")
        .eq("project_id", projectId!)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as BuhoExpediente) ?? null;
    },
    enabled: !!user && !!projectId,
  });

  const acuerdosQuery = useQuery({
    queryKey: ["buho-acuerdos", projectId],
    queryFn: async () => {
      const { data, error } = await db
        .from("buho_acuerdos")
        .select("*")
        .eq("project_id", projectId!)
        .order("fecha_acuerdo", { ascending: false });
      if (error) throw new Error(error.message);
      return (data as BuhoAcuerdo[]) ?? [];
    },
    enabled: !!user && !!projectId && !!linkQuery.data,
  });

  const vincular = useMutation({
    mutationFn: (params: {
      entidad: string;
      expediente: string;
      juzgado_id: number;
      tipo_expediente?: string;
      nombre?: string;
      asunto?: string;
      notas?: string;
    }) => callProxy<BuhoExpediente>("vincular", { project_id: projectId, ...params }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buho-expediente", projectId] });
      toast.success("Expediente vinculado a monitoreo Búho");
    },
    onError: (e: Error) => toast.error("No se pudo vincular: " + e.message),
  });

  const sincronizar = useMutation({
    mutationFn: () => callProxy<BuhoAcuerdo[]>("acuerdos", { project_id: projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buho-acuerdos", projectId] });
      queryClient.invalidateQueries({ queryKey: ["buho-expediente", projectId] });
      toast.success("Acuerdos sincronizados");
    },
    onError: (e: Error) => toast.error("Error al sincronizar: " + e.message),
  });

  const desvincular = useMutation({
    mutationFn: () => callProxy<unknown>("desvincular", { project_id: projectId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buho-expediente", projectId] });
      queryClient.invalidateQueries({ queryKey: ["buho-acuerdos", projectId] });
      toast.success("Monitoreo desvinculado");
    },
    onError: (e: Error) => toast.error("Error: " + e.message),
  });

  const getJuzgados = (entidad: string) => callProxy<BuhoCatalogItem[]>("juzgados", { entidad });

  return {
    link: linkQuery.data ?? null,
    acuerdos: acuerdosQuery.data ?? [],
    isLoading: linkQuery.isLoading,
    vincular,
    sincronizar,
    desvincular,
    getJuzgados,
  };
}
