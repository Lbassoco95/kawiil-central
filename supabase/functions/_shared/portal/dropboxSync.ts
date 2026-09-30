/**
 * Portal del cliente — motor de sincronización Dropbox → Supabase (M5).
 *
 * Puro y agnóstico de origen/destino: la Edge `portal-dropbox-sync` le pasa
 * un origen Dropbox (API HTTP) y un destino Supabase (Storage + tabla); las
 * pruebas le pasan una carpeta local y un destino en memoria. Mismo código.
 *
 * Garantías:
 *   · Recorre SOLO carpetas de cliente mapeadas por una persona (por id de
 *     Dropbox, así que un renombre no rompe el vínculo).
 *   · Dentro del cliente, SOLO baja a FISCAL y CONTABILIDAD. De ADMINISTRATIVO,
 *     LEGAL y RECURSOS HUMANOS no lista ni el contenido.
 *   · Repetible: identifica archivos por id + content_hash. No duplica; si el
 *     contenido cambió, lo reemplaza y marca «cambió después de publicarse».
 *   · Todo lo nuevo nace pendiente (además lo fuerza la base).
 */
import {
  classifyAreaFolder,
  classifyFile,
  areaOf,
  isForbiddenFileName,
  suggestPeriod,
  type PortalArea,
  type RejectReason,
} from "./dropboxFilter.ts";

export interface SyncEntry {
  kind: "file" | "folder";
  /** id estable de Dropbox («id:…»). */
  id: string;
  name: string;
  pathDisplay: string;
  rev?: string;
  contentHash?: string;
  size?: number;
  isDownloadable?: boolean;
}

export interface SyncSource {
  /** Hijos directos de una carpeta (por id o ruta). */
  listChildren(folder: string): Promise<SyncEntry[]>;
  /** Todo lo que cuelga de una carpeta (por id o ruta), recursivo. */
  listRecursive(folder: string): Promise<SyncEntry[]>;
  download(fileId: string): Promise<Uint8Array>;
}

export interface MappedFolder {
  folderRowId: string;
  dropboxFolderId: string;
  pathDisplay: string;
  clientId: string;
  organizationId: string;
}

export interface ExistingDoc {
  id: string;
  dropboxFileId: string;
  contentHash: string | null;
  sourcePath: string | null;
  status: "pendiente" | "publicado" | "despublicado";
}

export interface NewDocument {
  organizationId: string;
  clientId: string;
  folderRowId: string;
  area: PortalArea;
  entry: SyncEntry;
  storagePath: string;
  suggestedYear: number | null;
  suggestedMonth: number | null;
}

export interface SyncSink {
  existingDocs(clientId: string): Promise<ExistingDoc[]>;
  createDocument(doc: NewDocument, bytes: Uint8Array): Promise<void>;
  replaceContent(existing: ExistingDoc, doc: NewDocument, bytes: Uint8Array): Promise<void>;
  updatePath(existing: ExistingDoc, newPath: string): Promise<void>;
}

export interface Rejected {
  path: string;
  reason: RejectReason;
}

export interface ClientPlan {
  folder: MappedFolder;
  create: NewDocument[];
  replace: { existing: ExistingDoc; doc: NewDocument }[];
  move: { existing: ExistingDoc; newPath: string }[];
  unchanged: number;
  rejected: Rejected[];
}

export function sanitizeStorageName(name: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+/, "");
  return cleaned.slice(-120) || "archivo";
}

export function storagePathFor(orgId: string, clientId: string, area: PortalArea, entry: SyncEntry): string {
  const fid = entry.id.replace(/^id:/, "").replace(/[^A-Za-z0-9_-]/g, "");
  return `${orgId}/${clientId}/${area}/${fid}/${sanitizeStorageName(entry.name)}`;
}

/** Segmentos de la ruta por debajo de la carpeta de área (para sugerir periodo). */
function segmentsBelow(areaPath: string, filePath: string): string[] {
  const rel = filePath.slice(areaPath.length).replace(/^\/+/, "");
  const parts = rel.split("/");
  parts.pop();
  return parts;
}

export async function planClientFolder(source: SyncSource, sink: SyncSink, folder: MappedFolder): Promise<ClientPlan> {
  const plan: ClientPlan = { folder, create: [], replace: [], move: [], unchanged: 0, rejected: [] };
  const existing = await sink.existingDocs(folder.clientId);
  const byId = new Map(existing.map((d) => [d.dropboxFileId, d]));

  const top = await source.listChildren(folder.dropboxFolderId);
  for (const child of top) {
    if (child.kind === "file") {
      plan.rejected.push({ path: child.pathDisplay, reason: "fuera_de_area" });
      continue;
    }
    const verdict = classifyAreaFolder(child.name);
    if (!verdict.accept) {
      // No se lista NADA de dentro: ni ADMINISTRATIVO ni las áreas de subida expresa.
      plan.rejected.push({ path: child.pathDisplay, reason: verdict.reason! });
      continue;
    }
    const area = areaOf(child.name) as PortalArea;
    const inside = await source.listRecursive(child.id);
    for (const e of inside) {
      if (e.kind !== "file") continue;
      // Defensa en profundidad: aunque el origen devolviera algo raro.
      if (/\/administrativ[oa]\//i.test(e.pathDisplay + "/") || isForbiddenFileName(e.name)) {
        plan.rejected.push({ path: e.pathDisplay, reason: isForbiddenFileName(e.name) ? "credencial" : "area_prohibida" });
        continue;
      }
      const fv = classifyFile({ name: e.name, size: e.size, isDownloadable: e.isDownloadable });
      if (!fv.accept) {
        plan.rejected.push({ path: e.pathDisplay, reason: fv.reason! });
        continue;
      }
      const period = suggestPeriod(segmentsBelow(child.pathDisplay, e.pathDisplay));
      const doc: NewDocument = {
        organizationId: folder.organizationId,
        clientId: folder.clientId,
        folderRowId: folder.folderRowId,
        area,
        entry: e,
        storagePath: storagePathFor(folder.organizationId, folder.clientId, area, e),
        suggestedYear: period.year,
        suggestedMonth: period.month,
      };
      const prev = byId.get(e.id);
      if (!prev) {
        plan.create.push(doc);
      } else if (e.contentHash && prev.contentHash && e.contentHash !== prev.contentHash) {
        plan.replace.push({ existing: prev, doc });
      } else if (prev.sourcePath !== e.pathDisplay) {
        plan.move.push({ existing: prev, newPath: e.pathDisplay });
      } else {
        plan.unchanged += 1;
      }
    }
  }
  return plan;
}

export interface SyncStats {
  clients: number;
  created: number;
  replaced: number;
  moved: number;
  unchanged: number;
  rejected: number;
  errors: { path: string; error: string }[];
}

export async function runSync(
  source: SyncSource,
  sink: SyncSink,
  folders: MappedFolder[],
): Promise<{ stats: SyncStats; rejected: Rejected[] }> {
  const stats: SyncStats = { clients: 0, created: 0, replaced: 0, moved: 0, unchanged: 0, rejected: 0, errors: [] };
  const rejected: Rejected[] = [];
  for (const folder of folders) {
    stats.clients += 1;
    const plan = await planClientFolder(source, sink, folder);
    rejected.push(...plan.rejected);
    stats.rejected += plan.rejected.length;
    stats.unchanged += plan.unchanged;
    for (const doc of plan.create) {
      try {
        await sink.createDocument(doc, await source.download(doc.entry.id));
        stats.created += 1;
      } catch (err) {
        stats.errors.push({ path: doc.entry.pathDisplay, error: String((err as Error)?.message ?? err) });
      }
    }
    for (const { existing, doc } of plan.replace) {
      try {
        await sink.replaceContent(existing, doc, await source.download(doc.entry.id));
        stats.replaced += 1;
      } catch (err) {
        stats.errors.push({ path: doc.entry.pathDisplay, error: String((err as Error)?.message ?? err) });
      }
    }
    for (const { existing, newPath } of plan.move) {
      await sink.updatePath(existing, newPath);
      stats.moved += 1;
    }
  }
  return { stats, rejected };
}

/** Carpetas de cliente bajo la raíz (para la pantalla de mapeo), con posibles duplicados. */
export async function discoverClientFolders(source: SyncSource, root: string) {
  const children = (await source.listChildren(root)).filter((e) => e.kind === "folder");
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  const counts = new Map<string, number>();
  for (const c of children) counts.set(norm(c.name), (counts.get(norm(c.name)) ?? 0) + 1);
  return children.map((c) => ({
    dropboxFolderId: c.id,
    name: c.name,
    pathDisplay: c.pathDisplay,
    possibleDuplicate: (counts.get(norm(c.name)) ?? 0) > 1 || /\((conflicted copy|copia en conflicto)/i.test(c.name),
  }));
}
