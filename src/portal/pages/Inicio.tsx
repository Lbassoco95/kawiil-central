import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LayoutDashboard } from "lucide-react";
import { usePortal } from "../lib/session";
import { callApi } from "../lib/api";
import { clientFlagReason } from "../lib/clientFlags";
import { fmtDate, fmtMoney, MONTHS, monthLabel } from "../lib/format";
import { Empty, ManagementLegend, Notice, PageTitle, StatusPill } from "../components/ui";
import { ivaAudienceNote, ivaEstimateExplain } from "../lib/fiscalAudienceCopy";

interface Dash {
  gasto_total: number; gasto_mes_anterior: number; ingreso_total: number; ingreso_mes_anterior: number;
  por_categoria: { categoria: string; por_confirmar: boolean; total: number; facturas: number }[];
  por_proveedor: { rfc: string; nombre: string | null; total: number; facturas: number }[];
  por_mes: { mes: string; gasto: number | null; ingreso: number | null }[];
  iva: { trasladado: number; acreditable: number; facturas_sin_desglose: number };
  iva_estimado: number;
  iva_basis?: "cash_flow" | "issuance";
  iva_basis_label?: string;
  retenciones?: {
    iva_retenido_a_la_empresa: number;
    iva_retenido_por_la_empresa: number;
    isr_retenido_a_la_empresa: number;
    isr_retenido_por_la_empresa: number;
  };
  iva_flujo?: {
    por_tasa: Record<"16" | "8" | "0" | "exempt", { transferred: number; creditable: number }>;
    pendientes_de_pago: string[];
  };
  calidad?: { complete: number; metadata_only: number; quality_label: string; quality_note: string };
  marcas: { cfdi_id: string; emisor: string | null; total: number; fecha: string; flags: { code: string; reason: string }[] }[];
  por_confirmar: number;
  leyenda?: string;
  espejo?: boolean;
}

function Delta({ now, prev }: { now: number; prev: number }) {
  if (!prev) return <span className="text-xs text-muted-foreground">sin mes anterior para comparar</span>;
  const pct = ((now - prev) / Math.abs(prev)) * 100;
  return <span className="text-xs text-muted-foreground">{pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)} % contra el mes anterior ({fmtMoney(prev)})</span>;
}

function Bars({ rows }: { rows: { label: string; value: number; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label}>
          <div className="flex justify-between gap-2 text-sm"><span className="truncate">{r.label}{r.note && <span className="text-muted-foreground"> · {r.note}</span>}</span><span className="kw-mono">{fmtMoney(r.value)}</span></div>
          <div className="mt-1 h-2 rounded bg-muted" aria-hidden="true"><div className="h-2 rounded bg-primary" style={{ width: `${(Math.abs(r.value) / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export default function Inicio() {
  const { active } = usePortal();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    setErr(null);
    callApi<Dash>("tablero.consultar", { client_id: active.client_id, year: ym.y, month: ym.m })
      .then(setD)
      .catch(() => { setErr("No tiene acceso al tablero completo con su rol."); setD(null); });
  }, [active, ym]);

  const months = Array.from({ length: 12 }, (_, i) => {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { y: dt.getFullYear(), m: dt.getMonth() + 1 };
  });

  const qualityTone = d?.calidad?.quality_label === "alta" ? "ok" : d?.calidad?.quality_label === "media" ? "warn" : "bad";

  return (
    <>
      <PageTitle
        title="Resumen del servicio"
        subtitle={active ? `${active.client_name} · Resumen de tu cuenta` : "Resumen de tu cuenta"}
        breadcrumb={["Kawiil", "Portal", "Inicio"]}
        icon={<LayoutDashboard />}
        actions={
          <label className="text-sm">
            <span className="mr-2 text-muted-foreground">Mes</span>
            <select
              className="h-9 rounded-md border border-border/70 bg-background px-2 text-sm"
              value={`${ym.y}-${ym.m}`}
              onChange={(e) => {
                const [y, m] = e.target.value.split("-").map(Number);
                setYm({ y, m });
              }}
            >
              {months.map((o) => (
                <option key={`${o.y}-${o.m}`} value={`${o.y}-${o.m}`}>
                  {MONTHS[o.m - 1]} {o.y}
                </option>
              ))}
            </select>
          </label>
        }
      />
      <div className="mt-3 space-y-3">
        <Notice tone="info">
          Solo lectura: aquí ves lo que el equipo de Kawiil ya tiene listo para tu cuenta.
          En esta fase el bloque fiscal es el primero disponible; RH y emisión llegan después.
        </Notice>
        <ManagementLegend />
      </div>
      {err && (
        <div className="mt-4">
          <Notice tone="warn">{err}</Notice>
        </div>
      )}
      {d && (
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <section className="surface-toolbar p-4 md:col-span-3" aria-labelledby="t-servicio">
            <h2 id="t-servicio" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Situación fiscal del periodo
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Parte del servicio publicado por Kawiil: IVA, retenciones, calidad de datos y marcas del periodo seleccionado.
            </p>
          </section>
          <section className="surface-toolbar p-4 md:col-span-3" aria-labelledby="t-calidad">
            <h2 id="t-calidad" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Calidad de datos y regla PUE/PPD
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StatusPill tone={qualityTone}>{d.calidad ? `Calidad ${d.calidad.quality_label}` : "Sin indicador"}</StatusPill>
              <StatusPill tone="wait">{d.iva_basis === "issuance" ? "Base: emisión" : "Base: flujo de efectivo"}</StatusPill>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{d.iva_basis_label ?? "Flujo de efectivo (PUE en emisión; PPD al cobro/pago)."}</p>
            {d.calidad?.quality_note && <p className="mt-1 text-sm">{d.calidad.quality_note}</p>}
            {d.leyenda && <p className="mt-1 text-xs text-muted-foreground">{d.leyenda}</p>}
          </section>

          <section className="stat-card relative overflow-hidden" aria-labelledby="t-gasto">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-rose-500/5 to-transparent" />
            <div className="relative">
              <h2 id="t-gasto" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Gasto subtotal del mes
              </h2>
              <p className="kw-mono mt-1 text-2xl font-bold tracking-tight">{fmtMoney(d.gasto_total)}</p>
              <p className="text-xs text-muted-foreground">Base gravable · IVA aparte</p>
              <Delta now={d.gasto_total} prev={d.gasto_mes_anterior} />
            </div>
          </section>
          <section className="stat-card relative overflow-hidden" aria-labelledby="t-ingreso">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-sky-500/5 to-transparent" />
            <div className="relative">
              <h2 id="t-ingreso" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Ingreso bruto del mes
              </h2>
              <p className="kw-mono mt-1 text-2xl font-bold tracking-tight">{fmtMoney(d.ingreso_total)}</p>
              <p className="text-xs text-muted-foreground">
                Neto (bruto − gasto): <span className="kw-mono">{fmtMoney(d.ingreso_total - d.gasto_total)}</span>
              </p>
            </div>
          </section>
          <section className="stat-card relative overflow-hidden" aria-labelledby="t-iva">
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-br from-amber-500/5 to-transparent" />
            <div className="relative">
              <h2 id="t-iva" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {d.iva_estimado > 0 ? "IVA por pagar (est.)" : "IVA a favor (est.)"}
              </h2>
              <p className="kw-mono mt-1 text-2xl font-bold tracking-tight">{fmtMoney(Math.abs(d.iva_estimado))}</p>
              <StatusPill tone={d.iva_estimado > 0 ? "warn" : "ok"}>{d.iva_estimado > 0 ? "por pagar" : "a favor"}</StatusPill>
              <p className="mt-1 text-xs text-muted-foreground">
                Trasladado (cobrado) {fmtMoney(d.iva.trasladado)} − acreditable (en pagos) {fmtMoney(d.iva.acreditable)}.
                {d.iva.facturas_sin_desglose > 0 && ` ${d.iva.facturas_sin_desglose} factura(s) sin desglose de IVA no cuentan.`}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{ivaEstimateExplain(active?.origin)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{ivaAudienceNote(active?.origin)}</p>
            </div>
          </section>

          <section className="surface-glass-subtle p-4 md:col-span-3" aria-labelledby="t-ret">
            <h2 id="t-ret" className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              IVA y retenciones
            </h2>
            <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">IVA retenido a su empresa</p><p className="kw-mono text-lg">{fmtMoney(d.retenciones?.iva_retenido_a_la_empresa ?? 0)}</p></div>
              <div><p className="text-xs text-muted-foreground">IVA que su empresa retuvo</p><p className="kw-mono text-lg">{fmtMoney(d.retenciones?.iva_retenido_por_la_empresa ?? 0)}</p></div>
              <div><p className="text-xs text-muted-foreground">ISR retenido a su empresa</p><p className="kw-mono text-lg">{fmtMoney(d.retenciones?.isr_retenido_a_la_empresa ?? 0)}</p></div>
              <div><p className="text-xs text-muted-foreground">ISR que su empresa retuvo</p><p className="kw-mono text-lg">{fmtMoney(d.retenciones?.isr_retenido_por_la_empresa ?? 0)}</p></div>
            </div>
            {d.iva_flujo?.por_tasa && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-muted-foreground"><th className="py-1">Tasa</th><th className="text-right">Trasladado</th><th className="text-right">Acreditable</th></tr></thead>
                  <tbody>
                    {(["16", "8", "0", "exempt"] as const).map((rate) => (
                      <tr key={rate} className="border-t">
                        <td className="py-1">{rate === "exempt" ? "Exento" : `${rate} %`}</td>
                        <td className="kw-mono text-right">{fmtMoney(d.iva_flujo!.por_tasa[rate].transferred)}</td>
                        <td className="kw-mono text-right">{fmtMoney(d.iva_flujo!.por_tasa[rate].creditable)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(d.iva_flujo?.pendientes_de_pago?.length ?? 0) > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {d.iva_flujo!.pendientes_de_pago.length} factura(s) PPD del periodo aún sin complemento de pago publicado.{" "}
                <Link className="underline" to="/facturas">Ver facturas</Link>
              </p>
            )}
          </section>

          <section className="page-list-card p-4 md:col-span-2">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Gasto por categoría</h2>
            {d.por_categoria?.length ? <Bars rows={d.por_categoria.map((c) => ({ label: c.categoria, value: c.total, note: `${c.facturas} fact.` }))} /> : <Empty>Sin gastos categorizados este mes.</Empty>}
            {d.por_confirmar > 0 && <p className="mt-2 text-xs text-muted-foreground">{d.por_confirmar} factura(s) «Por confirmar»: el equipo de Kawiil revisa su categoría.</p>}
          </section>
          <section className="page-list-card p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Principales proveedores</h2>
            {d.por_proveedor?.length ? <Bars rows={d.por_proveedor.map((p) => ({ label: p.nombre ?? p.rfc, value: p.total }))} /> : <Empty>Sin proveedores este mes.</Empty>}
          </section>
          {(d.por_mes?.length ?? 0) > 0 && (
            <section className="page-list-card p-4 md:col-span-3">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Últimos 12 meses</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-muted-foreground"><th className="py-1">Mes</th><th className="text-right">Ingresos</th><th className="text-right">Gastos</th><th className="text-right">Diferencia</th></tr></thead>
                  <tbody>{d.por_mes.map((r) => (
                    <tr key={r.mes} className="border-t"><td className="py-1">{monthLabel(r.mes)}</td><td className="kw-mono text-right">{fmtMoney(r.ingreso ?? 0)}</td><td className="kw-mono text-right">{fmtMoney(r.gasto ?? 0)}</td><td className="kw-mono text-right">{fmtMoney((r.ingreso ?? 0) - (r.gasto ?? 0))}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          )}
          <section className="page-list-card p-4 md:col-span-3">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Marcas de deducibilidad</h2>
            <p className="mb-2 text-xs text-muted-foreground">Avisos informativos del servicio publicado. Consulte a su equipo si tiene dudas.</p>
            {d.marcas?.length ? (
              <ul className="space-y-2">{d.marcas.map((m) => (
                <li key={m.cfdi_id} className="rounded-md border p-2 text-sm">
                  <div className="flex justify-between"><span>{m.emisor ?? "Proveedor"} · {fmtDate(m.fecha)}</span><span className="kw-mono">{fmtMoney(m.total)}</span></div>
                  {m.flags.map((f) => <p key={f.code} className="mt-1"><StatusPill tone="warn">Atención</StatusPill> {clientFlagReason(f)}</p>)}
                </li>))}
              </ul>
            ) : <Empty>Sin marcas este mes.</Empty>}
          </section>
        </div>
      )}
    </>
  );
}
