import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { portalDb, portalApi } from "@/lib/portalAdmin";
import { ClientPicker, Section, date, money, useClients } from "./shared";

interface Row { id: string; uuid: string; nombre_emisor: string | null; rfc_emisor: string | null; descripcion: string | null; total: number | null; fecha: string | null; category_status: string; category_name: string | null; suggested_category_id: string | null; suggested_category_name: string | null; suggestion_model: string | null; clients?: { name: string } }
interface Cat { id: string; name: string }

export default function FacturasTab() {
  const clients = useClients();
  const [rows, setRows] = useState<Row[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [imp, setImp] = useState({ client: "", project: "", desde: "", hasta: "" });
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data }, { data: c }] = await Promise.all([
      portalDb.from("portal_cfdi_v").select("id, uuid, nombre_emisor, rfc_emisor, descripcion, total, fecha, category_status, category_name, suggested_category_id, suggested_category_name, suggestion_model")
        .eq("direction", "recibida").neq("category_status", "confirmada").order("fecha", { ascending: false }).limit(100),
      portalDb.from("portal_expense_categories").select("id, name").eq("active", true).order("name"),
    ]);
    setRows((data as Row[]) ?? []);
    setCats((c as Cat[]) ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!imp.client) return setProjects([]);
    portalDb.from("projects").select("id, name").eq("client_id", imp.client).then(({ data }) => setProjects((data as typeof projects) ?? []));
  }, [imp.client]);

  const confirmOne = async (r: Row) => {
    const cat = chosen[r.id] ?? r.suggested_category_id ?? "";
    if (!cat) return toast.error("Elija una categoría.");
    const { error } = await portalDb.rpc("portal_staff_confirm_category", { _cfdi_ids: [r.id], _category_id: cat });
    if (error) toast.error(error.message); else await load();
  };

  return (
    <div className="space-y-4">
      <Section title="Categorías por confirmar" desc="Tres pasos: regla automática → sugerencia del modelo (vía openclaw-gateway) → confirmación de una persona de Kawiil. Nada queda definitivo solo por el modelo.">
        <Button size="sm" variant="outline" disabled={busy || rows.length === 0} onClick={async () => {
          setBusy(true);
          try { const r = await portalApi.call<{ sugeridas: number; apagado?: boolean; motivo?: string }>("central/categorias.sugerir", { cfdi_ids: rows.map((x) => x.id) }); toast.message(r.apagado ? `Sugerencias apagadas: ${r.motivo}` : `Sugeridas: ${r.sugeridas}`); await load(); }
          catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
        }}>Pedir sugerencias al modelo</Button>
        <ul className="mt-3 space-y-1 text-sm">{rows.map((r) => (
          <li key={r.id} className="grid gap-2 rounded-md border p-2 md:grid-cols-[1fr_8rem_14rem_auto] md:items-center">
            <span><strong>{r.nombre_emisor ?? r.rfc_emisor}</strong> · {r.descripcion ?? "—"} <span className="text-xs text-muted-foreground">{date(r.fecha)}</span>
              {r.category_status === "regla" && <Badge variant="outline" className="ml-1">Regla: {r.category_name}</Badge>}
              {r.suggested_category_name && <Badge variant="outline" className="ml-1">Sugerencia ({r.suggestion_model}): {r.suggested_category_name}</Badge>}</span>
            <span className="font-mono">{money(r.total)}</span>
            <select aria-label="Categoría" className="h-9 rounded-md border px-2" value={chosen[r.id] ?? r.suggested_category_id ?? ""} onChange={(e) => setChosen({ ...chosen, [r.id]: e.target.value })}>
              <option value="">Elija…</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button size="sm" onClick={() => confirmOne(r)}>Confirmar</Button>
          </li>))}
        </ul>
      </Section>
      <Section title="Traer facturas con Moffin" desc="Usa la consulta existente (moffin-facturas, con la CIEC que Moffin custodia) y guarda el detalle en el portal sin duplicar por UUID. Requiere que el cliente tenga credenciales vinculadas.">
        <div className="grid gap-2 md:grid-cols-5 md:items-end">
          <div className="md:col-span-2"><ClientPicker id="mf-cl" value={imp.client} onChange={(v) => setImp({ ...imp, client: v, project: "" })} clients={clients} /></div>
          <label className="text-sm">Proyecto<select className="h-9 w-full rounded-md border px-2" value={imp.project} onChange={(e) => setImp({ ...imp, project: e.target.value })}><option value="">—</option>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="text-sm">Desde<Input type="date" value={imp.desde} onChange={(e) => setImp({ ...imp, desde: e.target.value })} /></label>
          <label className="text-sm">Hasta<Input type="date" value={imp.hasta} onChange={(e) => setImp({ ...imp, hasta: e.target.value })} /></label>
        </div>
        <Button className="mt-2" size="sm" disabled={busy || !imp.project || !imp.desde || !imp.hasta} onClick={async () => {
          setBusy(true);
          try {
            const { data, error } = await portalDb.functions.invoke("moffin-facturas", { body: { projectId: imp.project, startdate: imp.desde, enddate: imp.hasta } });
            if (error) throw new Error("Moffin no respondió. Revise que el cliente tenga CIEC vinculada.");
            const { data: r, error: e2 } = await portalDb.rpc("portal_staff_import_moffin_cfdi", { _client_id: imp.client, _cfdis: data?.cfdis ?? [] });
            if (e2) throw new Error(e2.message);
            toast.success(`Nuevas ${r.nuevas} · actualizadas ${r.actualizadas} · omitidas ${r.omitidas}`);
            await load();
          } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
        }}>Importar</Button>
      </Section>
    </div>
  );
}
