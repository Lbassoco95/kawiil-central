/**
 * Rutas del bucket privado `mtg`.
 *
 *   {organization_id}/mtg/{anchor_type}/{anchor_id}/{yyyy}/{mm}/{tipo}/{ts}_{nombre}.{ext}
 *
 * El PRIMER segmento es la organización y de ahí cuelga la policy de storage
 * (`(storage.foldername(name))[1] = get_user_org_id(auth.uid())`), así que ese
 * segmento no es decorativo: es el aislamiento entre tenants. Cambiar el orden
 * de la ruta rompe la seguridad, no solo el orden de las carpetas.
 *
 * Los archivos se leen SIEMPRE por signed URL de vida corta. Nunca URL pública,
 * nunca path directo en el front.
 */

import { sanitizeStorageFileName } from "@/lib/storageFilename";

export const MTG_BUCKET = "mtg";

/** Vida de las signed URL, en segundos. Corta a propósito: son juntas de un cliente. */
export const MTG_SIGNED_URL_TTL_SECONDS = 300;

/**
 * Qué guardamos:
 *  - `transcripts` transcripción de la junta (JSON/vtt de Teams)
 *  - `recordings`  grabación de la junta
 *  - `minutes`     PDF de la minuta aprobada (aquí, NO en `documents`)
 *  - `evidence`    material de respaldo ligado a la junta
 */
export type MtgFileKind = "transcripts" | "recordings" | "minutes" | "evidence";

export interface MtgPathParams {
  organizationId: string;
  /** 'client' | 'group' — ancla de la serie/junta a la que pertenece el archivo. */
  anchorType: "client" | "group";
  anchorId: string;
  kind: MtgFileKind;
  fileName: string;
  /** Fecha que ordena el archivo en carpetas. Default: ahora. */
  at?: Date;
  /** Sufijo único; se inyecta en pruebas para que la ruta sea determinista. */
  uniqueSuffix?: string;
}

export function buildMtgStoragePath({
  organizationId,
  anchorType,
  anchorId,
  kind,
  fileName,
  at = new Date(),
  uniqueSuffix,
}: MtgPathParams): string {
  const org = organizationId.trim();
  const anchor = anchorId.trim();
  if (!org) throw new Error("buildMtgStoragePath: falta organizationId (es el segmento que aísla al tenant)");
  if (anchorType !== "client" && anchorType !== "group")
    throw new Error("buildMtgStoragePath: anchorType debe ser 'client' o 'group'");
  if (!anchor) throw new Error("buildMtgStoragePath: falta anchorId");

  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  const unique = uniqueSuffix ?? String(at.getTime());
  const safe = sanitizeStorageFileName(fileName);

  return `${org}/mtg/${anchorType}/${anchor}/${yyyy}/${mm}/${kind}/${unique}_${safe}`;
}

/** La organización a la que pertenece un objeto, leída de su ruta. */
export function organizationIdFromMtgPath(path: string): string | null {
  return path.split("/")[0] || null;
}

/** ¿Esta ruta pertenece a la organización dada? Espejo en TS de la policy de storage. */
export function mtgPathBelongsToOrg(path: string, organizationId: string): boolean {
  return organizationIdFromMtgPath(path) === organizationId.trim();
}
