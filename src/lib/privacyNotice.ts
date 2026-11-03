/** Versionado del Aviso de Privacidad de reclutamiento (por fecha de actualización). */
export const PRIVACY_NOTICE_VERSION = "2026-10-31";
export const PRIVACY_NOTICE_UPDATED_LABEL = "31 de octubre de 2026";
export const PRIVACY_NOTICE_PATH = "/aviso-privacidad";
export const PRIVACY_CONTACT_EMAIL = "contacto@kawiil.mx";

export interface CandidateConsent {
  id: string;
  candidate_id: string;
  notice_version: string;
  primary_accepted: boolean;
  talent_pool_accepted: boolean;
  consented_at: string;
}
