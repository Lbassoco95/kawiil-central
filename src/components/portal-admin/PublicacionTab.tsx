import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { portalDb, portalApi } from "@/lib/portalAdmin";
import { ClientPicker, Section, date, useClients } from "./shared";

interface Doc {
  id: string; client_id: string; area: string; source: string; file_name: string; source_path: string | null; status: string; title: string | null;
  doc_type: string | null; period_year: number | null; period_month: number | null; changed_since_publish: boolean; created_at: string; published_at: string | null;
  clients: { name: string } | null;
}
const TYPES = [["declaracion", "Declaración"], ["pago", "Pago"], ["opinion_cumplimiento", "Opinión de cumplimiento"], ["constancia", "Constancia"], ["estado_financiero", "Estado financiero"], ["contrato", "Contrato"], ["otro", "Otro"]];

export default function PublicacionTab() {
  const clients = useClients();
  const [status, setStatus] = useState("pendiente");
  const [client, setClient] = useState("");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [edit, setEdit] = useState<Record<string, { title: string; type: string; year: string; month: string }>>({});
  const [up, setUp] = useState<{ client: string; area: string; file: File | null }>({ client: "", area: "LEGAL", file: null });

  const load = useCallback(async () => {
    let q = portalDb.from("portal_documents").select("*, clients(name)").eq("status", status).order("created_at", { ascending: false }).limit(200);
    if (client) q = q.eq("client_id", client);
    const { data } = await q;
    setDocs((data as Doc[]) ?? []);
  }, [status, client]);
  useEffect(() => { void load(); }, [load]);

  const publish = async (d: Doc) => {
    const e = edit[d.id] ?? { title: d.title ?? "", type: d.doc_type ?? "", year: String(d.period_year ?? ""), month: String(d.period_month ?? "") };
    const { error } = await portalDb.rpc("portal_staff_publish_document", { _document_id: d.id, _title: e.title, _doc_type: e.type, _period_year: Number(e.year), _period_month: e.month ? Number(e.month) : null });
    if (error) toast.error(error.message); else { toast.success("Publicado: el cliente ya lo ve y recibe un aviso"); await load(); }
  };

  return (
    <div className="space-y-4">
      <Section title="Publicación de documentos" desc="Todo lo sincronizado desde Dropbox o subido nace «pendiente». Solo al publicarlo con título y periodo lo ve el cliente. Se puede despublicar.">
        <div className="flex flex-wrap items-end gap-2">
          <select aria-label="Estado" className="h-9 rounded-md border px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}><option value="pendiente">Pendientes</option><option value="publicado">Publicados</option><option value="despublicado">Despublicados</option></select>
          <div className="w-72"><ClientPicker value={client} onChange={setClient} clients={clients} label="Filtrar por cliente" /></div>
        </div>
        <ul className="mt-3 space-y-2">{docs.map((d) => {
          const e = edit[d.id] ?? { title: d.title ?? "", type: d.doc_type ?? "", year: String(d.period_year ?? ""), month: String(d.period_month ?? "") };
          const setE = (p: Partial<typeof e>) => setEdit({ ...edit, [d.id]: { ...e, ...p } });
          return (
            <li key={d.id} className="rounded-md border p-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span><strong>{d.clients?.name}</strong> · {d.area} · {d.file_name} <span className="text-xs text-muted-foreground">{d.source_path ?? "subida manual"} · {date(d.created_at)}</span>
                  {d.changed_since_publish && <Badge variant="destructive" className="ml-1">Cambió en Dropbox después de publicarse</Badge>}</span>
                <Button size="sm" variant="ghost" onClick={() => portalApi.openFile("documento", d.id)}>Ver</Button>
              </div>
              {d.status !== "publicado" ? (
                <div className="mt-2 grid gap-2 md:grid-cols-[1fr_12rem_6rem_6rem_auto] md:items-end">
                  <label>Título<Input value={e.title} onChange={(x) => setE({ title: x.target.value })} /></label>
                  <label>Tipo<select className="h-9 w-full rounded-md border px-2" value={e.type} onChange={(x) => setE({ type: x.target.value })}><option value="">—</option>{TYPES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                  <label>Año<Input inputMode="numeric" value={e.year} onChange={(x) => setE({ year: x.target.value })} /></label>
                  <label>Mes<Input inputMode="numeric" value={e.month} onChange={(x) => setE({ month: x.target.value })} /></label>
                  <Button size="sm" disabled={!e.title || !e.type || !e.year} onClick={() => publish(d)}>Publicar</Button>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-center gap-2"><span>«{d.title}» · {d.period_month ? `${d.period_month}/` : ""}{d.period_year} · publicado {date(d.published_at)}</span>
                  <Button size="sm" variant="outline" onClick={async () => { const { error } = await portalDb.rpc("portal_staff_unpublish_document", { _document_id: d.id }); if (error) toast.error(error.message); else await load(); }}>Despublicar</Button>
                  {d.changed_since_publish && <Button size="sm" onClick={() => publish(d)}>Volver a publicar la versión nueva</Button>}
                </div>
              )}
            </li>
          );
        })}</ul>
      </Section>
      <Section title="Subida expresa" desc="LEGAL y RECURSOS HUMANOS no se sincronizan en masa: entran solo así. Nunca suba e.firma, CIEC ni CSD (la base los rechaza).">
        <div className="grid gap-2 md:grid-cols-[1fr_12rem_1fr_auto] md:items-end">
          <ClientPicker id="up-cl" value={up.client} onChange={(v) => setUp({ ...up, client: v })} clients={clients} />
          <label className="text-sm">Área<select className="h-9 w-full rounded-md border px-2" value={up.area} onChange={(e) => setUp({ ...up, area: e.target.value })}>{["LEGAL", "RECURSOS_HUMANOS", "FISCAL", "CONTABILIDAD"].map((a) => <option key={a}>{a}</option>)}</select></label>
          <label className="text-sm">Archivo<Input type="file" accept=".pdf,.xml,.xlsx,.xls,.docx,.doc,.jpg,.jpeg,.png" onChange={(e) => setUp({ ...up, file: e.target.files?.[0] ?? null })} /></label>
          <Button size="sm" disabled={!up.client || !up.file} onClick={async () => {
            const { data: org } = await portalDb.rpc("portal_client_org_id", { _client_id: up.client });
            const path = `${org}/${up.client}/${up.area}/manual/${Date.now()}_${up.file!.name.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
            const r = await portalDb.storage.from("portal").upload(path, up.file!, { contentType: up.file!.type });
            if (r.error) return toast.error(r.error.message);
            const { error } = await portalDb.rpc("portal_staff_register_upload", { _client_id: up.client, _area: up.area, _storage_path: path, _file_name: up.file!.name, _mime_type: up.file!.type, _size_bytes: up.file!.size });
            if (error) toast.error(error.message); else { toast.success("Subido como pendiente de publicar"); setStatus("pendiente"); await load(); }
          }}>Subir</Button>
        </div>
      </Section>
    </div>
  );
}
