/**
 * Rutas del bucket privado `juun`.
 *
 *   {organization_id}/juun/clients/{client_id}/{yyyy}/{mm}/{tipo}/{ts}_{nombre}.{ext}
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

export const JUUN_BUCKET = "juun";

/** Vida de las signed URL, en segundos. Corta a propósito: son datos fiscales de un cliente. */
export const JUUN_SIGNED_URL_TTL_SECONDS = 300;

/**
 * Qué guardamos:
 *  - `receipts`  foto o PDF del ticket tal como lo subió el usuario
 *  - `cfdi`      XML y PDF descargados del portal del comercio
 *  - `csf`       Constancia de Situación Fiscal del cliente
 *  - `evidence`  screenshot y trace.zip de cada intento del agente
 */
export type JuunFileKind = "receipts" | "cfdi" | "csf" | "evidence";

export interface JuunPathParams {
  organizationId: string;
  clientId: string;
  kind: JuunFileKind;
  fileName: string;
  /** Fecha que ordena el archivo en carpetas. Default: ahora. */
  at?: Date;
  /** Sufijo único; se inyecta en pruebas para que la ruta sea determinista. */
  uniqueSuffix?: string;
}

export function buildJuunPath({
  organizationId,
  clientId,
  kind,
  fileName,
  at = new Date(),
  uniqueSuffix,
}: JuunPathParams): string {
  const org = organizationId.trim();
  const client = clientId.trim();
  if (!org) throw new Error("buildJuunPath: falta organizationId (es el segmento que aísla al tenant)");
  if (!client) throw new Error("buildJuunPath: falta clientId");

  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  const unique = uniqueSuffix ?? String(at.getTime());
  const safe = sanitizeStorageFileName(fileName);

  return `${org}/juun/clients/${client}/${yyyy}/${mm}/${kind}/${unique}_${safe}`;
}

/** La organización a la que pertenece un objeto, leída de su ruta. */
export function organizationIdFromJuunPath(path: string): string | null {
  return path.split("/")[0] || null;
}

/** ¿Esta ruta pertenece a la organización dada? Espejo en TS de la policy de storage. */
export function juunPathBelongsToOrg(path: string, organizationId: string): boolean {
  return organizationIdFromJuunPath(path) === organizationId.trim();
}
