import { useEffect, useState } from "react";
import { usePortal } from "../lib/session";
import { db } from "../lib/supabase";
import { fmtDate, fmtMoney, MONTHS, monthLabel } from "../lib/format";
import { Empty, ManagementLegend, Notice, PageTitle, StatusPill } from "../components/ui";

interface Dash {
  gasto_total: number; gasto_mes_anterior: number; ingreso_total: number; ingreso_mes_anterior: number;
  por_categoria: { categoria: string; por_confirmar: boolean; total: number; facturas: number }[];
  por_proveedor: { rfc: string; nombre: string | null; total: number; facturas: number }[];
  por_mes: { mes: string; gasto: number | null; ingreso: number | null }[];
  iva: { trasladado: number; acreditable: number; facturas_sin_desglose: number };
  iva_estimado: number;
  marcas: { cfdi_id: string; emisor: string | null; total: number; fecha: string; flags: { code: string; reason: string }[] }[];
  por_confirmar: number;
}

function Delta({ now, prev }: { now: number; prev: number }) {
  if (!prev) return <span className="text-xs text-muted-foreground">sin mes anterior para comparar</span>;
  const pct = ((now - prev) / Math.abs(prev)) * 100;
  return <span className="text-xs text-muted-foreground">{pct >= 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)} % contra el mes anterior ({fmtMoney(prev)})</span>;
}

/** Barra horizontal etiquetada: el valor siempre va escrito, la barra solo acompaña. */
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
    db.rpc("portal_dashboard", { _client_id: active.client_id, _year: ym.y, _month: ym.m }).then(({ data, error }) => {
      if (error) setErr("No tiene acceso al tablero completo con su rol.");
      setD((data as Dash) ?? null);
    });
  }, [active, ym]);

  const months = Array.from({ length: 12 }, (_, i) => {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { y: dt.getFullYear(), m: dt.getMonth() + 1 };
  });

  return (
    <>
      <PageTitle
        title="En qué se va su dinero"
        subtitle={active?.client_name}
        actions={
          <label className="text-sm">
            <span className="mr-2">Mes</span>
            <select className="rounded-md border px-2 py-1" value={`${ym.y}-${ym.m}`} onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); setYm({ y, m }); }}>
              {months.map((o) => <option key={`${o.y}-${o.m}`} value={`${o.y}-${o.m}`}>{MONTHS[o.m - 1]} {o.y}</option>)}
            </select>
          </label>
        }
      />
      <ManagementLegend />
      {err && <div className="mt-4"><Notice tone="warn">{err}</Notice></div>}
      {d && (
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <section className="rounded-xl border bg-card p-4" aria-labelledby="t-gasto">
            <h2 id="t-gasto" className="text-lg">Gasto del mes</h2>
            <p className="kw-mono text-2xl">{fmtMoney(d.gasto_total)}</p>
            <Delta now={d.gasto_total} prev={d.gasto_mes_anterior} />
          </section>
          <section className="rounded-xl border bg-card p-4" aria-labelledby="t-ingreso">
            <h2 id="t-ingreso" className="text-lg">Ingresos del mes</h2>
            <p className="kw-mono text-2xl">{fmtMoney(d.ingreso_total)}</p>
            <p className="text-xs text-muted-foreground">Ingresos menos gastos: <span className="kw-mono">{fmtMoney(d.ingreso_total - d.gasto_total)}</span></p>
          </section>
          <section className="rounded-xl border bg-card p-4" aria-labelledby="t-iva">
            <h2 id="t-iva" className="text-lg">IVA estimado</h2>
            <p className="kw-mono text-2xl">{fmtMoney(Math.abs(d.iva_estimado))}</p>
            <StatusPill tone={d.iva_estimado > 0 ? "warn" : "ok"}>{d.iva_estimado > 0 ? "a cargo" : "a favor"}</StatusPill>
            <p className="mt-1 text-xs text-muted-foreground">Trasladado {fmtMoney(d.iva.trasladado)} − acreditable {fmtMoney(d.iva.acreditable)}.
              {d.iva.facturas_sin_desglose > 0 && ` ${d.iva.facturas_sin_desglose} factura(s) sin desglose de IVA no cuentan.`}</p>
          </section>

          <section className="rounded-xl border bg-card p-4 md:col-span-2">
            <h2 className="mb-2 text-lg">Gasto por categoría</h2>
            {d.por_categoria.length ? <Bars rows={d.por_categoria.map((c) => ({ label: c.categoria, value: c.total, note: `${c.facturas} fact.` }))} /> : <Empty>Sin gastos este mes.</Empty>}
            {d.por_confirmar > 0 && <p className="mt-2 text-xs text-muted-foreground">{d.por_confirmar} factura(s) «Por confirmar»: el equipo de Kawiil revisa su categoría.</p>}
          </section>
          <section className="rounded-xl border bg-card p-4">
            <h2 className="mb-2 text-lg">Principales proveedores</h2>
            {d.por_proveedor.length ? <Bars rows={d.por_proveedor.map((p) => ({ label: p.nombre ?? p.rfc, value: p.total }))} /> : <Empty>Sin proveedores este mes.</Empty>}
          </section>
          <section className="rounded-xl border bg-card p-4 md:col-span-3">
            <h2 className="mb-2 text-lg">Últimos 12 meses</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted-foreground"><th className="py-1">Mes</th><th className="text-right">Ingresos</th><th className="text-right">Gastos</th><th className="text-right">Diferencia</th></tr></thead>
                <tbody>{d.por_mes.map((r) => (
                  <tr key={r.mes} className="border-t"><td className="py-1">{monthLabel(r.mes)}</td><td className="kw-mono text-right">{fmtMoney(r.ingreso ?? 0)}</td><td className="kw-mono text-right">{fmtMoney(r.gasto ?? 0)}</td><td className="kw-mono text-right">{fmtMoney((r.ingreso ?? 0) - (r.gasto ?? 0))}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </section>
          <section className="rounded-xl border bg-card p-4 md:col-span-3">
            <h2 className="mb-2 text-lg">Marcas de deducibilidad</h2>
            <p className="mb-2 text-xs text-muted-foreground">Avisos informativos: no bloquean nada. Consulte a su equipo si tiene dudas.</p>
            {d.marcas.length ? (
              <ul className="space-y-2">{d.marcas.map((m) => (
                <li key={m.cfdi_id} className="rounded-md border p-2 text-sm">
                  <div className="flex justify-between"><span>{m.emisor ?? "Proveedor"} · {fmtDate(m.fecha)}</span><span className="kw-mono">{fmtMoney(m.total)}</span></div>
                  {m.flags.map((f) => <p key={f.code} className="mt-1"><StatusPill tone="warn">Atención</StatusPill> {f.reason}</p>)}
                </li>))}
              </ul>
            ) : <Empty>Sin marcas este mes.</Empty>}
          </section>
        </div>
      )}
    </>
  );
}
