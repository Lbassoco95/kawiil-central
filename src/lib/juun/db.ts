/**
 * Acceso tipado a las tablas `fis_*` de Ju'un.
 *
 * `src/integrations/supabase/types.ts` es autogenerado desde el esquema remoto
 * y todavía no conoce estas tablas. En vez de salpicar `as any` por cada
 * consulta, aquí se declaran los tipos a mano una sola vez y se expone un
 * cliente que los usa.
 *
 * Cuando se regeneren los tipos desde Supabase, este archivo se puede borrar y
 * cambiar `juunDb` por `supabase` sin tocar nada más.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// `type`, no `interface`: supabase-js exige que Row/Insert/Update encajen en
// `Record<string, unknown>`, y una interface no lo satisface (no lleva index
// signature implícita). Con `interface` los tipos de insert/update colapsan a
// `never` y no compila nada.
export type FisTaxProfileRow = {
  id: string;
  organization_id: string;
  client_id: string;
  rfc: string;
  razon_social: string;
  cp_fiscal: string;
  regimen_fiscal: string;
  uso_cfdi_default: string;
  email_recepcion: string | null;
  csf_file_path: string | null;
  csf_verified_at: string | null;
  csf_verified_by: string | null;
  is_default: boolean;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FisTaxProfileInsert = Omit<
  FisTaxProfileRow,
  "id" | "created_at" | "updated_at" | "csf_verified_at" | "csf_verified_by" | "is_default" | "active"
> &
  Partial<Pick<FisTaxProfileRow, "id" | "is_default" | "active" | "csf_verified_at" | "csf_verified_by">>;

export type FisTaxProfileUpdate = Partial<Omit<FisTaxProfileRow, "id" | "created_at">>;

type JuunDatabase = {
  // Misma forma que `Database` en src/integrations/supabase/types.ts: supabase-js
  // exige `__InternalSupabase` y mapas vacíos como `{ [_ in never]: never }`.
  // Si se declaran como Record<string, never>, los tipos de insert/update
  // colapsan a `never` y nada compila.
  __InternalSupabase: {
    PostgrestVersion: "14.1";
  };
  public: {
    Tables: {
      fis_tax_profiles: {
        Row: FisTaxProfileRow;
        Insert: FisTaxProfileInsert;
        Update: FisTaxProfileUpdate;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export const juunDb = supabase as unknown as SupabaseClient<JuunDatabase, "public">;
