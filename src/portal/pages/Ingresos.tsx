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
  INCOME_GROUPS,
  INCOME_INVOICES,
  SAMPLE_PERIOD,
  TOP_CLIENTS,
} from "../lib/sampleData";

export default function Ingresos() {
  const [period, setPeriod] = useState<PeriodId>("mes");

  return (
    <>
      <PageHead
        title="Ingresos"
        subtitle={`${SAMPLE_PERIOD} · CFDI emitidos vigentes`}
        actions={<PeriodSwitch value={period} onChange={setPeriod} label={SAMPLE_PERIOD} />}
      />

      <div className="kw-grid kw-kpis" style={{ marginBottom: 24 }}>
        <KpiTile label="Ingresos del periodo" value={571000} delta={14.7} tone="ingreso" spark={[412, 465, 438, 520, 498, 571]} note="26 CFDI" />
        <KpiTile label="Cliente principal" value={185000} tone="ingreso" note="Constructora Aldea del Sol · 32%" />
      </div>

      <div className="kw-grid" style={{ marginBottom: 24 }}>
        <CashflowChart
          data={CASHFLOW}
          title="Ingresos por mes"
          series="ingresos"
          footer="Solo CFDI emitidos vigentes. Datos de ejemplo."
        />
      </div>

      <div className="kw-grid kw-two" style={{ marginBottom: 24 }}>
        <RankedList title="Clientes que más compran" items={TOP_CLIENTS} tone="ingreso" />
        <GroupBreakdown title="Ingresos por tipo de venta" groups={INCOME_GROUPS} tone="ingreso" />
      </div>

      <div className="kw-grid kw-main-cols">
        <InvoiceTable title="Facturas más grandes" rows={INCOME_INVOICES} partyLabel="Cliente" />
        <div className="kw-grid">
          <KawiilitoGuide pose="datos" title="Confirma qué fue cada factura">
            Kawiil propone el tipo. Tú eliges una respuesta cerrada; tu contador registra.
          </KawiilitoGuide>
          <ClassificationPrompt
            invoice={{
              date: "28 sep 2026",
              party: "Constructora Aldea del Sol",
              folio: "8C1E4A27-5D3B-4F90-A6E2-7B90D1C3F548",
              total: 120000,
              concept: "Servicio de supervisión de obra — septiembre",
            }}
            proposal="Ingreso por servicio"
            options={[
              { id: "producto", label: "No, fue un producto" },
              { id: "otro", label: "No, fue otra cosa" },
            ]}
            flag="El concepto dice servicio, pero la clave del CFDI parece de mercancía. Conviene revisar la emisión."
          />
          <GlassPanel>
            <p className="kw-caption">Códigos de cuenta</p>
            <p className="kw-small" style={{ margin: "6px 0 0" }}>
              Los códigos con asterisco (401.01*) son ilustrativos. No eliges cuentas: solo confirmas o corriges qué fue.
            </p>
          </GlassPanel>
        </div>
      </div>
    </>
  );
}
