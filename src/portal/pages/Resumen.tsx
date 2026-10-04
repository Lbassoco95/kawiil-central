import { useState } from "react";
import {
  CashflowChart,
  GlassPanel,
  KawiilitoGuide,
  KpiTile,
  LineagePanel,
  PageHead,
  PeriodSwitch,
} from "../design/primitives";
import type { PeriodId } from "../design/types";
import { CASHFLOW, INCOME_LINEAGE, SAMPLE_CLIENT } from "../lib/sampleData";
import { clampPeriodIndex, notifyPeriod, periodLabel } from "../lib/periodDemo";

export default function Resumen() {
  const [period, setPeriod] = useState<PeriodId>("mes");
  const [idx, setIdx] = useState(2);
  const [why, setWhy] = useState(true);
  const label = periodLabel(period, idx);

  return (
    <>
      <PageHead
        title="Resumen"
        subtitle={`${label} · ${SAMPLE_CLIENT}`}
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
        <KpiTile
          label="Ingresos del mes"
          value={571000}
          delta={14.7}
          tone="ingreso"
          spark={[412, 465, 438, 520, 498, 571]}
          source="sat"
          note="26 CFDI emitidos"
          onExplain={() => setWhy(true)}
        />
        <KpiTile
          label="Egresos del mes"
          value={389000}
          delta={-3.9}
          tone="egreso"
          spark={[298, 331, 352, 361, 405, 389]}
          source="sat"
          note="41 CFDI recibidos"
          onExplain={() => setWhy(true)}
        />
        <KpiTile
          label="Neto del mes"
          value={182000}
          delta={101.5}
          tone="neto"
          spark={[114, 134, 86, 159, 93, 182]}
          source="sat"
          note="Ingresos − egresos"
        />
        <KpiTile
          label="Estados financieros"
          value={null}
          tone="impuesto"
          source="pendiente"
          note="Disponible desde enero 2027"
        />
      </div>

      <div className="kw-grid kw-main-cols">
        <div className="kw-grid">
          <CashflowChart
            data={CASHFLOW}
            source="sat"
            onExplain={() => setWhy(true)}
            footer="Datos de ejemplo. Cuenta CFDI vigentes por fecha de emisión; los cancelados no entran."
          />
          <GlassPanel tone="strong">
            <div className="kw-eeff-lock">
              <div>
                <h3 className="kw-title">Estados financieros</h3>
                <p className="kw-small" style={{ margin: "2px 0 0" }}>
                  Disponible desde enero 2027. Mientras tanto no inventamos cifras: este bloque queda pendiente.
                </p>
              </div>
              <span className="kw-caption" style={{ color: "var(--caution-text)" }}>
                Pendiente
              </span>
            </div>
          </GlassPanel>
        </div>
        <div className="kw-grid">
          <KawiilitoGuide
            pose="cifras"
            title={`${label} · neto $182,000 (ejemplo)`}
            actions={[
              { label: "¿De dónde sale?", primary: true, onClick: () => setWhy(true) },
              { label: "Ocultar rastro", text: true, onClick: () => setWhy(false) },
            ]}
          >
            Tus ingresos subieron frente al periodo anterior y tus egresos bajaron un poco.
          </KawiilitoGuide>
          {why ? (
            <LineagePanel title="¿De dónde sale «Ingresos del mes»?" subtitle={label} steps={INCOME_LINEAGE} />
          ) : null}
        </div>
      </div>
    </>
  );
}
