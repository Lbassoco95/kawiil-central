/**
 * Acceso tipado a las tablas `mtg_*` de Múuch' (módulo de Juntas).
 *
 * `src/integrations/supabase/types.ts` es autogenerado desde el esquema remoto
 * y todavía no conoce estas tablas. En vez de salpicar `as any` por cada
 * consulta, aquí se declaran los tipos a mano una sola vez y se expone un
 * cliente que los usa.
 *
 * Cuando se regeneren los tipos desde Supabase, este archivo se puede borrar y
 * cambiar `mtgDb` por `supabase` sin tocar nada más.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

// `type`, no `interface`: supabase-js exige que Row/Insert/Update encajen en
// `Record<string, unknown>`, y una interface no lo satisface (no lleva index
// signature implícita). Con `interface` los tipos de insert/update colapsan a
// `never` y no compila nada.

export type MtgEntity = { key: string; label: string; client_id: string };
export type MtgAttendeeClient = { name: string; email?: string };
export type MtgAgendaBlock = { key: string; title: string };

export type MtgSeriesRow = {
  id: string;
  organization_id: string;
  anchor_type: "client" | "group";
  anchor_id: string;
  client_id: string | null;
  title: string;
  cadence: "weekly" | "biweekly" | "monthly" | "adhoc";
  default_duration_min: number;
  starts_at: string | null;
  owner_user_id: string | null;
  attendees_internal: string[];
  attendees_client: MtgAttendeeClient[];
  entities: MtgEntity[];
  agenda_template: MtgAgendaBlock[];
  send_minutes_to_client: boolean;
  auto_transcript: boolean;
  transcript_notice_confirmed_at: string | null;
  transcript_notice_confirmed_by: string | null;
  organizer_tenant_id: string | null;
  outlook_event_id: string | null;
  teams_join_url: string | null;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MtgSeriesInsert = Partial<Omit<MtgSeriesRow, "id" | "created_at" | "updated_at">> &
  Pick<MtgSeriesRow, "organization_id" | "anchor_type" | "anchor_id" | "title" | "cadence">;

export type MtgSeriesUpdate = Partial<Omit<MtgSeriesRow, "id" | "created_at">>;

export type MtgMeetingRow = {
  id: string;
  organization_id: string;
  series_id: string | null;
  client_id: string | null;
  scheduled_at: string;
  duration_min: number | null;
  started_at: string | null;
  ended_at: string | null;
  status:
    | "planned"
    | "in_progress"
    | "ended"
    | "minutes_draft"
    | "minutes_review"
    | "minutes_approved"
    | "closed"
    | "cancelled"
    | "no_show";
  facilitator_user_id: string | null;
  note_taker_user_id: string | null;
  outlook_event_id: string | null;
  teams_online_meeting_id: string | null;
  teams_join_url: string | null;
  transcript_status:
    | "not_requested"
    | "subscribed"
    | "received"
    | "failed"
    | "unavailable";
  transcript_path: string | null;
  recording_path: string | null;
  transcript_unavailable_reason: string | null;
  minutes_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MtgMeetingInsert = Partial<Omit<MtgMeetingRow, "id" | "created_at" | "updated_at">> &
  Pick<MtgMeetingRow, "organization_id" | "scheduled_at">;

export type MtgMeetingUpdate = Partial<Omit<MtgMeetingRow, "id" | "created_at">>;

export type MtgTopicRow = {
  id: string;
  organization_id: string;
  series_id: string;
  client_id: string;
  entity_key: string | null;
  default_project_id: string | null;
  title: string;
  context: string | null;
  source: string | null;
  if_asked: string | null;
  owner_side: "kawiil" | "client" | "both" | null;
  owner_user_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  linked_task_id: string | null;
  status: "open" | "resolved" | "dropped";
  dropped_reason: string | null;
  created_in_meeting_id: string | null;
  resolved_in_meeting_id: string | null;
  legacy_key: string | null;
  sort_order: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MtgTopicInsert = Partial<Omit<MtgTopicRow, "id" | "created_at" | "updated_at">> &
  Pick<MtgTopicRow, "organization_id" | "series_id" | "client_id" | "title">;

export type MtgTopicUpdate = Partial<Omit<MtgTopicRow, "id" | "created_at">>;

export type MtgTopicUpdateRow = {
  id: string;
  organization_id: string;
  topic_id: string;
  meeting_id: string;
  movement:
    | "resolved"
    | "advanced"
    | "unchanged"
    | "new"
    | "decision_needed"
    | "blocked_third_party"
    | "waiting_authority";
  progress_since_last: string | null;
  next_step: string | null;
  session_notes: string | null;
  reviewed: boolean;
  reviewed_at: string | null;
  reviewed_by: string | null;
  origin: "prepared" | "edited_live" | "proposed_by_model";
  created_at: string;
  updated_at: string;
};

export type MtgTopicUpdateInsert = Partial<Omit<MtgTopicUpdateRow, "id" | "created_at" | "updated_at">> &
  Pick<MtgTopicUpdateRow, "organization_id" | "topic_id" | "meeting_id" | "movement">;

export type MtgTopicUpdateUpdate = Partial<Omit<MtgTopicUpdateRow, "id" | "created_at">>;

export type MtgAgendaItemRow = {
  id: string;
  organization_id: string;
  meeting_id: string;
  sort_order: number | null;
  title: string | null;
  kind: "section" | "topic" | "decision" | "free" | null;
  topic_id: string | null;
  decision_id: string | null;
  source: "template" | "carried_over" | "added_by_team" | "from_task" | "from_deadline" | null;
  status: "pending" | "reviewed" | "skipped" | "deferred";
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MtgAgendaItemInsert = Partial<Omit<MtgAgendaItemRow, "id" | "created_at" | "updated_at">> &
  Pick<MtgAgendaItemRow, "organization_id" | "meeting_id">;

export type MtgAgendaItemUpdate = Partial<Omit<MtgAgendaItemRow, "id" | "created_at">>;

export type MtgDecisionRow = {
  id: string;
  organization_id: string;
  meeting_id: string;
  client_id: string | null;
  entity_key: string | null;
  topic_id: string | null;
  text: string;
  status: "pending" | "decided" | "deferred";
  resolution: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  agreement_id: string | null;
  sort_order: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MtgDecisionInsert = Partial<Omit<MtgDecisionRow, "id" | "created_at" | "updated_at">> &
  Pick<MtgDecisionRow, "organization_id" | "meeting_id" | "text">;

export type MtgDecisionUpdate = Partial<Omit<MtgDecisionRow, "id" | "created_at">>;

export type MtgExpectedNextRow = {
  id: string;
  organization_id: string;
  meeting_id: string;
  client_id: string | null;
  entity_key: string | null;
  topic_id: string | null;
  text: string;
  done: boolean;
  done_at: string | null;
  sort_order: number | null;
  created_at: string;
};

export type MtgExpectedNextInsert = Partial<Omit<MtgExpectedNextRow, "id" | "created_at">> &
  Pick<MtgExpectedNextRow, "organization_id" | "meeting_id" | "text">;

export type MtgExpectedNextUpdate = Partial<Omit<MtgExpectedNextRow, "id" | "created_at">>;

export type MtgAgreementRow = {
  id: string;
  organization_id: string;
  meeting_id: string;
  client_id: string;
  entity_key: string | null;
  topic_id: string | null;
  project_id: string | null;
  text: string;
  owner_side: "kawiil" | "client" | "both" | null;
  owner_user_id: string | null;
  owner_name: string | null;
  due_date: string | null;
  origin: "captured_live" | "proposed_by_model" | "added_in_review";
  status: "proposed" | "confirmed" | "rejected";
  confirmed_by: string | null;
  confirmed_at: string | null;
  rejected_reason: string | null;
  project_hint: string | null;
  project_reason: string | null;
  transcript_ref: string | null;
  confidence: number | null;
  task_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MtgAgreementInsert = Partial<Omit<MtgAgreementRow, "id" | "created_at" | "updated_at">> &
  Pick<MtgAgreementRow, "organization_id" | "meeting_id" | "client_id" | "text" | "origin">;

export type MtgAgreementUpdate = Partial<Omit<MtgAgreementRow, "id" | "created_at">>;

export type MtgMinutesRow = {
  id: string;
  organization_id: string;
  meeting_id: string;
  version: number;
  status: "draft" | "in_review" | "approved" | "superseded";
  content_md: string | null;
  generated_by: "model" | "human" | null;
  model_version: string | null;
  prompt_version: string | null;
  approved_by: string | null;
  approved_at: string | null;
  document_id: string | null;
  document_path: string | null;
  sent_to_client_at: string | null;
  sent_to: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MtgMinutesInsert = Partial<Omit<MtgMinutesRow, "id" | "created_at" | "updated_at">> &
  Pick<MtgMinutesRow, "organization_id" | "meeting_id" | "version" | "status">;

export type MtgMinutesUpdate = Partial<Omit<MtgMinutesRow, "id" | "created_at">>;

export type MtgGraphSubscriptionRow = {
  id: string;
  tenant_id: string;
  subscription_id: string | null;
  resource: string | null;
  change_type: string | null;
  expires_at: string | null;
  lifecycle_state: string | null;
  last_renewed_at: string | null;
  client_state_hash: string | null;
  created_at: string;
  updated_at: string;
};

export type MtgGraphSubscriptionInsert = Partial<Omit<MtgGraphSubscriptionRow, "id" | "created_at" | "updated_at">> &
  Pick<MtgGraphSubscriptionRow, "tenant_id">;

export type MtgGraphSubscriptionUpdate = Partial<Omit<MtgGraphSubscriptionRow, "id" | "created_at">>;

export type MtgAuditLogRow = {
  id: string;
  organization_id: string;
  actor_user_id: string | null;
  occurred_at: string;
  entity_type: "series" | "meeting" | "topic" | "agreement" | "decision" | "minutes" | "transcript";
  entity_id: string | null;
  action: string;
  snapshot: unknown;
  details: unknown;
};

export type MtgAuditLogInsert = Omit<MtgAuditLogRow, "id" | "occurred_at"> &
  Partial<Pick<MtgAuditLogRow, "id" | "occurred_at">>;

type MtgDatabase = {
  // Misma forma que `Database` en src/integrations/supabase/types.ts: supabase-js
  // exige `__InternalSupabase` y mapas vacíos como `{ [_ in never]: never }`.
  __InternalSupabase: {
    PostgrestVersion: "14.1";
  };
  public: {
    Tables: {
      mtg_series: {
        Row: MtgSeriesRow;
        Insert: MtgSeriesInsert;
        Update: MtgSeriesUpdate;
        Relationships: [];
      };
      mtg_meetings: {
        Row: MtgMeetingRow;
        Insert: MtgMeetingInsert;
        Update: MtgMeetingUpdate;
        Relationships: [];
      };
      mtg_topics: {
        Row: MtgTopicRow;
        Insert: MtgTopicInsert;
        Update: MtgTopicUpdate;
        Relationships: [];
      };
      mtg_topic_updates: {
        Row: MtgTopicUpdateRow;
        Insert: MtgTopicUpdateInsert;
        Update: MtgTopicUpdateUpdate;
        Relationships: [];
      };
      mtg_agenda_items: {
        Row: MtgAgendaItemRow;
        Insert: MtgAgendaItemInsert;
        Update: MtgAgendaItemUpdate;
        Relationships: [];
      };
      mtg_decisions: {
        Row: MtgDecisionRow;
        Insert: MtgDecisionInsert;
        Update: MtgDecisionUpdate;
        Relationships: [];
      };
      mtg_expected_next: {
        Row: MtgExpectedNextRow;
        Insert: MtgExpectedNextInsert;
        Update: MtgExpectedNextUpdate;
        Relationships: [];
      };
      mtg_agreements: {
        Row: MtgAgreementRow;
        Insert: MtgAgreementInsert;
        Update: MtgAgreementUpdate;
        Relationships: [];
      };
      mtg_minutes: {
        Row: MtgMinutesRow;
        Insert: MtgMinutesInsert;
        Update: MtgMinutesUpdate;
        Relationships: [];
      };
      mtg_graph_subscriptions: {
        Row: MtgGraphSubscriptionRow;
        Insert: MtgGraphSubscriptionInsert;
        Update: MtgGraphSubscriptionUpdate;
        Relationships: [];
      };
      mtg_audit_log: {
        Row: MtgAuditLogRow;
        Insert: MtgAuditLogInsert;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      mtg_generate_series_meetings: {
        Args: { _series_id: string; _count?: number };
        Returns: number;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export const mtgDb = supabase as unknown as SupabaseClient<MtgDatabase, "public">;
