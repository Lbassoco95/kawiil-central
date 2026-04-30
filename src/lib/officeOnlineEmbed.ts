import { ACTIVE_SUPABASE_URL } from "@/integrations/supabase/client";

/** URL firmada de Storage puede venir relativa (`/object/sign/...`). */
export function buildAbsoluteSignedStorageUrl(signedUrl: string): string {
  if (signedUrl.startsWith("http://") || signedUrl.startsWith("https://")) return signedUrl;
  return `${ACTIVE_SUPABASE_URL}/storage/v1${signedUrl}`;
}

/** Visor incrustado de Microsoft Office Online (Word, Excel, PowerPoint). */
export function buildMicrosoftOfficeEmbedUrl(absoluteFileUrl: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absoluteFileUrl)}`;
}
