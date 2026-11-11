import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Carpetas de clientes en Dropbox (las mismas que ve Kawiil Central), para elegir a cuál se acota un agente. Solo carpetas, con su id.
export const CARPETA_CLIENTES = "/Kawiil Mx/CLIENTES";
export interface CarpetaCliente { id: string; nombre: string }

export const carpetasDeRespuesta = (data: unknown): CarpetaCliente[] => {
  const lista = (data as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(lista)) return [];
  const out: CarpetaCliente[] = [];
  for (const e of lista) {
    const x = (e && typeof e === "object" ? e : {}) as Record<string, unknown>;
    if (x.type !== "folder" || typeof x.id !== "string" || !/^id:[A-Za-z0-9_-]{5,200}$/.test(x.id) || typeof x.name !== "string" || !x.name.trim()) continue;
    out.push({ id: x.id, nombre: x.name.trim().slice(0, 120) });
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
};

export const useCarpetasClientes = (activo: boolean) =>
  useQuery({
    queryKey: ["dropbox-carpetas-clientes"],
    enabled: activo,
    staleTime: 60_000,
    queryFn: async (): Promise<{ carpetas: CarpetaCliente[]; hayMas: boolean }> => {
      const { data, error } = await supabase.functions.invoke("dropbox-browse", { body: { path: CARPETA_CLIENTES, action: "list" } });
      if (error) throw new Error("No se pudieron leer las carpetas de clientes en Dropbox.");
      return { carpetas: carpetasDeRespuesta(data), hayMas: !!(data as { has_more?: unknown } | null)?.has_more };
    },
  });
