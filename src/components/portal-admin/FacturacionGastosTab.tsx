import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { portalDb, portalApi, fileToBase64 } from "@/lib/portalAdmin";
import { Section, date, money } from "./shared";

interface Row { id: string; client_name: string; merchant_id: string | null; merchant_name: string | null; receipt_date: string | null; folio: string | null; total: number | null; expires_at: string | null; hours_left: number | null; alert_24h: boolean; status: string; visible_status: string; team_note: string | null }
interface Merchant { id: string; name: string; window_type: string; window_days: number | null }
const STATUSES = [["processing", "En proceso"], ["manual_queue", "Cola manual"], ["needs_data", "Faltan datos (avisa al cliente)"], ["unknown_merchant", "Comercio desconocido"], ["portal_rejected", "Rechazado por el portal del comercio"], ["window_expired", "Vencido"], ["not_deductible", "No deducible"], ["duplicate", "Duplicado"]];

/** «Facturación de gastos»: cola de tickets del portal (no confundir con «Gastos» de Finanzas, que son reembolsos internos). */
export default function FacturacionGastosTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [closed, setClosed] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [f, setF] = useState({ merchant: "", fecha: "", folio: "", total: "", status: "", note: "" });
  const [inv, setInv] = useState<{ xml: File | null; pdf: File | null }>({ xml: null, pdf: null });

  const load = useCallback(async () => {
    const [{ data }, { data: m }] = await Promise.all([
      portalDb.rpc("portal_staff_ticket_queue", { _include_closed: closed }),
      portalDb.from("fis_merchants").select("id, name, window_type, window_days").order("name"),
    ]);
    setRows((data as Row[]) ?? []);
    setMerchants((m as Merchant[]) ?? []);
  }, [closed]);
  useEffect(() => { void load(); }, [load]);
  const current = rows.find((r) => r.id === sel) ?? null;

  return (
    <div className="space-y-4">
      <Section title="Facturación de gastos" desc="Tickets que suben los clientes, ordenados por fecha límite del comercio. La factura la genera el equipo a mano en el portal del comercio y la adjunta aquí (XML y PDF).">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />Incluir facturados y cerrados</label>
        <ul className="mt-2 space-y-1">{rows.map((r) => (
          <li key={r.id}>
            <button onClick={() => { setSel(r.id); setF({ merchant: r.merchant_id ?? "", fecha: r.receipt_date ?? "", folio: r.folio ?? "", total: r.total == null ? "" : String(r.total), status: "", note: r.team_note ?? "" }); }}
              className={`grid w-full gap-1 rounded-md border p-2 text-left text-sm md:grid-cols-[1fr_1fr_8rem_10rem_10rem] ${sel === r.id ? "border-primary bg-primary/5" : ""}`}>
              <span><strong>{r.client_name}</strong></span>
              <span>{r.merchant_name ?? "Comercio por identificar"} · {date(r.receipt_date)}{r.folio ? ` · ${r.folio}` : ""}</span>
              <span className="font-mono">{money(r.total)}</span>
              <span>{r.alert_24h ? <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-1.5 text-amber-900"><AlertTriangle className="h-3 w-3" />Faltan {r.hours_left} h</span> : `Límite ${date(r.expires_at)}`}</span>
              <span><Badge variant={r.visible_status === "vencido" || r.visible_status === "con_problema" ? "destructive" : "outline"}>{r.visible_status.replace("_", " ")}</Badge></span>
            </button>
          </li>))}
        </ul>
      </Section>
      {current && (
        <Section title={`Ticket de ${current.client_name}`}>
          <Button size="sm" variant="outline" onClick={() => portalApi.openFile("ticket", current.id)}>Ver foto del ticket</Button>
          <div className="mt-2 grid gap-2 md:grid-cols-6 md:items-end">
            <label className="text-sm md:col-span-2">Comercio<select className="h-9 w-full rounded-md border px-2" value={f.merchant} onChange={(e) => setF({ ...f, merchant: e.target.value })}><option value="">—</option>{merchants.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
            <label className="text-sm">Fecha<Input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
            <label className="text-sm">Folio<Input value={f.folio} onChange={(e) => setF({ ...f, folio: e.target.value })} /></label>
            <label className="text-sm">Total<Input value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></label>
            <label className="text-sm">Estado<select className="h-9 w-full rounded-md border px-2" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">(sin cambio)</option>{STATUSES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="text-sm md:col-span-5">Nota para el cliente<Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
            <Button size="sm" onClick={async () => {
              const { error } = await portalDb.rpc("portal_staff_ticket_update", { _receipt_id: current.id, _merchant_id: f.merchant || null, _receipt_date: f.fecha || null, _folio: f.folio || null, _total: f.total ? Number(f.total) : null, _status: f.status || null, _note: f.note || null });
              if (error) toast.error(error.message); else { toast.success("Ticket actualizado"); await load(); }
            }}>Guardar</Button>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-2 border-t pt-3">
            <label className="text-sm">XML de la factura<Input type="file" accept=".xml" onChange={(e) => setInv({ ...inv, xml: e.target.files?.[0] ?? null })} /></label>
            <label className="text-sm">PDF de la factura<Input type="file" accept=".pdf" onChange={(e) => setInv({ ...inv, pdf: e.target.files?.[0] ?? null })} /></label>
            <Button disabled={!inv.xml || !inv.pdf} onClick={async () => {
              try { await portalApi.call("central/tickets.facturar", { receipt_id: current.id, xml_base64: await fileToBase64(inv.xml!), pdf_base64: await fileToBase64(inv.pdf!) }); toast.success("Ticket facturado; el cliente recibe aviso"); setInv({ xml: null, pdf: null }); setSel(null); await load(); }
              catch (e) { toast.error((e as Error).message); }
            }}>Marcar como facturado</Button>
          </div>
        </Section>
      )}
    </div>
  );
}
