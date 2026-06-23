import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Catálogo de circuitos de Búho Legal. */
export interface BuhoCircuito {
  id: number;
  nombre: string;
  descripcion?: string;
  estado?: string;
}

/** Juzgado de un estado/fuero. */
export interface BuhoJuzgado {
  id: number;
  nombre: string;
}

/** Tipo de expediente (sólo en entidades que lo requieren). */
export interface BuhoTipoExpediente {
  id: number;
  descripcion: string;
}

/** Respuesta al crear una alerta. */
export interface BuhoAlertaCreada {
  id: number;
  asunto: string;
  nombre: string;
}

/** Acuerdo devuelto por el monitoreo. */
export interface BuhoAcuerdo {
  actor?: string;
  demandado?: string;
  fecha?: string;
  acuerdo?: string;
}

const invoke = async <T = unknown>(
  action: string,
  params: Record<string, unknown> = {},
): Promise<T> => {
  const { data, error } = await supabase.functions.invoke("buholegal-proxy", {
    body: { action, ...params },
  });
  if (error) {
    // La Edge Function devuelve { error } con status 400; surfacearlo con el mensaje real.
    const msg = (data as { error?: string } | null)?.error || error.message;
    throw new Error(msg);
  }
  if (data && typeof data === "object" && "error" in (data as Record<string, unknown>)) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as T;
};

export function useBuhoLegal() {
  const getCircuitos = useCallback(
    () => invoke<BuhoCircuito[]>("get_circuitos"),
    [],
  );
  const getJuzgados = useCallback(
    (entidad: string) => invoke<BuhoJuzgado[]>("get_juzgados", { entidad }),
    [],
  );
  const getTiposExpediente = useCallback(
    (entidad: string) =>
      invoke<BuhoTipoExpediente[]>("get_tipos_expediente", { entidad }),
    [],
  );

  const crearAlerta = useCallback(
    (
      entidad: string,
      payload: {
        nombre_alerta: string;
        numero_expediente: string;
        juzgado: number;
        tipo_expediente?: number;
      },
    ) => invoke<BuhoAlertaCreada>("create_alerta", { entidad, payload }),
    [],
  );

  const getAcuerdos = useCallback(
    (entidad: string, id_alerta: number) =>
      invoke<BuhoAcuerdo[]>("get_acuerdos", { entidad, id_alerta }),
    [],
  );

  const getAcuerdosNuevos = useCallback(
    (entidad: string, id_alerta?: number) =>
      invoke<BuhoAcuerdo[]>("get_acuerdos_nuevos", { entidad, id_alerta }),
    [],
  );

  const eliminarAlerta = useCallback(
    (entidad: string, id_alerta: number) =>
      invoke("delete_alerta", { entidad, id_alerta }),
    [],
  );

  return {
    getCircuitos,
    getJuzgados,
    getTiposExpediente,
    crearAlerta,
    getAcuerdos,
    getAcuerdosNuevos,
    eliminarAlerta,
  };
}
