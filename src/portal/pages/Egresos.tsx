import { useState } from "react";
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

export default function Egresos() {
  const [period, setPeriod] = useState<PeriodId>("mes");
  const [idx, setIdx] = useState(2);
  const label = periodLabel(period, idx);

  return (
    <>
      <PageHead
        title="Egresos"
        subtitle={`${label} · CFDI recibidos vigentes`}
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
        <CashflowChart data={CASHFLOW} title="Egresos por mes" series="egresos" footer="Solo CFDI recibidos vigentes. Datos de ejemplo." />
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
