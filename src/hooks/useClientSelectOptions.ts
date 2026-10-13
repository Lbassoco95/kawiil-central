import { useMemo } from "react";
import { useClients } from "@/hooks/useClients";
import { useAllClientGroupMembers, useClientGroups } from "@/hooks/useClientGroups";
import type { SearchableOption } from "@/components/shared/SearchableSelect";
import { sortAlpha } from "@/lib/sortAlpha";

export const CLIENTS_SECTION = "Clientes";

export interface ClientSection {
  group: string;
  items: { id: string; name: string }[];
}

/**
 * Secciones para selectores de cliente: primero cada grupo (alfabético) con sus
 * empresas (alfabético) y al final «Clientes» con todos. Elegir una empresa de un
 * grupo equivale a elegir ese cliente.
 */
export function useClientSections(): ClientSection[] {
  const { data: clients } = useClients();
  const { data: groups = [] } = useClientGroups();
  const { data: members = [] } = useAllClientGroupMembers();

  return useMemo(() => {
    const all = clients ?? [];
    const byId = new Map(all.map((c) => [c.id, c]));
    const sections: ClientSection[] = groups
      .map((g) => ({
        group: `Grupo: ${g.name}`,
        items: sortAlpha(
          members
            .filter((m) => m.group_id === g.id)
            .map((m) => byId.get(m.client_id))
            .filter((c): c is NonNullable<typeof c> => !!c)
            .map((c) => ({ id: c.id, name: c.name })),
          (c) => c.name,
        ),
      }))
      .filter((s) => s.items.length > 0);
    sections.push({ group: CLIENTS_SECTION, items: all.map((c) => ({ id: c.id, name: c.name })) });
    return sections;
  }, [clients, groups, members]);
}

/** Opciones para SearchableSelect: grupos con sus empresas + todos los clientes. */
export function useClientSelectOptions(): SearchableOption[] {
  const sections = useClientSections();
  return useMemo(
    () => sections.flatMap((s) => s.items.map((c) => ({ value: c.id, label: c.name, group: s.group }))),
    [sections],
  );
}
