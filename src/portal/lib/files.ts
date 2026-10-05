/** Preparación de fotos de tickets: HEIC → JPEG en el navegador y hash SHA-256. */
import { sha256Hex } from "../../../supabase/functions/_shared/portal/hash.ts";

export async function prepareTicketFile(file: File): Promise<{ blob: Blob; name: string; type: string; hash: string }> {
  let blob: Blob = file;
  let name = file.name;
  let type = file.type || "application/octet-stream";
  const isHeic = /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/.test(file.type);
  if (isHeic) {
    const heic2any = (await import("heic2any")).default;
    const out = await heic2any({ blob: file, toType: "image/jpeg", quality: 0.85 });
    blob = Array.isArray(out) ? out[0] : out;
    name = file.name.replace(/\.(heic|heif)$/i, ".jpg");
    type = "image/jpeg";
  }
  const hash = await sha256Hex(await blob.arrayBuffer());
  return { blob, name, type, hash };
}

export const safeName = (n: string) =>
  n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80) || "archivo";
