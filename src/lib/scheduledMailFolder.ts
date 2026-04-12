import { supabase } from "@/integrations/supabase/client";

/** Carpeta raíz en Outlook donde se guardan los borradores de envíos programados (Graph move). */
export const SCHEDULED_MAIL_FOLDER_DISPLAY_NAME = "Kawiil · Programados";

/** Misma lógica que en microsoft-api: middots y espacios para encontrar «Kawiil · Programados». */
function normDisplayName(s: string) {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(/[\u00b7\u2219\u2022\u30fb\u318d\ufe52]/g, "\u00b7");
}

const TARGET_NORM = normDisplayName(SCHEDULED_MAIL_FOLDER_DISPLAY_NAME);

/** Sidebar / UI: detectar la carpeta aunque Graph use otro middot o espacios. */
export function isScheduledMailFolderDisplayName(displayName: string): boolean {
  return normDisplayName(displayName) === TARGET_NORM;
}

type GraphFolderRow = { id?: unknown; displayName?: unknown };

function findScheduledFolderId(folders: unknown[]): string | null {
  for (const f of folders) {
    if (!f || typeof f !== "object") continue;
    const row = f as GraphFolderRow;
    const id = typeof row.id === "string" ? row.id : "";
    const dn = typeof row.displayName === "string" ? row.displayName : "";
    if (id && dn && normDisplayName(dn) === TARGET_NORM) return id;
  }
  return null;
}

async function fetchMailFolders(): Promise<unknown[]> {
  const { data, error } = await supabase.functions.invoke("microsoft-api", {
    body: { action: "mail-folders" },
  });
  if (error) throw error;
  if (data && typeof data === "object" && "error" in data && (data as { error?: unknown }).error) {
    const e = (data as { error: unknown }).error;
    throw new Error(typeof e === "string" ? e : JSON.stringify(e));
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Resuelve el id de Graph de la carpeta de programados, creándola en la raíz del buzón si no existe.
 * Si otro cliente creó la carpeta entre lectura y creación, vuelve a listar y devuelve el id.
 */
export async function ensureScheduledMailFolderId(): Promise<string> {
  let folders = await fetchMailFolders();
  let found = findScheduledFolderId(folders);
  if (found) return found;

  const { data: created, error: createErr } = await supabase.functions.invoke("microsoft-api", {
    body: { action: "create-mail-folder", params: { displayName: SCHEDULED_MAIL_FOLDER_DISPLAY_NAME } },
  });
  if (!createErr && created && typeof created === "object" && typeof (created as { id?: unknown }).id === "string") {
    return (created as { id: string }).id;
  }

  folders = await fetchMailFolders();
  found = findScheduledFolderId(folders);
  if (found) return found;

  const fromData =
    created && typeof created === "object" && "error" in created
      ? String((created as { error?: unknown }).error ?? "")
      : "";
  const fromErr = createErr instanceof Error ? createErr.message : "";
  throw new Error(fromData || fromErr || "No se pudo preparar la carpeta de envíos programados");
}

export async function moveDraftToScheduledFolder(draftId: string, folderId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke("microsoft-api", {
    body: { action: "move-email", params: { messageId: draftId, destinationId: folderId } },
  });
  if (error) throw error;
  if (data && typeof data === "object" && "error" in data && (data as { error?: unknown }).error) {
    const e = (data as { error: unknown }).error;
    throw new Error(typeof e === "string" ? e : JSON.stringify(e));
  }
}

type InvalidateMailQueries = {
  invalidateQueries: (opts: { queryKey: readonly unknown[] }) => Promise<unknown>;
};

/**
 * Mueve a la carpeta de programados todos los borradores con job `pending` (p. ej. creados antes del move automático o si falló el traslado).
 */
export async function reconcilePendingScheduledDraftsToFolder(
  userId: string,
  queryClient: InvalidateMailQueries,
): Promise<void> {
  const { data: jobs, error } = await supabase
    .from("scheduled_mail_jobs")
    .select("draft_id")
    .eq("user_id", userId)
    .eq("status", "pending");
  if (error || !jobs?.length) return;

  let folderId: string;
  try {
    folderId = await ensureScheduledMailFolderId();
  } catch {
    return;
  }

  const ids = [...new Set(jobs.map((j) => j.draft_id).filter((id): id is string => typeof id === "string" && !!id))];
  let moved = 0;
  for (const id of ids) {
    try {
      await moveDraftToScheduledFolder(id, folderId);
      moved++;
    } catch {
      /* ya en carpeta, id obsoleto o permisos */
    }
  }

  if (moved > 0) {
    await queryClient.invalidateQueries({ queryKey: ["mail-folders"] });
    await queryClient.invalidateQueries({ queryKey: ["outlook-emails"] });
  }
}
