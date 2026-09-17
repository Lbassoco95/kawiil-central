/**
 * Bucket de Storage donde vive el binario de una fila de `documents`.
 *
 * Por defecto todo está en `documents`, pero una fila puede declarar otro
 * bucket privado en `metadata.bucket` (p. ej. la minuta aprobada de Múuch'
 * vive en `mtg`). Solo aplica a lectura de archivos con source='supabase';
 * los uploads nuevos siguen cayendo en `documents`.
 */

import type { Json } from "@/integrations/supabase/types";

export const DOCUMENTS_BUCKET = "documents";

export function documentBucket(doc: { metadata?: Json } | null | undefined): string {
  const bucket = (doc?.metadata as { bucket?: unknown } | null | undefined)?.bucket;
  return typeof bucket === "string" && bucket ? bucket : DOCUMENTS_BUCKET;
}
