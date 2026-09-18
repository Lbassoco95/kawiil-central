import { sanitizeStorageFileName } from "@/lib/storageFilename";

export const MTG_BUCKET = "mtg";
export const MTG_SIGNED_URL_TTL_SECONDS = 300;

export type MtgAnchorType = "client" | "group";
export type MtgFileKind = "transcripts" | "recordings" | "minutes" | "evidence";

export interface MtgPathParams {
  organizationId: string;
  anchorType: MtgAnchorType;
  anchorId: string;
  kind: MtgFileKind;
  fileName: string;
  at?: Date;
  uniqueSuffix?: string;
}

export function buildMtgStoragePath({
  organizationId,
  anchorType,
  anchorId,
  kind,
  fileName,
  at = new Date(),
  uniqueSuffix,
}: MtgPathParams): string {
  const org = organizationId.trim();
  const anchor = anchorId.trim();
  if (!org) throw new Error("buildMtgStoragePath: falta organizationId");
  if (!anchor) throw new Error("buildMtgStoragePath: falta anchorId");

  const yyyy = at.getUTCFullYear();
  const mm = String(at.getUTCMonth() + 1).padStart(2, "0");
  const unique = uniqueSuffix ?? String(at.getTime());
  const safe = sanitizeStorageFileName(fileName);

  return `${org}/mtg/${anchorType}/${anchor}/${yyyy}/${mm}/${kind}/${unique}_${safe}`;
}
