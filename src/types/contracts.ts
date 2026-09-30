/** Tipos del MVP de contratos (onboarding → firma externa). */

export type ContractPackageKind = "softlanding" | "backoffice_pm";

export type ContractEngagementStatus =
  | "awaiting_start"
  | "onboarding"
  | "ready_to_generate"
  | "document_draft"
  | "document_ready"
  | "signed_confirmed"
  | "void"
  | "expired";

export type ContractPackageItemStatus =
  | "pending"
  | "capturing"
  | "ready_to_generate"
  | "issued"
  | "signed_external"
  | "void";

export type ContractAnswers = Record<string, string | number | boolean | null | undefined>;

export interface PricingCatalogRow {
  id: string;
  organization_id: string | null;
  package_kind: ContractPackageKind;
  plan_code: string;
  plan_name: string;
  list_price: number;
  currency: string;
  vat_included: boolean;
  max_operations: number | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  sort_order: number;
}

export interface ContractEngagement {
  id: string;
  organization_id: string;
  lead_id: string | null;
  client_id: string | null;
  origin: "onboarding" | "client_update";
  package_kind: ContractPackageKind;
  status: ContractEngagementStatus;
  service_types: string[];
  answers: ContractAnswers;
  answers_updated_at: string | null;
  answers_updated_by_role: string | null;
  current_version_id: string | null;
  client_access_token_hint: string | null;
  client_access_expires_at: string | null;
  document_ready_at: string | null;
  signed_confirmed_at: string | null;
  signed_file_document_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractPackageItem {
  id: string;
  engagement_id: string;
  item_key: string;
  template_id: string | null;
  status: ContractPackageItemStatus;
  current_version_id: string | null;
  project_id: string | null;
  sort_order: number;
  metadata: Record<string, unknown>;
}

export interface ContractTemplateField {
  id?: string;
  field_key: string;
  label: string;
  field_type: string;
  required: boolean;
  placeholder_in_body: string;
  editable_by?: string[];
  default_value?: string | null;
  sort_order: number;
  help_text?: string | null;
}

export interface ContractTemplate {
  id: string;
  name: string;
  body_html: string;
  template_key: string;
  package_kind?: ContractPackageKind;
}

export const PACKAGE_KIND_LABEL: Record<ContractPackageKind, string> = {
  softlanding: "Softlanding",
  backoffice_pm: "Backoffice (persona moral)",
};

export const ENGAGEMENT_STATUS_LABEL: Record<ContractEngagementStatus, string> = {
  awaiting_start: "Por iniciar",
  onboarding: "Capturando datos",
  ready_to_generate: "Listo para generar",
  document_draft: "Borrador",
  document_ready: "Documento listo",
  signed_confirmed: "Firmado confirmado",
  void: "Anulado",
  expired: "Expirado",
};
