/**
 * Adjuntos embebidos en el deploy de Edge Functions para plantillas de pipeline.
 * Añade nuevas claves aquí y el PDF correspondiente en ./assets/
 */
export const PIPELINE_ATTACHMENT_KEYS = ["softlanding_hub_mexico"] as const;
export type PipelineTemplateAttachmentKey = (typeof PIPELINE_ATTACHMENT_KEYS)[number];

const DISPLAY_NAMES: Record<PipelineTemplateAttachmentKey, string> = {
  softlanding_hub_mexico: "Kawiil - Softlanding Hub en México.pdf",
};

function uint8ToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return btoa(binary);
}

export async function attachmentsForTemplateKey(
  key: string | null | undefined,
): Promise<Array<{ name: string; contentType: string; contentBytes: string }>> {
  if (!key || key !== "softlanding_hub_mexico") return [];

  const url = new URL("./assets/kawiil-softlanding-hub-mexico.pdf", import.meta.url);
  const raw = await Deno.readFile(url);
  return [
    {
      name: DISPLAY_NAMES.softlanding_hub_mexico,
      contentType: "application/pdf",
      contentBytes: uint8ToBase64(raw),
    },
  ];
}
