import { supabase } from "@/integrations/supabase/client";
import { movementsFromRaw, type ParsedMovement } from "./bankImport";

/** Renglón leído de una captura; editable en pantalla antes de cargarlo. */
export interface ShotRow {
  id: string;
  date: string | null;
  description: string;
  debit: number;
  credit: number;
  balance: number | null;
  uncertain: boolean;
  /** Categoría elegida o sugerida para este renglón. */
  category?: string | null;
  categorySource?: "manual" | "sugerida";
}

export interface ShotResult { rows: ShotRow[]; notes: string | null }

const MAX_SIDE = 1800;

/** Re-codifica cualquier imagen que el navegador pueda abrir (incluye HEIC en Safari) a JPEG reducido. */
export async function imageToJpegBase64(file: File): Promise<{ base64: string; media_type: "image/jpeg" }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("No pude abrir la imagen. Usa PNG, JPG o WEBP."));
      el.src = url;
    });
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Tu navegador no pudo procesar la imagen.");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { base64: canvas.toDataURL("image/jpeg", 0.88).split(",")[1], media_type: "image/jpeg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Manda las capturas a la función (visión de Claude) y devuelve los renglones leídos. */
export async function extractFromScreenshots(files: File[]): Promise<ShotResult> {
  const images = await Promise.all(files.slice(0, 4).map(imageToJpegBase64));
  const { data, error } = await supabase.functions.invoke("extract-bank-movements", {
    body: { images, default_year: new Date().getFullYear() },
  });
  if (error) {
    let msg = error.message;
    try { const ctx = (error as { context?: Response }).context; if (ctx) msg = (await ctx.json())?.error ?? msg; } catch { /* usa el mensaje base */ }
    throw new Error(msg);
  }
  const res = data as { ok?: boolean; error?: string; movements?: Omit<ShotRow, "id">[]; notes?: string | null };
  if (!res?.ok) throw new Error(res?.error ?? "No se pudo leer la captura.");
  return { rows: (res.movements ?? []).map((m) => ({ ...m, id: crypto.randomUUID() })), notes: res.notes ?? null };
}

/** Renglones revisados → movimientos listos para cargar (solo los que tienen fecha e importe). */
export function shotRowsToMovements(rows: ShotRow[]): ParsedMovement[] {
  return movementsFromRaw(
    rows.filter((r) => r.date && r.description.trim() && (r.debit > 0 || r.credit > 0))
      .map((r) => ({ date: r.date as string, description: r.description.trim(), reference: null, debit: r.debit, credit: r.credit, balance: r.balance, meta: r.category ? { category: r.category, categorySource: r.categorySource ?? "manual" } : undefined })),
  );
}
