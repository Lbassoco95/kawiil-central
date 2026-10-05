import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortal } from "../lib/session";
import { callApi, openFile } from "../lib/api";
import { clientDetailQualityLabel, clientFlagReason } from "../lib/clientFlags";
import { deriveCobranza, metodoPagoLabel, relatedUuidFromFlags, voucherTypeLabel } from "../lib/cobranza";
import { fmtDate, fmtMoney } from "../lib/format";
import { Empty, Notice, PageTitle, StatusPill } from "../components/ui";

interface Cfdi {
  id: string;
  uuid: string;
  direction: "emitida" | "recibida";
  fecha: string | null;
  rfc_emisor: string | null;
  nombre_emisor: string | null;
  rfc_receptor: string | null;
  nombre_receptor: string | null;
  total: number | null;
  sat_status: string;
  category_name: string | null;
  category_status: string;
  xml_path: string | null;
  pdf_path: string | null;
  is_test: boolean;
  flags: { code: string; reason: string }[];
  metodo_pago?: string | null;
  voucher_type?: string | null;
  detail_status?: string;
  paid_amount?: number;
  payments_count?: number;
  cobranza_estado?: string;
  cobranza_label?: string;
  clave_issues_label?: string | null;
}

const SAT: Record<string, { tone: "ok" | "bad" | "wait"; label: string }> = {
  vigente: { tone: "ok", label: "Vigente" },
  cancelado: { tone: "bad", label: "Cancelada" },
  unknown: { tone: "wait", label: "Sin verificar" },
  desconocido: { tone: "wait", label: "Sin verificar" },
};

const COBRANZA_TONE: Record<string, "ok" | "warn" | "wait" | "info"> = {
  pagado: "ok",
  parcial: "warn",
  pendiente: "wait",
  no_aplica: "info",
};

export default function Facturas() {
  const { active } = usePortal();
  const [dir, setDir] = useState<"recibida" | "emitida">("emitida");
  const [q, setQ] = useState({
    desde: "",
    hasta: "",
    rfc: "",
    min: "",
    max: "",
    estatus: "",
    metodo: "",
    cobranza: "",
  });
  const [rows, setRows] = useState<Cfdi[]>([]);

  const load = useCallback(async () => {
    if (!active) return;
    const data = await callApi<{ facturas: Cfdi[] }>("facturas.listar", {
      client_id: active.client_id,
      direction: dir,
      filters: q,
    });
    setRows(data.facturas);
  }, [active, dir, q]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <PageTitle
        title="Facturación"
        subtitle={
          active
            ? `${active.client_name} · Ingresos y egresos de tu cuenta. Cobranza según PUE/PPD y complementos de pago.`
            : "Ingresos y egresos de tu cuenta. Cobranza según PUE/PPD y complementos de pago."
        }
        breadcrumb={["Kawiil", "Portal", "Facturación"]}
        icon={<FileText />}
      />
      <div className="mb-3">
        <Notice tone="info">
          Solo lectura: ves las facturas que el equipo de Kawiil ya tiene listas. PPD sin complemento aparece como pendiente; con complemento, pagado o parcial.
        </Notice>
      </div>
      <div role="tablist" aria-label="Ingresos o egresos" className="portal-pill-group mb-3">
        {([
          { id: "emitida" as const, label: "Ingresos (emitidas)" },
          { id: "recibida" as const, label: "Egresos (recibidas)" },
        ]).map((tab) => (
          <button key={tab.id} role="tab" aria-selected={dir === tab.id} onClick={() => setDir(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      <fieldset className="surface-toolbar mb-4 grid grid-cols-2 gap-2 p-3 md:grid-cols-4 lg:grid-cols-8">
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
        <div>
          <Label htmlFor="f-met">Método</Label>
          <select
            id="f-met"
            className="h-10 w-full rounded-md border border-input bg-background px-2"
            value={q.metodo}
            onChange={(e) => setQ({ ...q, metodo: e.target.value })}
          >
            <option value="">PUE y PPD</option>
            <option value="PUE">PUE</option>
            <option value="PPD">PPD</option>
          </select>
        </div>
        <div>
          <Label htmlFor="f-cob">Cobranza</Label>
          <select
            id="f-cob"
            className="h-10 w-full rounded-md border border-input bg-background px-2"
            value={q.cobranza}
            onChange={(e) => setQ({ ...q, cobranza: e.target.value })}
          >
            <option value="">Todas</option>
            <option value="pendiente">Pendiente</option>
            <option value="parcial">Parcial</option>
            <option value="pagado">Pagado</option>
          </select>
        </div>
      </fieldset>
      {rows.length === 0 ? (
        <Empty>No hay facturas con estos filtros.</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((c) => {
            const cobranza = deriveCobranza({
              metodo_pago: c.metodo_pago,
              voucher_type: c.voucher_type,
              total: c.total,
              paid_amount: c.paid_amount,
              payments_count: c.payments_count,
            });
            const metodo = metodoPagoLabel(c.metodo_pago);
            const tipo = voucherTypeLabel(c.voucher_type);
            const ncDe = relatedUuidFromFlags(c.flags);
            return (
              <li key={c.id} className="page-list-card p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {dir === "recibida" ? c.nombre_emisor ?? c.rfc_emisor : c.nombre_receptor ?? c.rfc_receptor}
                    </p>
                    <p className="kw-mono text-xs text-muted-foreground">
                      {dir === "recibida" ? c.rfc_emisor : c.rfc_receptor} · {c.uuid}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{fmtDate(c.fecha)}</span>
                      {/* Tipo SAT solo si no es I (las pestañas ya dicen ingreso/egreso por dirección). */}
                      {tipo && c.voucher_type && c.voucher_type !== "I" && (
                        <StatusPill tone={c.voucher_type === "E" ? "warn" : c.voucher_type === "P" ? "info" : "ok"}>
                          {tipo}
                        </StatusPill>
                      )}
                      {metodo && (
                        <StatusPill tone={metodo === "PPD" ? "warn" : "ok"}>{metodo}</StatusPill>
                      )}
                      {cobranza.estado !== "no_aplica" && (
                        <StatusPill tone={COBRANZA_TONE[cobranza.estado] ?? "info"}>
                          Cobranza: {c.cobranza_label ?? cobranza.label}
                          {cobranza.estado === "parcial" ? ` · ${fmtMoney(cobranza.paid)} de ${fmtMoney(cobranza.total)}` : ""}
                        </StatusPill>
                      )}
                      {cobranza.estado === "no_aplica" && metodo == null && (
                        <StatusPill tone="info">{c.cobranza_label ?? cobranza.label}</StatusPill>
                      )}
                      <span>· {clientDetailQualityLabel(undefined, c.detail_status)}</span>
                    </p>
                    {ncDe && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Nota de crédito sobre <span className="kw-mono">{ncDe}</span>
                      </p>
                    )}
                    {c.clave_issues_label && (
                      <p className="mt-1 text-xs">
                        <StatusPill tone="warn">{c.clave_issues_label}</StatusPill>
                      </p>
                    )}
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
                  <p key={f.code + f.reason} className="mt-1 text-xs">
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
            );
          })}
        </ul>
      )}
    </>
  );
}
