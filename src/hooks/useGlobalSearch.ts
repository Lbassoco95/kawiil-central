import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Búsqueda global contra la base de datos.
 *
 * El buscador anterior sólo filtraba las listas ya cacheadas en el cliente (y
 * encima recortadas), así que un cliente que no estuviera en ese trozo era
 * imposible de encontrar. Aquí se consulta Supabase directamente por cada
 * entidad, de modo que el resultado no depende de qué haya cargado la sesión.
 *
 * Nota: `ilike` de Postgres es sensible a acentos ("jose" no encuentra "José").
 * Esa parte la cubre el filtrado local normalizado de `searchMatch`; ambos
 * conjuntos se fusionan en el buscador.
 */

export type GlobalSearchEntity = "client" | "project" | "task" | "document" | "lead";

export type GlobalSearchHit = {
  id: string;
  entity: GlobalSearchEntity;
  title: string;
  subtitle: string | null;
  to: string;
};

export type GlobalSearchResult = Record<GlobalSearchEntity, GlobalSearchHit[]>;

/** Relación a-uno con `clients`; PostgREST la devuelve como objeto, no como lista. */
type ClientRef = { name: string } | null;

type ClientRow = {
  id: string;
  name: string;
  rfc: string | null;
  email: string | null;
  contact_name: string | null;
};
type ProjectRow = { id: string; name: string; area: string | null; clients: ClientRef };
type TaskRow = { id: string; title: string; status: string | null; clients: ClientRef };
type DocumentRow = { id: string; name: string; clients: ClientRef };
type LeadRow = { id: string; full_name: string; company_name: string | null; email: string | null };

const EMPTY_RESULT: GlobalSearchResult = {
  client: [],
  project: [],
  task: [],
  document: [],
  lead: [],
};

/** Longitud mínima antes de pegarle a la base de datos. */
export const GLOBAL_SEARCH_MIN_LENGTH = 2;

/** Debounce local para no lanzar una consulta por cada tecla. */
export function useDebouncedValue<T>(value: T, delayMs = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/**
 * PostgREST separa los filtros de `.or()` por comas, así que la coma y el
 * comodín `%` del término deben salir antes de construir el filtro.
 */
function escapeForOr(term: string): string {
  return term.replace(/[%,()]/g, " ").trim();
}

function buildOrFilter(columns: string[], term: string): string {
  const escaped = escapeForOr(term);
  return columns.map((column) => `${column}.ilike.%${escaped}%`).join(",");
}

/**
 * Una entidad sin permisos (RLS) o una tabla ausente no deben tumbar la
 * búsqueda completa: se registra y se devuelve vacío.
 */
async function safeSearch<T>(
  entity: GlobalSearchEntity,
  run: () => Promise<T[]>,
): Promise<T[]> {
  try {
    return await run();
  } catch (error) {
    console.error(`Búsqueda global (${entity}):`, error);
    return [];
  }
}

/**
 * Ejecuta la consulta y devuelve las filas ya tipadas. El tipo inferido por
 * PostgREST para los `select` con relaciones no coincide con las formas de
 * arriba, así que la conversión se concentra aquí en vez de repartirla por
 * cada `map`.
 */
async function unwrap<T>(promise: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const { data, error } = await promise;
  if (error) throw error;
  return (data ?? []) as T[];
}

export function useGlobalSearch(
  query: string,
  options?: { includeLeads?: boolean; limitPerEntity?: number },
) {
  const { user } = useAuth();
  const includeLeads = options?.includeLeads ?? false;
  const limit = options?.limitPerEntity ?? 8;
  const term = query.trim();
  const enabled = !!user && term.length >= GLOBAL_SEARCH_MIN_LENGTH;

  return useQuery<GlobalSearchResult>({
    queryKey: ["global-search", term, includeLeads, limit],
    enabled,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    queryFn: async () => {
      // Si tras escapar no queda nada buscable (p. ej. el usuario sólo escribió
      // "%%%"), el filtro degeneraría en `ilike.%%` y devolvería filas al azar.
      if (!escapeForOr(term)) return { ...EMPTY_RESULT };

      const [clients, projects, tasks, documents, leads] = await Promise.all([
        safeSearch<ClientRow>("client", () =>
          unwrap<ClientRow>(
            supabase
              .from("clients")
              .select("id, name, rfc, email, contact_name")
              .or(buildOrFilter(["name", "rfc", "email", "contact_name"], term))
              .order("name", { ascending: true })
              .limit(limit),
          ),
        ),
        safeSearch<ProjectRow>("project", () =>
          unwrap<ProjectRow>(
            supabase
              .from("projects")
              .select("id, name, area, clients(name)")
              .or(buildOrFilter(["name", "description"], term))
              .order("updated_at", { ascending: false })
              .limit(limit),
          ),
        ),
        safeSearch<TaskRow>("task", () =>
          unwrap<TaskRow>(
            supabase
              .from("tasks")
              .select("id, title, status, clients(name)")
              .or(buildOrFilter(["title", "description"], term))
              .order("created_at", { ascending: false })
              .limit(limit),
          ),
        ),
        safeSearch<DocumentRow>("document", () =>
          unwrap<DocumentRow>(
            supabase
              .from("documents")
              .select("id, name, clients(name)")
              .or(buildOrFilter(["name"], term))
              .order("created_at", { ascending: false })
              .limit(limit),
          ),
        ),
        includeLeads
          ? safeSearch<LeadRow>("lead", () =>
              unwrap<LeadRow>(
                supabase
                  .from("leads")
                  .select("id, full_name, company_name, email")
                  .or(buildOrFilter(["full_name", "company_name", "email"], term))
                  .order("updated_at", { ascending: false })
                  .limit(limit),
              ),
            )
          : Promise.resolve([]),
      ]);

      return {
        client: clients.map((row) => ({
          id: row.id,
          entity: "client" as const,
          title: row.name,
          subtitle: row.rfc || row.contact_name || row.email || null,
          to: `/clientes/${row.id}`,
        })),
        project: projects.map((row) => ({
          id: row.id,
          entity: "project" as const,
          title: row.name,
          subtitle: row.clients?.name ?? row.area ?? null,
          to: `/proyectos/${row.id}`,
        })),
        task: tasks.map((row) => ({
          id: row.id,
          entity: "task" as const,
          title: row.title,
          subtitle: row.clients?.name ?? row.status ?? null,
          to: `/tareas?id=${row.id}`,
        })),
        document: documents.map((row) => ({
          id: row.id,
          entity: "document" as const,
          title: row.name,
          subtitle: row.clients?.name ?? null,
          to: `/documentos?id=${row.id}`,
        })),
        lead: leads.map((row) => ({
          id: row.id,
          entity: "lead" as const,
          title: row.full_name,
          subtitle: row.company_name || row.email || null,
          to: `/pipeline/leads/${row.id}`,
        })),
      };
    },
  });
}
