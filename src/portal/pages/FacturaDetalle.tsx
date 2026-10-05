import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { usePortal } from "../lib/session";
import { callApi, openFile, PortalApiError } from "../lib/api";
import { fmtDate, fmtMoney } from "../lib/format";
import { Empty, Notice, PageTitle, StatusPill } from "../components/ui";
import { clientDetailQualityLabel, clientFlagReason } from "../lib/clientFlags";
import { deriveCobranza, metodoPagoLabel, voucherTypeLabel } from "../lib/cobranza";
import { assessClaveProdServ, summarizeConceptKeyIssues } from "../lib/claveProdServ";
import { visibleClientFlags } from "../lib/cfdiPresentation";
import { DEMO_FISCAL_MARK } from "../lib/demo";

interface Detalle {
  factura: {
    id: string; uuid: string; direction: string; fecha: string | null;
    rfc_emisor: string | null; nombre_emisor: string | null;
    rfc_receptor: string | null; nombre_receptor: string | null;
    voucher_type: string | null;
    forma_pago: string | null; metodo_pago: string | null;
    subtotal: number; total: number; vat_transferred: number; vat_withheld: number; income_tax_withheld: number;
    sat_status: string; detail_status: string; category_name: string | null; category_status: string;
    flags: { code: string; reason: string }[]; xml_path: string | null; pdf_path: string | null; is_test: boolean;
    paid_amount?: number;
  };
  impuestos: { tax: string; kind: string; rate: number | null; base: number; amount: number }[];
  conceptos: {
    description: string;
    quantity: number;
    unit_value: number;
    amount: number;
    discount: number;
    product_service_key?: string | null;
  }[];
  pagos: { paid_at: string; paid_amount: number }[];
  complementos?: { id: string; uuid: string; paid_at: string; paid_amount: number }[];
  notas_credito?: { id: string; uuid: string; total: number; fecha: string | null }[];
  nota_credito_de?: { id: string; uuid: string } | null;
  calidad: string;
}

export default function FacturaDetalle() {
  const { id } = useParams();
  const { active } = usePortal();
  const [d, setD] = useState<Detalle | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !id) return;
    callApi<Detalle>("facturas.detalle", { client_id: active.client_id, cfdi_id: id })
      .then(setD)
      .catch((e) => setErr(e instanceof PortalApiError ? e.message : "No se pudo cargar el detalle."));
  }, [active, id]);

  const f = d?.factura;
  const cobranza = f
    ? deriveCobranza({
      metodo_pago: f.metodo_pago,
      voucher_type: f.voucher_type,
      total: f.total,
      paid_amount: f.paid_amount ?? d?.pagos.reduce((s, p) => s + Number(p.paid_amount), 0),
    })
    : null;
  const metodo = f ? metodoPagoLabel(f.metodo_pago) : null;
  const tipo = f ? voucherTypeLabel(f.voucher_type) : null;

  return (
    <>
      <PageTitle
        title="Detalle de factura"
        subtitle={f?.uuid}
        actions={<Button variant="outline" asChild><Link to="/facturas">Volver</Link></Button>}
      />
      {err && <Notice tone="bad">{err}</Notice>}
      {!err && !d && <Empty>Cargando…</Empty>}
      {f && (
        <div className="mt-4 space-y-4">
          <section className="rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium">{f.nombre_emisor ?? f.rfc_emisor} → {f.nombre_receptor ?? f.rfc_receptor}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <span>{fmtDate(f.fecha)}</span>
                  <span>· {f.direction === "emitida" ? "Ingreso (emitida)" : "Egreso (recibida)"}</span>
                  {tipo && <StatusPill tone={f.voucher_type === "E" ? "warn" : "info"}>{tipo}</StatusPill>}
                  {metodo && <StatusPill tone={metodo === "PPD" ? "warn" : "ok"}>{metodo}</StatusPill>}
                  {cobranza && cobranza.estado !== "no_aplica" && (
                    <StatusPill tone={cobranza.tone}>Cobranza: {cobranza.label}</StatusPill>
                  )}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Forma <span className="kw-mono">{f.forma_pago ?? "—"}</span>
                  {cobranza && cobranza.estado === "parcial" && (
                    <> · Pagado {fmtMoney(cobranza.paid)} · Pendiente {fmtMoney(cobranza.pendiente)}</>
                  )}
                </p>
              </div>
              <div className="text-right">
                <p className="kw-mono text-2xl">{fmtMoney(f.total)}</p>
                <StatusPill tone={f.detail_status === "complete" ? "ok" : "warn"}>
                  {clientDetailQualityLabel(d?.calidad, f.detail_status)}
                  {f.is_test && f.detail_status !== "complete" ? " (ejemplo)" : ""}
                </StatusPill>
                {f.is_test && (
                  <div className="mt-1">
                    <StatusPill tone="info">{f.detail_status === "complete" ? "Ejemplo didáctico" : DEMO_FISCAL_MARK}</StatusPill>
                  </div>
                )}
              </div>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Subtotal</dt><dd className="kw-mono">{fmtMoney(f.subtotal)}</dd></div>
              <div><dt className="text-muted-foreground">IVA trasladado</dt><dd className="kw-mono">{fmtMoney(f.vat_transferred)}</dd></div>
              <div><dt className="text-muted-foreground">IVA retenido</dt><dd className="kw-mono">{fmtMoney(f.vat_withheld)}</dd></div>
              <div><dt className="text-muted-foreground">ISR retenido</dt><dd className="kw-mono">{fmtMoney(f.income_tax_withheld)}</dd></div>
              <div><dt className="text-muted-foreground">Estatus SAT</dt><dd>{f.sat_status === "vigente" ? "Vigente" : f.sat_status === "cancelado" ? "Cancelada" : f.sat_status === "unknown" ? "Sin verificar" : f.sat_status}</dd></div>
              <div><dt className="text-muted-foreground">Categoría</dt><dd>{f.category_status === "confirmada" ? f.category_name : "por confirmar"}</dd></div>
            </dl>
            {visibleClientFlags(f.flags).map((flag) => <p key={flag.code + flag.reason} className="mt-2 text-xs"><StatusPill tone="warn">Atención</StatusPill> {clientFlagReason(flag)}</p>)}
            {d?.nota_credito_de && (
              <p className="mt-2 text-sm">
                Nota de crédito sobre{" "}
                <Link className="underline" to={`/facturas/${d.nota_credito_de.id}`}>factura relacionada</Link>
              </p>
            )}
            <div className="mt-3 flex gap-2">
              {f.xml_path && <Button size="sm" variant="outline" onClick={() => openFile("cfdi_xml", f.id)}>XML</Button>}
              {f.pdf_path && <Button size="sm" variant="outline" onClick={() => openFile("cfdi_pdf", f.id)}>PDF</Button>}
            </div>
          </section>
          <section className="rounded-xl border bg-card p-4">
            <h2 className="text-lg">Conceptos y clave de producto/servicio</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              El concepto es la descripción libre; la clave es el código del catálogo SAT. Pueden no coincidir.
            </p>
            {d!.conceptos.length === 0 ? (
              <Empty>
                {f.detail_status === "complete"
                  ? "Sin partidas publicadas."
                  : "Detalle pendiente: aún no hay partidas con concepto ni clave de producto."}
              </Empty>
            ) : (
              <>
                {(() => {
                  const summary = summarizeConceptKeyIssues(d!.conceptos);
                  return summary.label ? (
                    <div className="mt-2">
                      <StatusPill tone="warn">{summary.label}</StatusPill>
                    </div>
                  ) : null;
                })()}
                <ul className="mt-2 space-y-3">
                  {d!.conceptos.map((c, i) => {
                    const issue = assessClaveProdServ(c);
                    return (
                      <li key={i} className="border-t pt-3 text-sm">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium">{c.description}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Concepto (descripción) · {c.quantity} × {fmtMoney(c.unit_value)}
                            </p>
                            <p className="mt-1 text-xs">
                              Clave producto/servicio:{" "}
                              <span className="kw-mono">{c.product_service_key?.trim() || "—"}</span>
                              {issue && (
                                <span className="ml-1.5">
                                  <StatusPill tone="warn">{issue.label}</StatusPill>
                                </span>
                              )}
                              {!issue && c.product_service_key && (
                                <span className="ml-1.5">
                                  <StatusPill tone="ok">Clave presente</StatusPill>
                                </span>
                              )}
                            </p>
                          </div>
                          <span className="kw-mono shrink-0 font-medium">{fmtMoney(c.amount)}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </section>
          <section className="rounded-xl border bg-card p-4">
            <h2 className="text-lg">Impuestos</h2>
            {d!.impuestos.length === 0 ? <Empty>Sin desglose de impuestos.</Empty> : (
              <table className="mt-2 w-full text-sm">
                <thead><tr className="text-left text-muted-foreground"><th>Impuesto</th><th>Tipo</th><th>Tasa</th><th className="text-right">Base</th><th className="text-right">Importe</th></tr></thead>
                <tbody>{d!.impuestos.map((t, i) => (
                  <tr key={i} className="border-t"><td>{t.tax}</td><td>{t.kind}</td><td className="kw-mono">{t.rate ?? "—"}</td><td className="kw-mono text-right">{fmtMoney(t.base)}</td><td className="kw-mono text-right">{fmtMoney(t.amount)}</td></tr>
                ))}</tbody>
              </table>
            )}
          </section>
          <section className="rounded-xl border bg-card p-4">
            <h2 className="text-lg">Complementos de pago (PPD)</h2>
            {(d!.complementos?.length ?? 0) === 0 && d!.pagos.length === 0 ? (
              <Empty>
                {f.metodo_pago === "PPD"
                  ? "Sin complemento de pago vinculado — cobranza pendiente."
                  : "Sin complementos de pago vinculados."}
              </Empty>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {(d!.complementos?.length ? d!.complementos : d!.pagos.map((p, i) => ({
                  id: String(i),
                  uuid: "",
                  paid_at: p.paid_at,
                  paid_amount: p.paid_amount,
                }))).map((p) => (
                  <li key={p.id + p.paid_at} className="flex flex-wrap justify-between gap-2 border-t pt-2">
                    <span>
                      {fmtDate(p.paid_at)}
                      {p.uuid && (
                        <>
                          {" · "}
                          <Link className="kw-mono underline" to={`/facturas/${p.id}`}>{p.uuid}</Link>
                        </>
                      )}
                    </span>
                    <span className="kw-mono">{fmtMoney(p.paid_amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-xl border bg-card p-4">
            <h2 className="text-lg">Notas de crédito</h2>
            {(d!.notas_credito?.length ?? 0) === 0 ? (
              <Empty>Sin notas de crédito vinculadas.</Empty>
            ) : (
              <ul className="mt-2 space-y-1 text-sm">
                {d!.notas_credito!.map((n) => (
                  <li key={n.id} className="flex justify-between border-t pt-2">
                    <Link className="kw-mono underline" to={`/facturas/${n.id}`}>{n.uuid}</Link>
                    <span className="kw-mono">{fmtMoney(n.total)} · {fmtDate(n.fecha)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
