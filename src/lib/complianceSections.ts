/**
 * Lógica pura para las secciones del Panel de Cumplimiento.
 *
 * Reglas de producto (acordadas con el equipo):
 * - Las secciones vacías del catálogo NO se muestran por defecto (menos ruido); un toggle
 *   «Mostrar secciones vacías u ocultas» las revela para poder agregarles tareas.
 * - «Eliminar sección» no borra: marca la fase con `hidden: true`. Así (a) no reaparece cuando
 *   `ensureCompliancePhasesOnProject` vuelve a sembrar el catálogo, y (b) su categoría queda
 *   excluida de la regeneración automática de tareas.
 * - Toda etiqueta pasa por `complianceCategoryLabel`, nunca se muestra el `key` en snake_case.
 */
import type { SyncPhase } from "@/lib/projectPhaseSync";
import {
  compareComplianceCategoryKeys,
  complianceCategoryLabel,
  isStandardComplianceCategoryKey,
} from "@/lib/compliancePhaseCatalog";

export interface ComplianceSectionDescriptor {
  key: string;
  name: string;
  order: number;
  /** El usuario eliminó la sección (queda excluida de la regeneración). */
  hidden: boolean;
  /** Existe en `projects.phases` (habilita reordenar / renombrar persistente). */
  persisted: boolean;
  taskCount: number;
}

/** Claves de categoría marcadas como ocultas/eliminadas → excluidas de la generación de tareas. */
export function hiddenComplianceCategoryKeys(phases: SyncPhase[] | null | undefined): Set<string> {
  const set = new Set<string>();
  for (const p of phases || []) {
    if (p?.hidden && p.key) set.add(p.key);
  }
  return set;
}

/**
 * Ordena y clasifica todas las secciones candidatas (fases persistidas + buckets derivados de
 * tareas) aplicando visibilidad. Devuelve la lista completa con `visible` para que la vista
 * pueda además contar cuántas quedaron ocultas y ofrecer el toggle.
 */
export function buildComplianceSections(params: {
  phases: SyncPhase[];
  /** Claves de categoría/fase que tienen al menos una tarea (abierta o cerrada). */
  taskCountByKey: Map<string, number>;
  showHidden: boolean;
}): {
  sections: (ComplianceSectionDescriptor & { visible: boolean })[];
  hiddenOrEmptyCount: number;
} {
  const { phases, taskCountByKey, showHidden } = params;

  const persistedByKey = new Map<string, SyncPhase>();
  for (const p of phases || []) {
    if (p?.key) persistedByKey.set(p.key, p);
  }

  const allKeys = new Set<string>([...persistedByKey.keys(), ...taskCountByKey.keys()]);

  const descriptors: ComplianceSectionDescriptor[] = [];
  for (const key of allKeys) {
    const phase = persistedByKey.get(key);
    descriptors.push({
      key,
      name: phase?.name?.trim() || complianceCategoryLabel(key),
      order: phase?.order ?? 9999,
      hidden: Boolean(phase?.hidden),
      persisted: Boolean(phase),
      taskCount: taskCountByKey.get(key) ?? 0,
    });
  }

  descriptors.sort((a, b) => {
    // Persistidas primero, por su `order`; el resto por orden de catálogo y luego nombre.
    if (a.persisted !== b.persisted) return a.persisted ? -1 : 1;
    if (a.persisted && b.persisted) {
      if (a.order !== b.order) return a.order - b.order;
      return a.name.localeCompare(b.name, "es");
    }
    const cat = compareComplianceCategoryKeys(a.key, b.key);
    if (cat !== 0) return cat;
    return a.name.localeCompare(b.name, "es");
  });

  let hiddenOrEmptyCount = 0;
  const sections = descriptors.map((d) => {
    // Solo se oculta por vacía si es una sección del catálogo (el ruido a reducir);
    // una sección creada por el usuario se respeta aunque esté vacía.
    const emptyCatalog = d.taskCount === 0 && isStandardComplianceCategoryKey(d.key);
    // Oculta: eliminada por el usuario, o vacía del catálogo.
    const hiddenFromView = d.hidden || emptyCatalog;
    if (hiddenFromView) hiddenOrEmptyCount += 1;
    return { ...d, visible: showHidden || !hiddenFromView };
  });

  return { sections, hiddenOrEmptyCount };
}
