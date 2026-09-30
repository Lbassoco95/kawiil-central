/**
 * Plazo de resguardo en la pantalla de baja (B1). Las fechas y los años los calcula
 * la base (portal_account_deletion_plan); aquí solo se elige cuál mostrar.
 */
export type Plazo = 5 | 10;
export const PLAZOS: readonly Plazo[] = [5, 10] as const;
export const PLAZO_OMISION: Plazo = 5;

type PorOpcion<T> = Partial<Record<"5" | "10", T>> | null;
export interface ResguardoItem {
  elige?: boolean;
  anios?: number;
  hasta?: string;
  hasta_por_opcion?: PorOpcion<string>;
  anios_por_opcion?: PorOpcion<number>;
}

/** Años y fecha de fin que corresponden al plazo elegido (o los fijos, si el dato no depende de la elección). */
export function hastaPara(item: ResguardoItem, plazo: Plazo): { anios: number | undefined; hasta: string | undefined } {
  const k = String(plazo) as "5" | "10";
  if (item.elige && item.hasta_por_opcion?.[k]) {
    return { anios: item.anios_por_opcion?.[k] ?? plazo, hasta: item.hasta_por_opcion[k] };
  }
  return { anios: item.anios, hasta: item.hasta };
}
