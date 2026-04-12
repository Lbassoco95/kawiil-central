import { supabase } from "@/integrations/supabase/client";

/** Carpeta raíz en Outlook donde se guardan los borradores de envíos programados (Graph move). */
export const SCHEDULED_MAIL_FOLDER_DISPLAY_NAME = "Kawiil · Programados";

function normDisplayName(s: string) {
  return s.trim().toLowerCase();
}

const TARGET_NORM = normDisplayName(SCHEDULED_MAIL_FOLDER_DISPLAY_NAME);

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
