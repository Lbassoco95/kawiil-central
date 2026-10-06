import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { usePortal } from "../lib/session";
import { callApi, openFile, PortalApiError } from "../lib/api";
import { fmtDate, fmtMoney } from "../lib/format";
import { Empty, Notice, PageTitle, StatusPill } from "../components/ui";
import { clientDetailQualityLabel, clientFlagReason } from "../lib/clientFlags";
import { deriveCobranza, metodoPagoLabel, voucherTypeLabel } from "../lib/cobranza";
import { assessClaveProdServ, summarizeConceptKeyIssues } from "../lib/claveProdServ";
import { isPendingDetailCfdi, visibleClientFlags } from "../lib/cfdiPresentation";
import { pushDemoToast } from "../lib/demoStore";
import { taxKindLabel, taxNameLabel, taxRateLabel, summarizeTaxLines } from "../lib/taxPresentation";
import { ivaAudienceNote } from "../lib/fiscalAudienceCopy";

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

type DocAction = "descuento" | "otra";

export default function FacturaDetalle() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { active } = usePortal();
  const [d, setD] = useState<Detalle | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [actionDone, setActionDone] = useState<DocAction | null>(null);

  useEffect(() => {
    if (!active || !id) return;
    callApi<Detalle>("facturas.detalle", { client_id: active.client_id, cfdi_id: id })
      .then(setD)
      .catch((e) => setErr(e instanceof PortalApiError ? e.message : "No se pudo cargar el detalle."));
  }, [active, id]);

  const f = d?.factura && !d.factura.is_test ? d.factura : null;
  const blockedDidactic = Boolean(d?.factura?.is_test);
  const backTo = useMemo(() => {
    const from = search.get("from");
    if (from === "ingresos") return "/ingresos";
    if (from === "egresos") return "/egresos";
    if (f?.direction === "emitida") return "/ingresos";
    if (f?.direction === "recibida") return "/egresos";
    return "/ingresos";
  }, [search, f?.direction]);
  const backLabel = backTo === "/egresos" ? "Volver a Egresos" : "Volver a Ingresos";
  const pendingDetail = f ? isPendingDetailCfdi(f) : false;
  const cobranza = f
    ? deriveCobranza({
      metodo_pago: f.metodo_pago,
      voucher_type: f.voucher_type,
      total: f.total,
      paid_amount: f.paid_amount ?? d?.pagos.reduce((s, p) => s + Number(p.paid_amount), 0),
      detail_pending: pendingDetail,
    })
    : null;
  const metodo = f ? metodoPagoLabel(f.metodo_pago) : null;
  const tipo = f ? voucherTypeLabel(f.voucher_type) : null;
  const isNc = String(f?.voucher_type ?? "").toUpperCase() === "E";
  const hasNcLinks = Boolean(d?.nota_credito_de || (d?.notas_credito?.length ?? 0) > 0);
  const taxSummary = d?.impuestos?.length ? summarizeTaxLines(d.impuestos) : null;
  const complementRows = (d?.complementos?.length
    ? d.complementos
    : (d?.pagos ?? []).map((p, i) => ({
      id: String(i),
      uuid: "",
      paid_at: p.paid_at,
      paid_amount: p.paid_amount,
    }))) ?? [];

  function takeNcAction(kind: DocAction) {
    setActionDone(kind);
    pushDemoToast({
      tone: "ok",
      text: kind === "descuento"
        ? "Acción registrada: aplicar como descuento. Tu contador la verá en central."
        : "Acción registrada para el documento asociado. Tu contador la verá en central.",
    });
  }

  return (
    <>
      <PageTitle
        title="Detalle de factura"
        subtitle={f?.uuid}
        actions={<Button variant="outline" asChild><Link to={backTo}>{backLabel}</Link></Button>}
      />
      {err && <Notice tone="bad">{err}</Notice>}
      {!err && !d && <Empty>Cargando…</Empty>}
      {blockedDidactic && (
        <Empty>
          Esta factura no pertenece a tu cuenta.{" "}
          <Link className="underline" to={backTo}>{backLabel}</Link>
        </Empty>
      )}
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
                  {cobranza && !pendingDetail && (cobranza.estado !== "no_aplica" || isNc) && (
                    <StatusPill tone={cobranza.tone}>
                      {isNc ? `Acción: ${cobranza.label}` : `Cobranza: ${cobranza.label}`}
                    </StatusPill>
                  )}
                  {pendingDetail && <StatusPill tone="warn">Detalle pendiente</StatusPill>}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Forma <span className="kw-mono">{f.forma_pago ?? "—"}</span>
                  {cobranza && cobranza.estado === "parcial" && (
                    <> · Cobrado {fmtMoney(cobranza.paid)} · Pendiente por cobrar {fmtMoney(cobranza.pendiente)}</>
                  )}
                  {cobranza && cobranza.estado === "pendiente" && (
                    <> · Pendiente por cobrar {fmtMoney(cobranza.pendiente)}</>
                  )}
                </p>
              </div>
              <div className="text-right">
                <p className="kw-mono text-2xl">{pendingDetail && f.total <= 0.009 ? "Detalle pendiente" : fmtMoney(f.total)}</p>
                <StatusPill tone={f.detail_status === "complete" ? "ok" : "warn"}>
                  {clientDetailQualityLabel(d?.calidad, f.detail_status)}
                </StatusPill>
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
                Descuento (nota de crédito) sobre{" "}
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
            <h2 className="text-lg">Impuestos desglosados</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Subtotal {fmtMoney(f.subtotal)} · Total {fmtMoney(f.total)}. El KPI de ingreso/gasto usa el subtotal; el IVA no se mezcla ahí.
            </p>
            {taxSummary && d!.impuestos.length > 0 ? (
              <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">IVA trasladado</dt>
                  <dd className="kw-mono">{fmtMoney(taxSummary.ivaTrasladado || f.vat_transferred)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">IVA retenido</dt>
                  <dd className="kw-mono">{fmtMoney(taxSummary.ivaRetenido || f.vat_withheld)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">ISR retenido</dt>
                  <dd className="kw-mono">{fmtMoney(taxSummary.isrRetenido || f.income_tax_withheld)}</dd>
                </div>
              </dl>
            ) : null}
            {d!.impuestos.length === 0 ? (
              <Empty>
                Sin desglose de impuestos publicado.
                {(f.vat_transferred > 0 || f.vat_withheld > 0) && (
                  <> Cabecera: IVA trasladado {fmtMoney(f.vat_transferred)} · IVA retenido {fmtMoney(f.vat_withheld)}.</>
                )}
              </Empty>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th>Impuesto</th>
                    <th>Tipo</th>
                    <th>Tasa</th>
                    <th className="text-right">Base</th>
                    <th className="text-right">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {d!.impuestos.map((t, i) => (
                    <tr key={i} className="border-t">
                      <td>{taxNameLabel(t.tax)}</td>
                      <td>{taxKindLabel(t.kind)}</td>
                      <td className="kw-mono">{taxRateLabel(t.rate)}</td>
                      <td className="kw-mono text-right">{fmtMoney(t.base)}</td>
                      <td className="kw-mono text-right">{fmtMoney(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-3 text-xs text-muted-foreground">{ivaAudienceNote(active?.origin)}</p>
          </section>
          <section className="rounded-xl border bg-card p-4">
            <h2 className="text-lg">Complementos de pago (PPD)</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Fechas, montos y vínculos desde <span className="kw-mono">portal_payment_links</span> publicados.
              Si hay badge de cobranza con complemento, aquí debe verse el detalle — no solo la etiqueta.
            </p>
            {complementRows.length === 0 ? (
              <Empty>
                {f.metodo_pago === "PPD"
                  ? "Sin complemento de pago vinculado — pendiente por cobrar (no es «Detalle pendiente»)."
                  : "Sin complementos de pago vinculados."}
              </Empty>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {complementRows.map((p) => (
                  <li key={p.id + p.paid_at} className="rounded-md border border-border/60 px-3 py-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">Pago {fmtDate(p.paid_at) || "sin fecha"}</p>
                        {p.uuid ? (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            CFDI complemento{" "}
                            <Link className="kw-mono underline" to={`/facturas/${p.id}`}>{p.uuid}</Link>
                          </p>
                        ) : (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            Monto publicado en el vínculo de pago (UUID del complemento pendiente de publicar).
                          </p>
                        )}
                      </div>
                      <span className="kw-mono text-base font-semibold">{fmtMoney(p.paid_amount)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {f.metodo_pago === "PPD" && (f.paid_amount ?? 0) > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Cobrado acumulado {fmtMoney(f.paid_amount)} de {fmtMoney(f.total)}.
              </p>
            )}
          </section>
          <section className="rounded-xl border bg-card p-4">
            <h2 className="text-lg">Documentos asociados · notas de crédito</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Una nota de crédito se trata como <strong>descuento</strong> sobre la factura vinculada. Otras acciones quedan listas para ampliar.
            </p>
            {(d!.notas_credito?.length ?? 0) === 0 && !d?.nota_credito_de ? (
              <Empty>Sin notas de crédito vinculadas.</Empty>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {d?.nota_credito_de && (
                  <li className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                    <span>
                      Este doc descuenta la factura{" "}
                      <Link className="kw-mono underline" to={`/facturas/${d.nota_credito_de.id}`}>{d.nota_credito_de.uuid}</Link>
                    </span>
                    <StatusPill tone="warn">Descuento</StatusPill>
                  </li>
                )}
                {d!.notas_credito!.map((n) => (
                  <li key={n.id} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2">
                    <Link className="kw-mono underline" to={`/facturas/${n.id}`}>{n.uuid}</Link>
                    <span className="kw-mono">{fmtMoney(n.total)} · {fmtDate(n.fecha)} · Descuento</span>
                  </li>
                ))}
              </ul>
            )}
            {(isNc || hasNcLinks) && (
              <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                <Button
                  size="sm"
                  disabled={actionDone === "descuento"}
                  onClick={() => takeNcAction("descuento")}
                >
                  {actionDone === "descuento" ? "Descuento registrado" : "Aplicar como descuento"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actionDone === "otra"}
                  onClick={() => takeNcAction("otra")}
                >
                  Otra acción…
                </Button>
                <Button size="sm" variant="ghost" asChild>
                  <Link to="/mensajes">Escribir a Kawiil</Link>
                </Button>
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
