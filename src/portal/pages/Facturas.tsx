import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortal } from "../lib/session";
import { callApi, openFile } from "../lib/api";
import { clientDetailQualityLabel, clientFlagReason } from "../lib/clientFlags";
import { deriveCobranza, metodoPagoLabel, relatedUuidFromFlags, voucherTypeLabel } from "../lib/cobranza";
import { isDidacticFixtureCfdi, isPendingDetailCfdi, partitionSparse, shortUuid, visibleClientFlags } from "../lib/cfdiPresentation";
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
  source?: string | null;
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

function FacturaCard({ c, dir }: { c: Cfdi; dir: "emitida" | "recibida" }) {
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
  const didactic = isDidacticFixtureCfdi(c);
  const pendingDetail = isPendingDetailCfdi(c) || (didactic && c.detail_status !== "complete");
  const flags = visibleClientFlags(c.flags);
  const quality = clientDetailQualityLabel(undefined, c.detail_status);
  const party = dir === "recibida" ? c.nombre_emisor ?? c.rfc_emisor : c.nombre_receptor ?? c.rfc_receptor;
  const rfc = dir === "recibida" ? c.rfc_emisor : c.rfc_receptor;
  const totalLabel = pendingDetail && Number(c.total ?? 0) <= 0.009 ? "Detalle pendiente" : fmtMoney(c.total);

  return (
    <li className="page-list-card p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium">{party || "Contraparte pendiente"}</p>
          <p className="text-xs text-muted-foreground">
            {rfc ? <span className="kw-mono">{rfc}</span> : null}
            {rfc ? " · " : null}
            Folio <span className="kw-mono" title={c.uuid}>{shortUuid(c.uuid)}</span>
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{fmtDate(c.fecha)}</span>
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
            {!pendingDetail && !didactic && quality === "Detalle completo" && (
              <span>· {quality}</span>
            )}
          </p>
          {ncDe && (
            <p className="mt-1 text-xs text-muted-foreground">
              Nota de crédito sobre folio <span className="kw-mono" title={ncDe}>{shortUuid(ncDe)}</span>
            </p>
          )}
          {c.clave_issues_label && (
            <p className="mt-1 text-xs">
              <StatusPill tone="warn">{c.clave_issues_label}</StatusPill>
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="kw-mono text-lg font-semibold">{totalLabel}</p>
          <StatusPill tone={SAT[c.sat_status]?.tone ?? "wait"}>{SAT[c.sat_status]?.label ?? c.sat_status}</StatusPill>
          {pendingDetail && (
            <span className="ml-1">
              <StatusPill tone="warn">
                {didactic ? "Detalle pendiente (ejemplo)" : "Detalle pendiente"}
              </StatusPill>
            </span>
          )}
          {didactic && (
            <span className="ml-1">
              <StatusPill tone="info">Ejemplo didáctico</StatusPill>
            </span>
          )}
        </div>
      </div>
      {flags.map((f) => (
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
}

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
  const [showDidactic, setShowDidactic] = useState(false);

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

  const { ready: account, pending: didactic } = useMemo(() => partitionSparse(rows), [rows]);
  const pendingAmountCount = useMemo(
    () => account.filter((c) => isPendingDetailCfdi(c)).length,
    [account],
  );
  const visible = showDidactic ? [...account, ...didactic] : account;

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
          Solo lectura: ves las facturas reales de tu cuenta (SatGo / publicadas). PPD sin complemento aparece como pendiente; con complemento, pagado o parcial.
        </Notice>
      </div>
      {pendingAmountCount > 0 && (
        <div className="mb-3">
          <Notice tone="warn">
            {pendingAmountCount} factura{pendingAmountCount === 1 ? "" : "s"} reales con «Detalle pendiente»
            (contraparte, folio y fecha visibles; monto/método aún no publicados).
          </Notice>
        </div>
      )}
      {didactic.length > 0 && (
        <div className="mb-3">
          <Notice tone="info">
            {didactic.length} ejemplo{didactic.length === 1 ? "" : "s"} didáctico{didactic.length === 1 ? "" : "s"}
            {" "}(clientes inventados; no son de esta cuenta).
            {" "}
            <button
              type="button"
              className="underline font-medium"
              onClick={() => setShowDidactic((v) => !v)}
            >
              {showDidactic ? "Ocultar ejemplos" : "Mostrar ejemplos aparte"}
            </button>
          </Notice>
        </div>
      )}
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
      {visible.length === 0 ? (
        <Empty>
          {didactic.length > 0 && !showDidactic
            ? "No hay facturas reales con estos filtros. Usa «Mostrar ejemplos aparte» si quieres ver los didácticos."
            : "No hay facturas con estos filtros."}
        </Empty>
      ) : (
        <ul className="space-y-2">
          {account.map((c) => (
            <FacturaCard key={c.id} c={c} dir={dir} />
          ))}
          {showDidactic && didactic.length > 0 && (
            <>
              <li className="pt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Ejemplos didácticos · {didactic.length} factura{didactic.length === 1 ? "" : "s"} (no son de esta cuenta)
              </li>
              {didactic.map((c) => (
                <FacturaCard key={c.id} c={c} dir={dir} />
              ))}
            </>
          )}
        </ul>
      )}
    </>
  );
}
