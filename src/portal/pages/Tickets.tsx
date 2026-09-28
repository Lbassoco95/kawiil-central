import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortal } from "../lib/session";
import { db } from "../lib/supabase";
import { openFile } from "../lib/api";
import { prepareTicketFile, safeName } from "../lib/files";
import { fmtDate, fmtMoney } from "../lib/format";
import { Empty, Notice, PageTitle, StatusPill } from "../components/ui";
import { ticketDeadline, ticketFileProblem, VISIBLE_STATUS_LABEL, type MerchantWindow, type VisibleTicketStatus } from "../../../supabase/functions/_shared/portal/tickets.ts";

interface Merchant extends MerchantWindow { id: string; name: string; slug: string }
interface Ticket { id: string; merchant_name: string | null; receipt_date: string | null; folio: string | null; total: number | null; expires_at: string | null; visible_status: VisibleTicketStatus; team_note: string | null; cfdi_uuid: string | null; created_at: string }
const TONE: Record<VisibleTicketStatus, "info" | "wait" | "ok" | "warn" | "bad"> = { recibido: "info", en_proceso: "wait", facturado: "ok", con_problema: "warn", vencido: "bad" };

export default function Tickets() {
  const { active } = usePortal();
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [f, setF] = useState({ merchant: "", otro: "", fecha: "", folio: "", total: "" });
  const [notices, setNotices] = useState<{ tone: "ok" | "bad" | "warn"; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  const canUpload = active?.role !== "consulta";

  const load = useCallback(async () => {
    if (!active) return;
    const { data } = await db.from("portal_tickets_v").select("*").eq("client_id", active.client_id).order("created_at", { ascending: false }).limit(100);
    setTickets((data as Ticket[]) ?? []);
  }, [active]);
  useEffect(() => {
    db.from("fis_merchants").select("id, name, slug, window_type, window_days").eq("active", true).order("name").then(({ data }) => setMerchants((data as Merchant[]) ?? []));
    void load();
  }, [load]);

  const merchant = merchants.find((m) => m.id === f.merchant) ?? null;
  const preview = merchant && f.fecha ? ticketDeadline(merchant, f.fecha) : null;
  const previewExpired = preview ? preview < new Date() : false;

  const pick = (list: FileList | null) => {
    const arr = [...(list ?? [])];
    const problems = arr.map(ticketFileProblem).filter(Boolean) as string[];
    setNotices(problems.map((text) => ({ tone: "bad" as const, text })));
    setFiles(arr.filter((x) => !ticketFileProblem(x)));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active || files.length === 0) return;
    setBusy(true);
    const out: { tone: "ok" | "bad" | "warn"; text: string }[] = [];
    const { data: org } = await db.rpc("portal_client_org_id", { _client_id: active.client_id });
    for (const file of files) {
      try {
        const p = await prepareTicketFile(file);
        const d = new Date();
        const path = `${org}/juun/clients/${active.client_id}/${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/receipts/${Date.now()}_${safeName(p.name)}`;
        const up = await db.storage.from("juun").upload(path, p.blob, { contentType: p.type, upsert: false });
        if (up.error) throw new Error("No se pudo subir el archivo.");
        const { data, error } = await db.rpc("portal_ticket_register", {
          _client_id: active.client_id, _file_path: path, _file_hash: p.hash, _merchant_id: f.merchant || null,
          _merchant_name: f.merchant ? null : f.otro || null, _receipt_date: f.fecha || null, _folio: f.folio || null, _total: f.total ? Number(f.total) : null,
        });
        if (error) throw new Error(error.message);
        const r = data as { duplicate: boolean; expired?: boolean; message: string };
        out.push({ tone: r.expired ? "warn" : r.duplicate ? "warn" : "ok", text: `${file.name}: ${r.message}` });
      } catch (err) {
        out.push({ tone: "bad", text: `${file.name}: ${(err as Error).message}` });
      }
    }
    setNotices(out);
    setFiles([]);
    setBusy(false);
    await load();
  };

  if (!active?.tickets_enabled) return <Notice tone="info">La facturación de tickets es un servicio adicional. Escríbanos en «Mensajes» para contratarlo.</Notice>;

  return (
    <>
      <PageTitle title="Tickets" subtitle="Fotografíe sus tickets y el equipo de Kawiil los factura antes de que venza el plazo del comercio." />
      {canUpload && (
        <form onSubmit={submit} className="mb-6 space-y-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap gap-2">
            <input ref={cam} type="file" accept="image/*" capture="environment" className="sr-only" id="t-cam" onChange={(e) => pick(e.target.files)} />
            <input ref={gal} type="file" accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif,application/pdf" multiple className="sr-only" id="t-gal" onChange={(e) => pick(e.target.files)} />
            <Button type="button" onClick={() => cam.current?.click()}>Tomar foto</Button>
            <Button type="button" variant="outline" onClick={() => gal.current?.click()}>Elegir de la galería o PDF</Button>
          </div>
          <p className="text-xs text-muted-foreground">JPG, PNG, HEIC o PDF, hasta 10 MB cada uno. Puede elegir varios. Las fotos HEIC se convierten a JPEG en su teléfono antes de subir.</p>
          {files.length > 0 && <p className="text-sm">Listos para subir: {files.map((x) => x.name).join(", ")}</p>}
          <div className="grid gap-2 md:grid-cols-5">
            <div className="md:col-span-2"><Label htmlFor="t-com">Comercio</Label>
              <select id="t-com" className="h-10 w-full rounded-md border px-2" value={f.merchant} onChange={(e) => setF({ ...f, merchant: e.target.value })}>
                <option value="">Otro / no lo sé</option>
                {merchants.filter((m) => m.window_type !== "not_applicable" && m.slug !== "generico_qr").map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select></div>
            {!f.merchant && <div><Label htmlFor="t-otro">Nombre del comercio</Label><Input id="t-otro" value={f.otro} onChange={(e) => setF({ ...f, otro: e.target.value })} /></div>}
            <div><Label htmlFor="t-fecha">Fecha del ticket</Label><Input id="t-fecha" type="date" value={f.fecha} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></div>
            <div><Label htmlFor="t-folio">Folio</Label><Input id="t-folio" className="kw-mono" value={f.folio} onChange={(e) => setF({ ...f, folio: e.target.value })} /></div>
            <div><Label htmlFor="t-total">Total</Label><Input id="t-total" inputMode="decimal" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Las casetas no se facturan por ticket.</p>
          {preview && <Notice tone={previewExpired ? "warn" : "info"}>{previewExpired ? `El plazo de ${merchant!.name} para este ticket venció el ${fmtDate(preview)}. Puede subirlo, pero probablemente ya no se pueda facturar.` : `Fecha límite para facturarlo: ${fmtDate(preview)}.`}</Notice>}
          <Button type="submit" disabled={busy || files.length === 0}>{busy ? "Subiendo…" : "Enviar tickets"}</Button>
        </form>
      )}
      <div aria-live="polite" className="mb-4 space-y-2">{notices.map((n, i) => <Notice key={i} tone={n.tone}>{n.text}</Notice>)}</div>
      {tickets.length === 0 ? <Empty>Aún no ha subido tickets.</Empty> : (
        <ul className="space-y-2">{tickets.map((t) => (
          <li key={t.id} className="rounded-lg border bg-card p-3">
            <div className="flex flex-wrap justify-between gap-2">
              <div><p className="font-medium">{t.merchant_name ?? "Comercio por identificar"}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(t.receipt_date)}{t.folio ? ` · folio ${t.folio}` : ""} · límite {fmtDate(t.expires_at)}</p></div>
              <div className="text-right"><p className="kw-mono">{fmtMoney(t.total)}</p><StatusPill tone={TONE[t.visible_status]}>{VISIBLE_STATUS_LABEL[t.visible_status]}</StatusPill></div>
            </div>
            {t.team_note && <p className="mt-1 text-sm">Nota del equipo: {t.team_note}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => openFile("ticket", t.id)}>Ver ticket</Button>
              {t.cfdi_uuid && <><Button size="sm" variant="outline" onClick={() => openFile("ticket_cfdi_xml", t.id)}>XML</Button><Button size="sm" variant="outline" onClick={() => openFile("ticket_cfdi_pdf", t.id)}>PDF</Button></>}
            </div>
          </li>))}
        </ul>
      )}
    </>
  );
}
