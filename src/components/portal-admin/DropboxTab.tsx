import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { portalDb } from "@/lib/portalAdmin";
import { ClientPicker, Section, date, useClients } from "./shared";

interface Folder { id: string; name: string; path_display: string; client_id: string | null; ignored: boolean; mapped_at: string | null; last_synced_at: string | null; clients: { name: string } | null }
interface Run { id: string; mode: string; started_at: string; finished_at: string | null; stats: Record<string, unknown>; error: string | null }

export default function DropboxTab() {
  const clients = useClients();
  const [folders, setFolders] = useState<Folder[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: f }, { data: r }] = await Promise.all([
      portalDb.from("portal_dropbox_folders").select("*, clients(name)").order("name"),
      portalDb.from("portal_sync_runs").select("*").order("started_at", { ascending: false }).limit(10),
    ]);
    setFolders((f as Folder[]) ?? []);
    setRuns((r as Run[]) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const invoke = async (action: string) => {
    setBusy(true);
    const { data, error } = await portalDb.functions.invoke("portal-dropbox-sync", { body: { action } });
    setBusy(false);
    if (error) {
      let msg = error.message;
      try { msg = (await (error as { context?: Response }).context?.json())?.message ?? msg; } catch { /* */ }
      toast.error(msg);
    } else toast.success(action === "descubrir" ? `Carpetas encontradas: ${data?.carpetas ?? 0}` : "Sincronización terminada");
    await load();
  };

  const shown = folders.filter((f) => !q || f.name.toLowerCase().includes(q.toLowerCase()));
  const unmapped = folders.filter((f) => !f.client_id && !f.ignored).length;

  return (
    <div className="space-y-4">
      <Section title="Mapeo de carpetas de Dropbox" desc="El vínculo carpeta ↔ cliente lo fija una persona, una vez. El nombre de la carpeta no vincula por sí solo. Solo se leen FISCAL y CONTABILIDAD; ADMINISTRATIVO nunca se lee.">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => invoke("descubrir")}>Buscar carpetas en Dropbox</Button>
          <Button size="sm" disabled={busy} onClick={() => invoke("sincronizar")}>Sincronizar ahora</Button>
          <Input className="max-w-xs" placeholder="Filtrar carpetas" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filtrar carpetas" />
          <Badge variant="outline">{unmapped} sin vincular</Badge>
        </div>
        <ul className="mt-3 space-y-1 text-sm">{shown.map((f) => (
          <li key={f.id} className="grid gap-2 rounded-md border p-2 md:grid-cols-[1fr_18rem_auto] md:items-center">
            <span><strong>{f.name}</strong> <span className="text-xs text-muted-foreground">{f.path_display}</span>{f.last_synced_at && <span className="text-xs text-muted-foreground"> · sincronizada {date(f.last_synced_at)}</span>}</span>
            {f.client_id ? <span>Vinculada a <strong>{f.clients?.name}</strong> ({date(f.mapped_at)})</span> : (
              <ClientPicker id={`m-${f.id}`} label="Vincular con" value={pick[f.id] ?? ""} onChange={(v) => setPick({ ...pick, [f.id]: v })} clients={clients} />
            )}
            <span className="flex gap-1">
              {f.client_id
                ? <Button size="sm" variant="ghost" onClick={async () => { if (!confirm("¿Desvincular? Los documentos ya traídos se conservan.")) return; const { error } = await portalDb.rpc("portal_staff_map_folder", { _folder_id: f.id, _client_id: null }); if (error) toast.error(error.message); else await load(); }}>Desvincular</Button>
                : <>
                    <Button size="sm" disabled={!pick[f.id]} onClick={async () => { const { error } = await portalDb.rpc("portal_staff_map_folder", { _folder_id: f.id, _client_id: pick[f.id] }); if (error) toast.error(error.message); else { toast.success("Vinculada"); await load(); } }}>Vincular</Button>
                    <Button size="sm" variant="ghost" onClick={async () => { await portalDb.rpc("portal_staff_ignore_folder", { _folder_id: f.id, _ignored: !f.ignored }); await load(); }}>{f.ignored ? "Dejar de ignorar" : "Ignorar (duplicado)"}</Button>
                  </>}
            </span>
          </li>))}
        </ul>
      </Section>
      <Section title="Últimas corridas">
        <ul className="space-y-1 text-sm">{runs.map((r) => (
          <li key={r.id}>{date(r.started_at)} · {r.mode} · {r.error ? <span className="text-destructive">{r.error}</span> : <span className="font-mono text-xs">{JSON.stringify(r.stats)}</span>}</li>))}
        </ul>
      </Section>
    </div>
  );
}
