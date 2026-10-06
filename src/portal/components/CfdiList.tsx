import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortal } from "../lib/session";
import { callApi, openFile } from "../lib/api";
import { clientDetailQualityLabel, clientFlagReason } from "../lib/clientFlags";
import { deriveCobranza, metodoPagoLabel, relatedUuidFromFlags, voucherTypeLabel } from "../lib/cobranza";
import { accountOnlyCfdi, isPendingDetailCfdi, shortUuid, visibleClientFlags } from "../lib/cfdiPresentation";
import { fmtDate, fmtMoney } from "../lib/format";
import { Empty, Notice, StatusPill } from "./ui";

export interface CfdiRow {
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
  payments?: { paid_at: string; paid_amount: number }[];
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
  por_revisar: "warn",
  no_aplica: "info",
};

function FacturaCard({ c, dir }: { c: CfdiRow; dir: "emitida" | "recibida" }) {
  const pendingDetail = isPendingDetailCfdi(c);
  const cobranza = deriveCobranza({
    metodo_pago: c.metodo_pago,
    voucher_type: c.voucher_type,
    total: c.total,
    paid_amount: c.paid_amount,
    payments_count: c.payments_count,
    detail_pending: pendingDetail,
  });
  const metodo = metodoPagoLabel(c.metodo_pago);
  const tipo = voucherTypeLabel(c.voucher_type);
  const ncDe = relatedUuidFromFlags(c.flags);
  const isNc = String(c.voucher_type ?? "").toUpperCase() === "E" || Boolean(ncDe);
  const flags = visibleClientFlags(c.flags);
  const quality = clientDetailQualityLabel(undefined, c.detail_status);
  const party = dir === "recibida" ? c.nombre_emisor ?? c.rfc_emisor : c.nombre_receptor ?? c.rfc_receptor;
  const rfc = dir === "recibida" ? c.rfc_emisor : c.rfc_receptor;
  const totalLabel = pendingDetail && Number(c.total ?? 0) <= 0.009 ? "Detalle pendiente" : fmtMoney(c.total);
  const showCobranza = !pendingDetail && (cobranza.estado !== "no_aplica" || isNc);

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
            {showCobranza && (
              <StatusPill tone={isNc ? "warn" : (COBRANZA_TONE[cobranza.estado] ?? "info")}>
                {isNc ? `Acción: ${cobranza.label}` : `Cobranza: ${cobranza.label}`}
                {cobranza.estado === "parcial" ? ` · ${fmtMoney(cobranza.paid)} de ${fmtMoney(cobranza.total)}` : ""}
              </StatusPill>
            )}
            {!pendingDetail && quality === "Detalle completo" && (
              <span>· {quality}</span>
            )}
          </p>
          {ncDe && (
            <p className="mt-1 text-xs text-muted-foreground">
              Descuento sobre folio <span className="kw-mono" title={ncDe}>{shortUuid(ncDe)}</span>
              {" · "}
              <Link className="underline" to={`/facturas/${c.id}?from=${dir === "emitida" ? "ingresos" : "egresos"}`}>
                Ver vínculo y acciones
              </Link>
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
              <StatusPill tone="warn">Detalle pendiente</StatusPill>
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
          <Link to={`/facturas/${c.id}?from=${dir === "emitida" ? "ingresos" : "egresos"}`}>Ver detalle</Link>
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

export type CfdiFilters = {
  desde: string;
  hasta: string;
  rfc: string;
  min: string;
  max: string;
  estatus: string;
  metodo: string;
  cobranza: string;
};

const emptyFilters = (): CfdiFilters => ({
  desde: "",
  hasta: "",
  rfc: "",
  min: "",
  max: "",
  estatus: "",
  metodo: "",
  cobranza: "",
});

type Props = {
  direction: "emitida" | "recibida";
  /** Si se pasan, se usan en lugar de cargar por API propia (p. ej. tras búsqueda por periodo). */
  rows?: CfdiRow[] | null;
  /** Filtros de periodo iniciales (desde/hasta). */
  periodDefaults?: { desde: string; hasta: string } | null;
  showNotices?: boolean;
  title?: string;
};

export default function CfdiList({
  direction,
  rows: externalRows,
  periodDefaults,
  showNotices = true,
  title,
}: Props) {
  const { active } = usePortal();
  const [q, setQ] = useState<CfdiFilters>(() => ({
    ...emptyFilters(),
    desde: periodDefaults?.desde ?? "",
    hasta: periodDefaults?.hasta ?? "",
  }));
  const [rows, setRows] = useState<CfdiRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (periodDefaults) {
      setQ((prev) => ({ ...prev, desde: periodDefaults.desde, hasta: periodDefaults.hasta }));
    }
  }, [periodDefaults?.desde, periodDefaults?.hasta]);

  const load = useCallback(async () => {
    if (externalRows) {
      setRows(externalRows);
      return;
    }
    if (!active) return;
    setLoading(true);
    try {
      const data = await callApi<{ facturas: CfdiRow[] }>("facturas.listar", {
        client_id: active.client_id,
        direction,
        filters: q,
      });
      setRows(data.facturas);
    } finally {
      setLoading(false);
    }
  }, [active, direction, q, externalRows]);

  useEffect(() => {
    void load();
  }, [load]);

  const account = useMemo(() => accountOnlyCfdi(rows), [rows]);
  const pendingAmountCount = useMemo(
    () => account.filter((c) => isPendingDetailCfdi(c)).length,
    [account],
  );
  const pendingCobranzaCount = useMemo(
    () => account.filter((c) => !isPendingDetailCfdi(c) && (c.cobranza_estado === "pendiente" || c.cobranza_estado === "por_revisar")).length,
    [account],
  );

  const moduleLabel = direction === "emitida" ? "Ingresos" : "Egresos";

  return (
    <section aria-label={title ?? `CFDI · ${moduleLabel}`}>
      {showNotices && (
        <>
          <div className="mb-3">
            <Notice tone="info">
              Cobranza: PUE = cobrado; PPD sin complemento = pendiente por cobrar; con complemento = cobrado o parcial.
              «Detalle pendiente» = falta monto/método publicados (no es cobranza).
            </Notice>
          </div>
          {pendingAmountCount > 0 && (
            <div className="mb-3">
              <Notice tone="warn">
                {pendingAmountCount} factura{pendingAmountCount === 1 ? "" : "s"} con «Detalle pendiente».
              </Notice>
            </div>
          )}
          {pendingCobranzaCount > 0 && (
            <div className="mb-3">
              <Notice tone="info">
                {pendingCobranzaCount} con cobranza «Pendiente por cobrar» o «Por revisar».
              </Notice>
            </div>
          )}
        </>
      )}
      {!externalRows && (
        <fieldset className="surface-toolbar mb-4 grid grid-cols-2 gap-2 p-3 md:grid-cols-4 lg:grid-cols-8">
          <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Filtros</legend>
          <div>
            <Label htmlFor={`f-desde-${direction}`}>Desde</Label>
            <Input id={`f-desde-${direction}`} type="date" value={q.desde} onChange={(e) => setQ({ ...q, desde: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`f-hasta-${direction}`}>Hasta</Label>
            <Input id={`f-hasta-${direction}`} type="date" value={q.hasta} onChange={(e) => setQ({ ...q, hasta: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`f-rfc-${direction}`}>RFC</Label>
            <Input id={`f-rfc-${direction}`} className="kw-mono uppercase" value={q.rfc} onChange={(e) => setQ({ ...q, rfc: e.target.value.toUpperCase() })} />
          </div>
          <div>
            <Label htmlFor={`f-min-${direction}`}>Monto mínimo</Label>
            <Input id={`f-min-${direction}`} inputMode="decimal" value={q.min} onChange={(e) => setQ({ ...q, min: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`f-max-${direction}`}>Monto máximo</Label>
            <Input id={`f-max-${direction}`} inputMode="decimal" value={q.max} onChange={(e) => setQ({ ...q, max: e.target.value })} />
          </div>
          <div>
            <Label htmlFor={`f-est-${direction}`}>Estatus SAT</Label>
            <select
              id={`f-est-${direction}`}
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
            <Label htmlFor={`f-met-${direction}`}>Método</Label>
            <select
              id={`f-met-${direction}`}
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
            <Label htmlFor={`f-cob-${direction}`}>Cobranza</Label>
            <select
              id={`f-cob-${direction}`}
              className="h-10 w-full rounded-md border border-input bg-background px-2"
              value={q.cobranza}
              onChange={(e) => setQ({ ...q, cobranza: e.target.value })}
            >
              <option value="">Todas</option>
              <option value="pendiente">Pendiente por cobrar</option>
              <option value="por_revisar">Por revisar</option>
              <option value="parcial">Cobrado parcial</option>
              <option value="pagado">Cobrado</option>
            </select>
          </div>
        </fieldset>
      )}
      {loading ? (
        <p className="kw-small">Cargando facturas…</p>
      ) : account.length === 0 ? (
        <Empty>No hay facturas con estos filtros.</Empty>
      ) : (
        <ul className="space-y-2">
          {account.map((c) => (
            <FacturaCard key={c.id} c={c} dir={direction} />
          ))}
        </ul>
      )}
    </section>
  );
}
