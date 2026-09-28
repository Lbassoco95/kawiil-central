/**
 * Cliente de Supabase del portal: mismo proyecto y misma llave pública que
 * central (kawiil-central es la única fuente de verdad). NUNCA hay aquí llaves
 * de servicio: todo lo que el portal ve lo decide la RLS.
 * Las tablas del portal aún no están en `types.ts` generado; por eso el cliente
 * se usa sin tipos de tabla.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typed } from "@/integrations/supabase/client";

export const db = typed as unknown as SupabaseClient;
