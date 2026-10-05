import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { usePortal } from "../lib/session";
import { callApi, openFile, PortalApiError } from "../lib/api";
import { fmtDate, fmtMoney } from "../lib/format";
import { Empty, Notice, PageTitle, StatusPill } from "../components/ui";
import { clientDetailQualityLabel, clientFlagReason } from "../lib/clientFlags";
import { DEMO_FISCAL_MARK } from "../lib/demo";

interface Detalle {
  factura: {
    id: string; uuid: string; direction: string; fecha: string | null;
    rfc_emisor: string | null; nombre_emisor: string | null;
    rfc_receptor: string | null; nombre_receptor: string | null;
    forma_pago: string | null; metodo_pago: string | null;
    subtotal: number; total: number; vat_transferred: number; vat_withheld: number; income_tax_withheld: number;
    sat_status: string; detail_status: string; category_name: string | null; category_status: string;
    flags: { code: string; reason: string }[]; xml_path: string | null; pdf_path: string | null; is_test: boolean;
  };
  impuestos: { tax: string; kind: string; rate: number | null; base: number; amount: number }[];
  conceptos: { description: string; quantity: number; unit_value: number; amount: number; discount: number }[];
  pagos: { paid_at: string; paid_amount: number }[];
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
                <p className="text-xs text-muted-foreground">{fmtDate(f.fecha)} · {f.direction} · método <span className="kw-mono">{f.metodo_pago ?? "—"}</span> · forma <span className="kw-mono">{f.forma_pago ?? "—"}</span></p>
              </div>
              <div className="text-right">
                <p className="kw-mono text-2xl">{fmtMoney(f.total)}</p>
                <StatusPill tone={f.detail_status === "complete" ? "ok" : "warn"}>
                  {clientDetailQualityLabel(d?.calidad, f.detail_status)}
                  {f.is_test && f.detail_status !== "complete" ? " (DEMO)" : ""}
                </StatusPill>
                {f.is_test && <div className="mt-1"><StatusPill tone="warn">{DEMO_FISCAL_MARK}</StatusPill></div>}
              </div>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <div><dt className="text-muted-foreground">Subtotal</dt><dd className="kw-mono">{fmtMoney(f.subtotal)}</dd></div>
              <div><dt className="text-muted-foreground">IVA trasladado</dt><dd className="kw-mono">{fmtMoney(f.vat_transferred)}</dd></div>
              <div><dt className="text-muted-foreground">IVA retenido</dt><dd className="kw-mono">{fmtMoney(f.vat_withheld)}</dd></div>
              <div><dt className="text-muted-foreground">ISR retenido</dt><dd className="kw-mono">{fmtMoney(f.income_tax_withheld)}</dd></div>
              <div><dt className="text-muted-foreground">Estatus SAT</dt><dd>{f.sat_status}</dd></div>
              <div><dt className="text-muted-foreground">Categoría</dt><dd>{f.category_status === "confirmada" ? f.category_name : "por confirmar"}</dd></div>
            </dl>
            {f.flags?.map((flag) => <p key={flag.code} className="mt-2 text-xs"><StatusPill tone="warn">Atención</StatusPill> {clientFlagReason(flag)}</p>)}
            <div className="mt-3 flex gap-2">
              {f.xml_path && <Button size="sm" variant="outline" onClick={() => openFile("cfdi_xml", f.id)}>XML</Button>}
              {f.pdf_path && <Button size="sm" variant="outline" onClick={() => openFile("cfdi_pdf", f.id)}>PDF</Button>}
            </div>
          </section>
          <section className="rounded-xl border bg-card p-4">
            <h2 className="text-lg">Conceptos</h2>
            {d!.conceptos.length === 0 ? <Empty>Sin conceptos publicados aún.</Empty> : (
              <ul className="mt-2 space-y-2">{d!.conceptos.map((c, i) => (
                <li key={i} className="flex justify-between gap-2 border-t pt-2 text-sm">
                  <span>{c.description} · {c.quantity} × {fmtMoney(c.unit_value)}</span>
                  <span className="kw-mono">{fmtMoney(c.amount)}</span>
                </li>
              ))}</ul>
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
            <h2 className="text-lg">Pagos vinculados (PPD)</h2>
            {d!.pagos.length === 0 ? <Empty>Sin complementos de pago vinculados.</Empty> : (
              <ul className="mt-2 space-y-1 text-sm">{d!.pagos.map((p, i) => (
                <li key={i} className="flex justify-between border-t pt-2"><span>{fmtDate(p.paid_at)}</span><span className="kw-mono">{fmtMoney(p.paid_amount)}</span></li>
              ))}</ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}
