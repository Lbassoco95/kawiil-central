import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortal } from "../lib/session";
import { callApi, openFile } from "../lib/api";
import { clientDetailQualityLabel, clientFlagReason } from "../lib/clientFlags";
import { fmtDate, fmtMoney } from "../lib/format";
import { Empty, Notice, PageTitle, StatusPill } from "../components/ui";

interface Cfdi {
  id: string; uuid: string; direction: "emitida" | "recibida"; fecha: string | null; rfc_emisor: string | null; nombre_emisor: string | null;
  rfc_receptor: string | null; nombre_receptor: string | null; total: number | null; sat_status: string; category_name: string | null;
  category_status: string; xml_path: string | null; pdf_path: string | null; is_test: boolean; flags: { code: string; reason: string }[];
  metodo_pago?: string | null; detail_status?: string;
}

const SAT: Record<string, { tone: "ok" | "bad" | "wait"; label: string }> = {
  vigente: { tone: "ok", label: "Vigente" }, cancelado: { tone: "bad", label: "Cancelada" },
  unknown: { tone: "wait", label: "Sin verificar" }, desconocido: { tone: "wait", label: "Sin verificar" },
};

export default function Facturas() {
  const { active } = usePortal();
  const [dir, setDir] = useState<"recibida" | "emitida">("recibida");
  const [q, setQ] = useState({ desde: "", hasta: "", rfc: "", min: "", max: "", estatus: "" });
  const [rows, setRows] = useState<Cfdi[]>([]);

  const load = useCallback(async () => {
    if (!active) return;
    const data = await callApi<{ facturas: Cfdi[] }>("facturas.listar", { client_id: active.client_id, direction: dir, filters: q });
    setRows(data.facturas);
  }, [active, dir, q]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <PageTitle
        title="Facturación"
        subtitle={
          active
            ? `${active.client_name} · CFDI emitidos y recibidos de tu cuenta. En esta fase solo consultas; no cargas XML ni creas facturas.`
            : "CFDI emitidos y recibidos de tu cuenta. En esta fase solo consultas; no cargas XML ni creas facturas."
        }
        breadcrumb={["Kawiil", "Portal", "Facturación"]}
        icon={<FileText />}
      />
      <div className="mb-3">
        <Notice tone="info">
          Solo lectura: aquí ves las facturas de tu cuenta que el equipo de Kawiil ya tiene listas. Si necesitas emitir o corregir algo, escríbenos por Mensajes.
        </Notice>
      </div>
      <div role="tablist" aria-label="Tipo de factura" className="portal-pill-group mb-3">
        {(["recibida", "emitida"] as const).map((d) => (
          <button key={d} role="tab" aria-selected={dir === d} onClick={() => setDir(d)}>
            {d === "recibida" ? "Recibidas (gastos)" : "Emitidas (ingresos)"}
          </button>
        ))}
      </div>
      <fieldset className="surface-toolbar mb-4 grid grid-cols-2 gap-2 p-3 md:grid-cols-6">
        <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Filtros</legend>
        <div>
          <Label htmlFor="f-desde">Desde</Label>
          <Input id="f-desde" type="date" value={q.desde} onChange={(e) => setQ({ ...q, desde: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="f-hasta">Hasta</Label>
          <Input id="f-hasta" type="date" value={q.hasta} onChange={(e) => setQ({ ...q, hasta: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="f-rfc">RFC</Label>
          <Input id="f-rfc" className="kw-mono uppercase" value={q.rfc} onChange={(e) => setQ({ ...q, rfc: e.target.value.toUpperCase() })} />
        </div>
        <div>
          <Label htmlFor="f-min">Monto mínimo</Label>
          <Input id="f-min" inputMode="decimal" value={q.min} onChange={(e) => setQ({ ...q, min: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="f-max">Monto máximo</Label>
          <Input id="f-max" inputMode="decimal" value={q.max} onChange={(e) => setQ({ ...q, max: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="f-est">Estatus SAT</Label>
          <select
            id="f-est"
            className="h-10 w-full rounded-md border border-input bg-background px-2"
            value={q.estatus}
            onChange={(e) => setQ({ ...q, estatus: e.target.value })}
          >
            <option value="">Todos</option>
            <option value="vigente">Vigente</option>
            <option value="cancelado">Cancelada</option>
            <option value="unknown">Sin verificar</option>
          </select>
        </div>
      </fieldset>
      {rows.length === 0 ? (
        <Empty>No hay facturas con estos filtros.</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((c) => (
            <li key={c.id} className="page-list-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{dir === "recibida" ? c.nombre_emisor ?? c.rfc_emisor : c.nombre_receptor ?? c.rfc_receptor}</p>
                  <p className="kw-mono text-xs text-muted-foreground">
                    {dir === "recibida" ? c.rfc_emisor : c.rfc_receptor} · {c.uuid}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDate(c.fecha)}
                    {c.metodo_pago && (
                      <>
                        {" "}
                        · <span className="kw-mono">{c.metodo_pago}</span>
                      </>
                    )}
                    {" · "}
                    {clientDetailQualityLabel(undefined, c.detail_status)}
                    {" · "}
                    Categoría: {c.category_status === "confirmada" ? c.category_name : "por confirmar"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="kw-mono text-lg font-semibold">{fmtMoney(c.total)}</p>
                  <StatusPill tone={SAT[c.sat_status]?.tone ?? "wait"}>{SAT[c.sat_status]?.label ?? c.sat_status}</StatusPill>
                  {c.detail_status !== "complete" && (
                    <span className="ml-1">
                      <StatusPill tone="warn">
                        {c.is_test ? "Solo metadatos (DEMO)" : "Detalle pendiente"}
                      </StatusPill>
                    </span>
                  )}
                  {c.is_test && (
                    <span className="ml-1">
                      <StatusPill tone="warn">DEMO — sin validez fiscal</StatusPill>
                    </span>
                  )}
                </div>
              </div>
              {c.flags?.map((f) => (
                <p key={f.code} className="mt-1 text-xs">
                  <StatusPill tone="warn">Atención</StatusPill> {clientFlagReason(f)}
                </p>
              ))}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" asChild>
                  <Link to={`/facturas/${c.id}`}>Ver detalle</Link>
                </Button>
                {c.xml_path && (
                  <Button size="sm" variant="outline" onClick={() => openFile("cfdi_xml", c.id)}>
                    XML
                  </Button>
                )}
                {c.pdf_path && (
                  <Button size="sm" variant="outline" onClick={() => openFile("cfdi_pdf", c.id)}>
                    PDF
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
