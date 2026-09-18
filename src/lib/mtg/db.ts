import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { MtgSeriesCadence } from "@/lib/mtg/cadence";

export type MtgSeriesRow = {
  id: string;
  organization_id: string;
  anchor_type: "client" | "group";
  client_id: string | null;
  client_group_id: string | null;
  title: string;
  cadence: MtgSeriesCadence;
  default_duration_min: number;
  owner_user_id: string;
  attendees_internal: string[];
  attendees_client: { name?: string; email?: string }[];
  outlook_series_id: string | null;
  teams_join_url: string | null;
  agenda_template: unknown;
  organizer_tenant_id: string | null;
  transcription_enabled: boolean;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type MtgDatabase = {
  __InternalSupabase: { PostgrestVersion: "14.1" };
  public: {
    Tables: {
      mtg_series: {
        Row: MtgSeriesRow;
        Insert: Partial<MtgSeriesRow> & Pick<MtgSeriesRow, "organization_id" | "anchor_type" | "title" | "owner_user_id">;
        Update: Partial<MtgSeriesRow>;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

export const mtgDb = supabase as unknown as SupabaseClient<MtgDatabase, "public">;
