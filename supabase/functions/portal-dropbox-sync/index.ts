/**
 * portal-dropbox-sync — Dropbox (Kawiil Mx/CLIENTES) → bucket privado `portal`.
 *
 * Usa una app de Dropbox PROPIA del portal (no el token del equipo) con acceso
 * limitado a la carpeta de clientes. Configuración (Edge secrets, RUNBOOK §2):
 *   PORTAL_DROPBOX_APP_KEY, PORTAL_DROPBOX_APP_SECRET, PORTAL_DROPBOX_REFRESH_TOKEN,
 *   PORTAL_DROPBOX_ROOT (por defecto "/Kawiil Mx/CLIENTES"),
 *   PORTAL_DROPBOX_PATH_ROOT (opcional: id de namespace si la carpeta vive en el espacio de equipo).
 * Sin esas variables responde 503 y no hace nada.
 *
 * Acciones (body.action):
 *   · "descubrir"   → lista las carpetas de cliente y las registra SIN vincular.
 *   · "sincronizar" → corre el motor (_shared/portal/dropboxSync.ts) sobre las
 *                     carpetas que una persona ya vinculó. Todo entra «pendiente».
 * Quién: staff G3/G4 (JWT) o cron (x-cron-secret).
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders, cronAllowed, json } from "../_shared/portal/http.ts";
import {
  discoverClientFolders, runSync, type ExistingDoc, type MappedFolder, type NewDocument, type SyncEntry, type SyncSink, type SyncSource,
} from "../_shared/portal/dropboxSync.ts";

const MIME: Record<string, string> = {
  pdf: "application/pdf", xml: "application/xml", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", heic: "image/heic", webp: "image/webp",
};
const mimeOf = (name: string) => MIME[name.toLowerCase().split(".").pop() ?? ""] ?? "application/octet-stream";

async function dropboxToken(): Promise<string | null> {
  const key = Deno.env.get("PORTAL_DROPBOX_APP_KEY");
  const secret = Deno.env.get("PORTAL_DROPBOX_APP_SECRET");
  const refresh = Deno.env.get("PORTAL_DROPBOX_REFRESH_TOKEN");
  if (!key || !secret || !refresh) return null;
  const res = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${key}:${secret}`)}` },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Dropbox token: ${j.error_description ?? res.status}`);
  return j.access_token;
}

function dropboxSource(token: string): SyncSource {
  const pathRoot = Deno.env.get("PORTAL_DROPBOX_PATH_ROOT");
  const headers = (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${token}`,
    ...(pathRoot ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "namespace_id", namespace_id: pathRoot }) } : {}),
    ...extra,
  });
  const toEntry = (e: Record<string, unknown>): SyncEntry => ({
    kind: e[".tag"] === "folder" ? "folder" : "file",
    id: String(e.id),
    name: String(e.name),
    pathDisplay: String(e.path_display),
    rev: e.rev as string | undefined,
    contentHash: e.content_hash as string | undefined,
    size: e.size as number | undefined,
    isDownloadable: e.is_downloadable as boolean | undefined,
  });
  async function list(path: string, recursive: boolean): Promise<SyncEntry[]> {
    const out: SyncEntry[] = [];
    let res = await fetch("https://api.dropboxapi.com/2/files/list_folder", {
      method: "POST", headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ path, recursive, include_non_downloadable_files: true, limit: 2000 }),
    });
    for (;;) {
      const j = await res.json();
      if (!res.ok) throw new Error(`Dropbox list_folder: ${j.error_summary ?? res.status}`);
      for (const e of j.entries ?? []) if (e[".tag"] !== "deleted") out.push(toEntry(e));
      if (!j.has_more) break;
      res = await fetch("https://api.dropboxapi.com/2/files/list_folder/continue", {
        method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ cursor: j.cursor }),
      });
    }
    return out;
  }
  return {
    listChildren: (folder) => list(folder, false),
    listRecursive: (folder) => list(folder, true),
    async download(fileId) {
      const res = await fetch("https://content.dropboxapi.com/2/files/download", {
        method: "POST", headers: headers({ "Dropbox-API-Arg": JSON.stringify({ path: fileId }) }),
      });
      if (!res.ok) throw new Error(`Dropbox download ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

function supabaseSink(admin: SupabaseClient): SyncSink {
  return {
    async existingDocs(clientId) {
      const { data } = await admin.from("portal_documents").select("id, dropbox_file_id, content_hash, source_path, status")
        .eq("client_id", clientId).eq("source", "dropbox");
      return (data ?? []).map((d) => ({ id: d.id, dropboxFileId: d.dropbox_file_id, contentHash: d.content_hash, sourcePath: d.source_path, status: d.status }) as ExistingDoc);
    },
    async createDocument(doc: NewDocument, bytes) {
      const up = await admin.storage.from("portal").upload(doc.storagePath, bytes, { contentType: mimeOf(doc.entry.name), upsert: true });
      if (up.error) throw new Error(up.error.message);
      const { error } = await admin.from("portal_documents").insert({
        organization_id: doc.organizationId, client_id: doc.clientId, folder_id: doc.folderRowId, source: "dropbox", area: doc.area,
        dropbox_file_id: doc.entry.id, dropbox_rev: doc.entry.rev, content_hash: doc.entry.contentHash, source_path: doc.entry.pathDisplay,
        file_name: doc.entry.name, mime_type: mimeOf(doc.entry.name), size_bytes: doc.entry.size, storage_path: doc.storagePath,
        period_year: doc.suggestedYear, period_month: doc.suggestedMonth,
      });
      if (error) throw new Error(error.message);
    },
    async replaceContent(existing, doc, bytes) {
      const up = await admin.storage.from("portal").upload(doc.storagePath, bytes, { contentType: mimeOf(doc.entry.name), upsert: true });
      if (up.error) throw new Error(up.error.message);
      await admin.from("portal_documents").update({
        dropbox_rev: doc.entry.rev, content_hash: doc.entry.contentHash, size_bytes: doc.entry.size, source_path: doc.entry.pathDisplay,
        storage_path: doc.storagePath, changed_since_publish: existing.status === "publicado",
      }).eq("id", existing.id);
    },
    async updatePath(existing, newPath) {
      await admin.from("portal_documents").update({ source_path: newPath }).eq("id", existing.id);
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: { action?: string } = {};
  try { body = await req.json(); } catch { /* cron manda {} */ }
  const action = body.action ?? "sincronizar";

  let actor: string | null = null;
  let orgId: string | null = null;
  if (!cronAllowed(req)) {
    const token = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(\S+)/i)?.[1];
    const { data } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    if (!data?.user) return json({ error: "no_autorizado" }, 401);
    const { data: ok } = await admin.rpc("portal_is_staff", { _uid: data.user.id });
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: isAdmin } = await user.rpc("portal_is_staff_admin", { _uid: data.user.id });
    if (!ok || !isAdmin) return json({ error: "sin_permiso", message: "Solo G3/G4." }, 403);
    actor = data.user.id;
    const { data: p } = await admin.from("profiles").select("organization_id").eq("user_id", actor).single();
    orgId = p?.organization_id ?? null;
  } else {
    const { data: cfg } = await admin.from("portal_config").select("basic_organization_id").single();
    orgId = cfg?.basic_organization_id ?? null;
  }

  let token: string | null;
  try { token = await dropboxToken(); } catch (err) { return json({ error: "dropbox", message: String((err as Error).message) }, 502); }
  if (!token) return json({ error: "no_configurado", message: "La app de Dropbox del portal no está configurada (PORTAL_DROPBOX_*)." }, 503);
  const source = dropboxSource(token);
  const root = Deno.env.get("PORTAL_DROPBOX_ROOT") ?? "/Kawiil Mx/CLIENTES";

  const { data: run } = await admin.from("portal_sync_runs").insert({ organization_id: orgId, mode: action === "descubrir" ? "descubrimiento" : "dropbox", triggered_by: actor }).select("id").single();
  try {
    if (action === "descubrir") {
      const found = await discoverClientFolders(source, root);
      for (const f of found) {
        await admin.from("portal_dropbox_folders").upsert(
          { organization_id: orgId, dropbox_folder_id: f.dropboxFolderId, path_display: f.pathDisplay, name: f.name, last_seen_at: new Date().toISOString() },
          { onConflict: "dropbox_folder_id" },
        );
      }
      const stats = { carpetas: found.length, posibles_duplicados: found.filter((f) => f.possibleDuplicate).length };
      await admin.from("portal_sync_runs").update({ finished_at: new Date().toISOString(), stats }).eq("id", run!.id);
      return json(stats);
    }
    const { data: rows } = await admin.from("portal_dropbox_folders").select("id, dropbox_folder_id, path_display, client_id, organization_id")
      .not("client_id", "is", null).eq("ignored", false);
    const folders: MappedFolder[] = (rows ?? []).map((r) => ({
      folderRowId: r.id, dropboxFolderId: r.dropbox_folder_id, pathDisplay: r.path_display, clientId: r.client_id!, organizationId: r.organization_id,
    }));
    const { stats, rejected } = await runSync(source, supabaseSink(admin), folders);
    await admin.from("portal_dropbox_folders").update({ last_synced_at: new Date().toISOString() }).in("id", folders.map((f) => f.folderRowId));
    await admin.from("portal_sync_runs").update({ finished_at: new Date().toISOString(), stats, rejected: rejected.slice(0, 1000) }).eq("id", run!.id);
    await admin.rpc("portal_audit", { _action: "dropbox_sincronizacion", _client_id: null, _entity_type: "portal_sync_runs", _entity_id: run!.id, _details: stats, _actor: actor });
    return json({ stats, rechazados: rejected.length });
  } catch (err) {
    await admin.from("portal_sync_runs").update({ finished_at: new Date().toISOString(), error: String((err as Error).message).slice(0, 1000) }).eq("id", run!.id);
    return json({ error: "sincronizacion", message: String((err as Error).message) }, 500);
  }
});
