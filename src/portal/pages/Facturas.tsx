import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortal } from "../lib/session";
import { callApi, fileToBase64, openFile, PortalApiError } from "../lib/api";
import { fmtDate, fmtMoney } from "../lib/format";
import { Empty, Notice, PageTitle, StatusPill } from "../components/ui";

interface Cfdi {
  id: string; uuid: string; direction: "emitida" | "recibida"; fecha: string | null; rfc_emisor: string | null; nombre_emisor: string | null;
  rfc_receptor: string | null; nombre_receptor: string | null; total: number | null; sat_status: string; category_name: string | null;
  category_status: string; xml_path: string | null; pdf_path: string | null; is_test: boolean; flags: { code: string; reason: string }[];
}

const SAT: Record<string, { tone: "ok" | "bad" | "wait"; label: string }> = {
  vigente: { tone: "ok", label: "Vigente" }, cancelado: { tone: "bad", label: "Cancelada" }, desconocido: { tone: "wait", label: "Sin verificar" },
};

export default function Facturas() {
  const { active } = usePortal();
  const [dir, setDir] = useState<"recibida" | "emitida">("recibida");
  const [q, setQ] = useState({ desde: "", hasta: "", rfc: "", min: "", max: "", estatus: "" });
  const [rows, setRows] = useState<Cfdi[]>([]);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [cancelFor, setCancelFor] = useState<Cfdi | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canUpload = active?.role !== "consulta";

  const load = useCallback(async () => {
    if (!active) return;
    const data = await callApi<{ facturas: Cfdi[] }>("facturas.listar", { client_id: active.client_id, direction: dir, filters: q });
    setRows(data.facturas);
  }, [active, dir, q]);
  useEffect(() => { void load(); }, [load]);

  const upload = async (files: FileList | null) => {
    if (!files?.length || !active) return;
    setMsg(null);
    try {
      const payload = await Promise.all([...files].map(async (f) => ({ name: f.name, base64: await fileToBase64(f) })));
      const r = await callApi<{ results: { archivo: string; estado: string; motivo?: string }[] }>("facturas.cargar", { client_id: active.client_id, files: payload });
      const ok = r.results.filter((x) => x.estado === "cargada").length;
      const dup = r.results.filter((x) => x.estado === "duplicada").length;
      const bad = r.results.filter((x) => x.estado === "rechazada");
      setMsg({ tone: bad.length ? "warn" : "ok", text: `Cargadas: ${ok}. Ya existían: ${dup}. Rechazadas: ${bad.length}.${bad.length ? " " + bad.slice(0, 3).map((b) => `${b.archivo}: ${b.motivo}`).join(" · ") : ""}` });
      await load();
    } catch (e) {
      setMsg({ tone: "bad", text: e instanceof PortalApiError ? e.message : "No se pudieron cargar los archivos." });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <>
      <PageTitle
        title="Facturas"
        subtitle="Emitidas y recibidas. El estatus ante el SAT se actualiza cuando Kawiil consulta con sus credenciales vinculadas."
        actions={
          <div className="flex flex-wrap gap-2">
            {canUpload && (
              <>
                <input ref={fileRef} id="cfdi-files" type="file" accept=".xml,.zip,application/xml,text/xml,application/zip" multiple className="sr-only" onChange={(e) => upload(e.target.files)} />
                <Button variant="outline" onClick={() => fileRef.current?.click()}>Cargar XML o ZIP</Button>
              </>
            )}
            {active?.role === "administrador" && <Button asChild><Link to="/facturas/nueva">Crear factura</Link></Button>}
          </div>
        }
      />
      {msg && <div className="mb-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
      <div role="tablist" aria-label="Tipo de factura" className="mb-3 inline-flex rounded-lg border p-1">
        {(["recibida", "emitida"] as const).map((d) => (
          <button key={d} role="tab" aria-selected={dir === d} onClick={() => setDir(d)} className={`rounded-md px-3 py-1.5 text-sm ${dir === d ? "bg-accent text-white" : ""}`}>
            {d === "recibida" ? "Recibidas (gastos)" : "Emitidas (ingresos)"}
          </button>
        ))}
      </div>
      <fieldset className="mb-4 grid grid-cols-2 gap-2 rounded-lg border p-3 md:grid-cols-6">
        <legend className="px-1 text-sm font-medium">Filtros</legend>
        <div><Label htmlFor="f-desde">Desde</Label><Input id="f-desde" type="date" value={q.desde} onChange={(e) => setQ({ ...q, desde: e.target.value })} /></div>
        <div><Label htmlFor="f-hasta">Hasta</Label><Input id="f-hasta" type="date" value={q.hasta} onChange={(e) => setQ({ ...q, hasta: e.target.value })} /></div>
        <div><Label htmlFor="f-rfc">RFC</Label><Input id="f-rfc" className="kw-mono uppercase" value={q.rfc} onChange={(e) => setQ({ ...q, rfc: e.target.value.toUpperCase() })} /></div>
        <div><Label htmlFor="f-min">Monto mínimo</Label><Input id="f-min" inputMode="decimal" value={q.min} onChange={(e) => setQ({ ...q, min: e.target.value })} /></div>
        <div><Label htmlFor="f-max">Monto máximo</Label><Input id="f-max" inputMode="decimal" value={q.max} onChange={(e) => setQ({ ...q, max: e.target.value })} /></div>
        <div><Label htmlFor="f-est">Estatus SAT</Label>
          <select id="f-est" className="h-10 w-full rounded-md border px-2" value={q.estatus} onChange={(e) => setQ({ ...q, estatus: e.target.value })}>
            <option value="">Todos</option><option value="vigente">Vigente</option><option value="cancelado">Cancelada</option><option value="desconocido">Sin verificar</option>
          </select></div>
      </fieldset>
      {rows.length === 0 ? <Empty>No hay facturas con estos filtros.</Empty> : (
        <ul className="space-y-2">
          {rows.map((c) => (
            <li key={c.id} className="rounded-lg border bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{dir === "recibida" ? c.nombre_emisor ?? c.rfc_emisor : c.nombre_receptor ?? c.rfc_receptor}</p>
                  <p className="kw-mono text-xs text-muted-foreground">{dir === "recibida" ? c.rfc_emisor : c.rfc_receptor} · {c.uuid}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(c.fecha)} · Categoría: {c.category_status === "confirmada" ? c.category_name : "por confirmar"}</p>
                </div>
                <div className="text-right">
                  <p className="kw-mono text-lg">{fmtMoney(c.total)}</p>
                  <StatusPill tone={SAT[c.sat_status]?.tone ?? "wait"}>{SAT[c.sat_status]?.label ?? c.sat_status}</StatusPill>
                  {c.is_test && <span className="ml-1"><StatusPill tone="warn">Prueba sin validez fiscal</StatusPill></span>}
                </div>
              </div>
              {c.flags?.map((f) => <p key={f.code} className="mt-1 text-xs"><StatusPill tone="warn">Atención</StatusPill> {f.reason}</p>)}
              <div className="mt-2 flex flex-wrap gap-2">
                {c.xml_path && <Button size="sm" variant="outline" onClick={() => openFile("cfdi_xml", c.id)}>XML</Button>}
                {c.pdf_path && <Button size="sm" variant="outline" onClick={() => openFile("cfdi_pdf", c.id)}>PDF</Button>}
                {dir === "emitida" && active?.role === "administrador" && c.sat_status !== "cancelado" && !c.is_test && (
                  <Button size="sm" variant="ghost" onClick={() => setCancelFor(c)}>Solicitar cancelación</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {cancelFor && <CancelDialog cfdi={cancelFor} onClose={() => setCancelFor(null)} />}
    </>
  );
}

function CancelDialog({ cfdi, onClose }: { cfdi: Cfdi; onClose: () => void }) {
  const [motivo, setMotivo] = useState("02");
  const [folio, setFolio] = useState("");
  const [nota, setNota] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const send = async () => {
    try {
      await callApi("facturas.solicitar_cancelacion", { cfdi_id: cfdi.id, motivo, folio_sustitucion: folio || null, comment: nota || null });
      setMsg({ tone: "ok", text: "Solicitud enviada. Kawiil la revisa y ejecuta la cancelación; le avisaremos." });
    } catch (error) { setMsg({ tone: "bad", text: (error as Error).message }); }
  };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="cancel-t" className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5">
        <h2 id="cancel-t" className="text-xl">Solicitar cancelación</h2>
        <p className="kw-mono text-xs text-muted-foreground">{cfdi.uuid}</p>
        <label className="mt-3 block text-sm">Motivo
          <select className="mt-1 h-10 w-full rounded-md border px-2" value={motivo} onChange={(e) => setMotivo(e.target.value)}>
            <option value="01">01 · Comprobante emitido con errores con relación</option>
            <option value="02">02 · Comprobante emitido con errores sin relación</option>
            <option value="03">03 · No se llevó a cabo la operación</option>
            <option value="04">04 · Operación nominativa relacionada en una factura global</option>
          </select>
        </label>
        {motivo === "01" && <label className="mt-2 block text-sm">UUID de la factura que la sustituye<Input className="kw-mono mt-1" value={folio} onChange={(e) => setFolio(e.target.value)} /></label>}
        <label className="mt-2 block text-sm">Comentario (opcional)<Input className="mt-1" value={nota} onChange={(e) => setNota(e.target.value)} /></label>
        {msg && <div className="mt-3"><Notice tone={msg.tone}>{msg.text}</Notice></div>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cerrar</Button>
          {!msg || msg.tone === "bad" ? <Button onClick={send}>Enviar solicitud</Button> : null}
        </div>
      </div>
    </div>
  );
}
