/**
 * Respaldo local (IndexedDB) de grabaciones pendientes de subir a Storage.
 * Evita perder el audio si falla la red o se cierra la pestaña tras Detener.
 */

const DB_NAME = "mtg-pending-recordings";
const DB_VERSION = 1;
const STORE = "recordings";

export type PendingRecordingMeta = {
  meetingId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  origin: "manual_upload" | "browser_recorder";
  updatedAt: string;
  /** true mientras aún se graba (chunks parciales). */
  partial?: boolean;
};

export type PendingRecording = PendingRecordingMeta & {
  blob: Blob;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB no disponible en este entorno"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("No se pudo abrir IndexedDB"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "meetingId" });
      }
    };
  });
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Error IndexedDB"));
  });
}

export async function putPendingRecording(rec: PendingRecording): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await idbReq(
      tx.objectStore(STORE).put({
        ...rec,
        sizeBytes: rec.blob.size,
        updatedAt: new Date().toISOString(),
      }),
    );
  } finally {
    db.close();
  }
}

export async function getPendingRecording(
  meetingId: string,
): Promise<PendingRecording | null> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readonly");
    const row = await idbReq(tx.objectStore(STORE).get(meetingId));
    if (!row?.blob) return null;
    return row as PendingRecording;
  } finally {
    db.close();
  }
}

export async function clearPendingRecording(meetingId: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, "readwrite");
    await idbReq(tx.objectStore(STORE).delete(meetingId));
  } finally {
    db.close();
  }
}

export function downloadBlobLocally(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Persiste un blob parcial durante la grabación (best-effort). */
export async function checkpointPendingRecording(opts: {
  meetingId: string;
  chunks: Blob[];
  fileName: string;
  contentType: string;
  origin: "browser_recorder";
}): Promise<void> {
  if (opts.chunks.length === 0) return;
  const blob = new Blob(opts.chunks, { type: opts.contentType });
  if (blob.size < 512) return;
  await putPendingRecording({
    meetingId: opts.meetingId,
    fileName: opts.fileName,
    contentType: opts.contentType,
    sizeBytes: blob.size,
    origin: opts.origin,
    updatedAt: new Date().toISOString(),
    partial: true,
    blob,
  });
}
