import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ClientForEmail {
  id: string;
  name: string;
  email: string | null;
  rfc: string | null;
}

/**
 * Pequeño hook de debounce local, sólo para este buscador.
 * Evita depender de librerías externas.
 */
export function useDebouncedValue<T>(value: T, delayMs = 180): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Busca clientes activos por nombre o RFC para rellenar plantillas de correo.
 * - Requiere al menos 2 caracteres.
 * - Limita a 20 resultados ordenados por nombre.
 * - Filtra por status = 'activo'.
 */
export function useClientsForEmail(query: string, limit = 20) {
  const q = query.trim();
  const enabled = q.length >= 2;

  return useQuery({
    queryKey: ["clients-for-email", q, limit],
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<ClientForEmail[]> => {
      const escaped = q.replace(/[%,]/g, " ").trim();
      const filter = `name.ilike.%${escaped}%,rfc.ilike.%${escaped}%`;
      const { data, error } = await supabase
        .from("clients")
        .select("id, name, email, rfc")
        .eq("status", "activo")
        .or(filter)
        .order("name", { ascending: true })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as ClientForEmail[];
    },
  });
}
