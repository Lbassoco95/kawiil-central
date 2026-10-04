import { useEffect, useState } from "react";
import {
  CashflowChart,
  ClassificationPrompt,
  GlassPanel,
  GroupBreakdown,
  InvoiceTable,
  KawiilitoGuide,
  KpiTile,
  PageHead,
  PeriodSwitch,
  RankedList,
} from "../design/primitives";
import type { PeriodId } from "../design/types";
import {
  CASHFLOW,
  EXPENSE_GROUPS,
  EXPENSE_INVOICES,
  TOP_SUPPLIERS,
} from "../lib/sampleData";
import { clampPeriodIndex, notifyPeriod, periodLabel } from "../lib/periodDemo";
import { pushDemoToast } from "../lib/demoStore";
import { shouldUseDemoFixtures } from "../lib/dataMode";
import { usePortal } from "../lib/session";
import { listMirrorInvoices, rankParties, sumTotals, toInvoiceRows } from "../lib/mirrorInvoices";

function FixtureEgresos() {
  const [period, setPeriod] = useState<PeriodId>("mes");
  const [idx, setIdx] = useState(2);
  const label = periodLabel(period, idx);

  return (
    <>
      <PageHead
        title="Egresos"
        subtitle={`${label} · CFDI recibidos vigentes · fixture demo`}
        actions={
          <PeriodSwitch
            value={period}
            onChange={(id) => {
              setPeriod(id);
              setIdx(2);
              notifyPeriod(periodLabel(id, 2));
            }}
            label={label}
            onPrev={() => {
              const next = clampPeriodIndex(period, idx - 1);
              setIdx(next);
              notifyPeriod(periodLabel(period, next));
            }}
            onNext={() => {
              const next = clampPeriodIndex(period, idx + 1);
              setIdx(next);
              notifyPeriod(periodLabel(period, next));
            }}
          />
        }
      />

      <div className="kw-grid kw-kpis" style={{ marginBottom: 24 }}>
        <KpiTile label="Egresos del periodo" value={389000} delta={-3.9} tone="egreso" spark={[298, 331, 352, 361, 405, 389]} note="41 CFDI" />
        <KpiTile label="Por clasificar" value={134000} tone="egreso" source="pendiente" note="15 facturas sin respuesta" />
      </div>

      <div className="kw-grid" style={{ marginBottom: 24 }}>
        <CashflowChart data={CASHFLOW} title="Egresos por mes" series="egresos" footer="Solo CFDI recibidos vigentes. Fixture demo (equivalente al espejo publicado)." />
      </div>

      <div className="kw-grid kw-two" style={{ marginBottom: 24 }}>
        <RankedList title="Proveedores principales" items={TOP_SUPPLIERS} tone="egreso" />
        <GroupBreakdown title="Gastos por grupo" groups={EXPENSE_GROUPS} tone="egreso" />
      </div>

      <div className="kw-grid kw-main-cols">
        <InvoiceTable title="Facturas más grandes" rows={EXPENSE_INVOICES} partyLabel="Proveedor" />
        <div className="kw-grid">
          <KawiilitoGuide pose="pendientes" title="Hay facturas por clasificar">
            Empieza por las de café y gasolina. Una respuesta cerrada basta para que tu contador registre.
          </KawiilitoGuide>
          <ClassificationPrompt
            kind="gasto"
            invoice={{
              date: "18 sep 2026",
              party: "Café Plaza Maya",
              folio: "F33C44D5-6677-8899-0011-CCDDEEFF0011",
              total: 1860,
              concept: "Consumo en cafetería",
            }}
            proposal="Café de la oficina"
            options={[
              { id: "cliente", label: "No, fue comida con cliente" },
              { id: "otro", label: "No, fue otra cosa" },
            ]}
            onAnswer={(id) => pushDemoToast({ tone: "ok", text: `Clasificación demo (${id}) enviada al seguimiento del contador.` })}
          />
          <GlassPanel tone="strong">
            <p className="kw-title" style={{ fontSize: 16 }}>Aviso</p>
            <p className="kw-small" style={{ margin: "6px 0 0" }}>
              15 facturas siguen sin clasificar. No mostramos cobranza ni saldos de Savio en esta aplicación.
            </p>
          </GlassPanel>
        </div>
      </div>
    </>
  );
}

function MirrorEgresos() {
  const { active } = usePortal();
  const [rows, setRows] = useState(EXPENSE_INVOICES);
  const [total, setTotal] = useState(0);
  const [rank, setRank] = useState(TOP_SUPPLIERS);
  const [pendingAmount, setPendingAmount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    listMirrorInvoices(active.client_id, "recibida")
      .then((list) => {
        const vigentes = list.filter((r) => r.sat_status !== "cancelado");
        const pending = vigentes.filter((r) => r.category_status !== "confirmada");
        setRows(toInvoiceRows(vigentes, "recibida"));
        setTotal(sumTotals(vigentes));
        setRank(rankParties(vigentes, "recibida"));
        setPendingAmount(sumTotals(pending));
        setPendingCount(pending.length);
        setErr(null);
      })
      .catch(() => setErr("No se pudo leer el espejo de facturas recibidas."));
  }, [active]);

  return (
    <>
      <PageHead
        title="Egresos"
        subtitle={`${active?.client_name ?? "Portal"} · CFDI recibidos ya publicados`}
      />
      {err ? <p className="kw-small" style={{ color: "var(--caution-text)", marginBottom: 16 }}>{err}</p> : null}
      <div className="kw-grid kw-kpis" style={{ marginBottom: 24 }}>
        <KpiTile label="Egresos publicados" value={total} tone="egreso" note={`${rows.length} CFDI en el espejo`} source="sat" />
        <KpiTile label="Por clasificar" value={pendingAmount} tone="egreso" source="pendiente" note={`${pendingCount} facturas sin categoría confirmada`} />
      </div>
      <div className="kw-grid kw-two" style={{ marginBottom: 24 }}>
        <RankedList title="Proveedores (espejo local)" items={rank} tone="egreso" />
        <GlassPanel>
          <p className="kw-title" style={{ fontSize: 16 }}>Solo representación</p>
          <p className="kw-small" style={{ marginTop: 8 }}>
            Lectura de `facturas.listar` sobre tablas portal. Central publica con `invoice.publish`; OS no consulta el SAT.
          </p>
        </GlassPanel>
      </div>
      <InvoiceTable title="Facturas recibidas publicadas" rows={rows} partyLabel="Proveedor" />
    </>
  );
}

export default function Egresos() {
  if (shouldUseDemoFixtures()) return <FixtureEgresos />;
  return <MirrorEgresos />;
}
