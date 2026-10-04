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
import { CASHFLOW, INCOME_LINEAGE, SAMPLE_CLIENT, SAMPLE_PERIOD } from "../lib/sampleData";

export default function Resumen() {
  const [period, setPeriod] = useState<PeriodId>("mes");
  const [why, setWhy] = useState(true);

  return (
    <>
      <PageHead
        title="Resumen"
        subtitle={`${SAMPLE_PERIOD} · ${SAMPLE_CLIENT}`}
        actions={<PeriodSwitch value={period} onChange={setPeriod} label={SAMPLE_PERIOD} />}
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
            title="Septiembre cerró en $182,000 de neto"
            actions={[{ label: "¿De dónde sale?", primary: true, onClick: () => setWhy(true) }]}
          >
            Tus ingresos subieron frente a agosto y tus egresos bajaron un poco.
          </KawiilitoGuide>
          {why ? (
            <LineagePanel title="¿De dónde sale «Ingresos del mes»?" subtitle={SAMPLE_PERIOD} steps={INCOME_LINEAGE} />
          ) : null}
        </div>
      </div>
    </>
  );
}
