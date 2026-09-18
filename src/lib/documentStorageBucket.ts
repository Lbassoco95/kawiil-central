import type { Json } from "@/integrations/supabase/types";

/** Bucket Supabase Storage para filas `documents` con source=supabase. Default: documents. */
export function documentStorageBucket(doc: {
  source: string;
  metadata?: Json | null;
}): string {
  if (doc.source !== "supabase") return "documents";
  const meta = doc.metadata as Record<string, unknown> | null | undefined;
  const bucket = meta?.bucket;
  if (typeof bucket === "string" && bucket.trim()) return bucket.trim();
  return "documents";
}
