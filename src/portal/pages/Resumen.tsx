import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
import { stripEspejoJargon } from "../lib/clientFlags";
import { shouldUseDemoFixtures } from "../lib/dataMode";
import { usePortal } from "../lib/session";
import { callApi } from "../lib/api";
import { fmtMoney, MONTHS } from "../lib/format";
import {
  brutoAudienceHint,
  ivaAudienceNote,
  ivaEstimateExplain,
} from "../lib/fiscalAudienceCopy";

interface Dash {
  gasto_total: number;
  gasto_subtotal?: number;
  gasto_mes_anterior: number;
  ingreso_total: number;
  ingreso_bruto?: number;
  ingreso_mes_anterior: number;
  ingreso_basis?: string;
  gasto_basis?: string;
  por_mes: { mes: string; gasto: number | null; ingreso: number | null }[];
  iva?: { trasladado: number; acreditable: number; facturas_sin_desglose: number };
  iva_estimado?: number;
  iva_basis?: "cash_flow" | "issuance";
  iva_basis_label?: string;
  iva_flujo?: {
    trasladado?: number;
    acreditable?: number;
    estimado?: number;
    pendientes_de_pago?: string[];
  };
  espejo?: boolean;
  leyenda?: string;
}

function pctDelta(now: number, prev: number): number | undefined {
  if (!prev) return undefined;
  return ((now - prev) / Math.abs(prev)) * 100;
}

function FixtureResumen() {
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
          label="Ingreso bruto del mes"
          value={571000}
          delta={14.7}
          tone="ingreso"
          spark={[412, 465, 438, 520, 498, 571]}
          source="sat"
          note="26 CFDI · subtotal · fixture demo"
          onExplain={() => setWhy(true)}
        />
        <KpiTile
          label="Gasto subtotal del mes"
          value={389000}
          delta={-3.9}
          tone="egreso"
          spark={[298, 331, 352, 361, 405, 389]}
          source="sat"
          note="41 CFDI · subtotal · fixture demo"
          onExplain={() => setWhy(true)}
        />
        <KpiTile
          label="Neto del mes"
          value={182000}
          delta={101.5}
          tone="neto"
          spark={[114, 134, 86, 159, 93, 182]}
          source="sat"
          note="Ingreso bruto − gasto subtotal"
        />
        <KpiTile
          label="IVA estimado"
          value={29120}
          tone="impuesto"
          source="sat"
          note="Trasladado − acreditable · fixture"
        />
      </div>

      <div className="kw-grid kw-main-cols">
        <div className="kw-grid">
          <CashflowChart
            data={CASHFLOW}
            source="sat"
            onExplain={() => setWhy(true)}
            footer="Datos de ejemplo (vista de diseño). Con sesión real verás las cifras de tu cuenta."
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
            En el demo estas cifras son de ejemplo. Con tu sesión verás las cifras reales de tu cuenta.
          </KawiilitoGuide>
          {why ? (
            <LineagePanel title="¿De dónde sale «Ingreso bruto del mes»?" subtitle={label} steps={INCOME_LINEAGE} />
          ) : null}
        </div>
      </div>
    </>
  );
}

function MirrorResumen() {
  const { active } = usePortal();
  const now = new Date();
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [why, setWhy] = useState(true);

  useEffect(() => {
    if (!active) return;
    setErr(null);
    setLoading(true);
    callApi<Dash>("tablero.consultar", { client_id: active.client_id, year: ym.y, month: ym.m })
      .then(setD)
      .catch(() => {
        setErr("No se pudo cargar el resumen de tu cuenta.");
        setD(null);
      })
      .finally(() => setLoading(false));
  }, [active, ym]);

  const months = Array.from({ length: 12 }, (_, i) => {
    const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { y: dt.getFullYear(), m: dt.getMonth() + 1 };
  });

  const client = active?.client_name ?? "Tu cuenta";
  const label = `${MONTHS[ym.m - 1]} ${ym.y}`;
  const ingreso = d?.ingreso_bruto ?? d?.ingreso_total ?? 0;
  const gasto = d?.gasto_subtotal ?? d?.gasto_total ?? 0;
  const neto = ingreso - gasto;
  const ivaTrasladado = d?.iva?.trasladado ?? d?.iva_flujo?.trasladado ?? 0;
  const ivaAcreditable = d?.iva?.acreditable ?? d?.iva_flujo?.acreditable ?? 0;
  const ivaEstimado = d?.iva_estimado ?? d?.iva_flujo?.estimado ?? (ivaTrasladado - ivaAcreditable);
  const sinDesglose = d?.iva?.facturas_sin_desglose ?? 0;
  const sparkIn = (d?.por_mes ?? []).map((r) => Math.round((r.ingreso ?? 0) / 1000)).slice(-6);
  const sparkOut = (d?.por_mes ?? []).map((r) => Math.round((r.gasto ?? 0) / 1000)).slice(-6);
  const sparkNet = (d?.por_mes ?? []).map((r) => Math.round(((r.ingreso ?? 0) - (r.gasto ?? 0)) / 1000)).slice(-6);
  const cashflow = (d?.por_mes ?? []).slice(-6).map((r) => ({
    label: r.mes?.slice(5) || "—",
    ingresos: r.ingreso ?? 0,
    egresos: r.gasto ?? 0,
    emitidas: 0,
    recibidas: 0,
  }));
  const zeroMeta = !!d && ingreso === 0 && gasto === 0;
  const origin = active?.origin;

  return (
    <>
      <PageHead
        title="Resumen"
        subtitle={`${label} · ${client}`}
        actions={
          <label className="kw-small">
            <span className="mr-2">Mes</span>
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

      {err ? <p className="kw-small" style={{ color: "var(--caution-text)", marginBottom: 16 }}>{err}</p> : null}
      {loading ? <p className="kw-small" style={{ marginBottom: 16 }}>Cargando resumen…</p> : null}
      {zeroMeta ? (
        <GlassPanel style={{ marginBottom: 16 }}>
          <p className="kw-small" style={{ margin: 0 }}>
            Totales en $0 para {client} en {label}: ya hay facturas de tu cuenta, pero algunos montos aún vienen solo como metadatos.
            No se muestran datos de ejemplo.
          </p>
        </GlassPanel>
      ) : null}

      <div className="kw-grid kw-kpis" style={{ marginBottom: 24 }}>
        <KpiTile
          label="Ingreso bruto del mes"
          value={ingreso}
          delta={pctDelta(ingreso, d?.ingreso_mes_anterior ?? 0)}
          tone="ingreso"
          spark={sparkIn.length ? sparkIn : undefined}
          source="sat"
          note={`${client} · subtotal · PUE emisión / PPD complemento`}
          onExplain={() => setWhy(true)}
        />
        <KpiTile
          label="Gasto subtotal del mes"
          value={gasto}
          delta={pctDelta(gasto, d?.gasto_mes_anterior ?? 0)}
          tone="egreso"
          spark={sparkOut.length ? sparkOut : undefined}
          source="sat"
          note={`${client} · subtotal (sin IVA)`}
          onExplain={() => setWhy(true)}
        />
        <KpiTile
          label="Neto del mes"
          value={neto}
          tone="neto"
          spark={sparkNet.length ? sparkNet : undefined}
          source="sat"
          note="Ingreso bruto − gasto subtotal"
        />
        <KpiTile
          label={ivaEstimado >= 0 ? "IVA por pagar (est.)" : "IVA a favor (est.)"}
          value={Math.abs(ivaEstimado)}
          tone="impuesto"
          source="sat"
          note={`Trasladado ${fmtMoney(ivaTrasladado)} − acreditable ${fmtMoney(ivaAcreditable)}`}
        />
      </div>

      <GlassPanel style={{ marginBottom: 24 }} tone="strong">
        <p className="kw-title" style={{ fontSize: 16 }}>IVA del periodo</p>
        <p className="kw-small" style={{ marginTop: 6 }}>
          {d?.iva_basis_label ?? "Flujo de efectivo (PUE en emisión; PPD al cobro/pago)."}
        </p>
        <div className="kw-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 16, marginTop: 16 }}>
          <div>
            <p className="kw-caption">IVA trasladado</p>
            <p className="kw-mono" style={{ fontSize: 20, margin: "4px 0 0" }}>{fmtMoney(ivaTrasladado)}</p>
            <p className="kw-small" style={{ marginTop: 4 }}>Cobrado al cliente</p>
          </div>
          <div>
            <p className="kw-caption">IVA acreditable</p>
            <p className="kw-mono" style={{ fontSize: 20, margin: "4px 0 0" }}>{fmtMoney(ivaAcreditable)}</p>
            <p className="kw-small" style={{ marginTop: 4 }}>En pagos / compras</p>
          </div>
          <div>
            <p className="kw-caption">{ivaEstimado >= 0 ? "Estimado por pagar" : "Estimado a favor"}</p>
            <p className="kw-mono" style={{ fontSize: 20, margin: "4px 0 0" }}>{fmtMoney(Math.abs(ivaEstimado))}</p>
            <p className="kw-small" style={{ marginTop: 4 }}>Trasladado − acreditable</p>
          </div>
        </div>
        <p className="kw-small" style={{ marginTop: 14 }}>
          {ivaEstimateExplain(origin)}
          {sinDesglose > 0
            ? ` ${sinDesglose} factura(s) sin desglose de IVA no cuentan en el estimado.`
            : ""}
        </p>
        {(d?.iva_flujo?.pendientes_de_pago?.length ?? 0) > 0 ? (
          <p className="kw-small" style={{ marginTop: 8 }}>
            {d!.iva_flujo!.pendientes_de_pago!.length} PPD del periodo aún sin complemento publicado.{" "}
            <Link className="underline" to="/ingresos">Ver en Ingresos</Link>
          </p>
        ) : null}
        <p className="kw-small" style={{ marginTop: 10, color: "var(--muted-foreground, #64748b)" }}>
          {ivaAudienceNote(origin)}
        </p>
        <p className="kw-small" style={{ marginTop: 6, color: "var(--muted-foreground, #64748b)" }}>
          {brutoAudienceHint(origin)}
        </p>
      </GlassPanel>

      <div className="kw-grid kw-main-cols">
        <div className="kw-grid">
          {cashflow.length ? (
            <CashflowChart
              data={cashflow}
              source="sat"
              onExplain={() => setWhy(true)}
              footer={
                (d?.leyenda ? stripEspejoJargon(d.leyenda) : "")
                || `Cifras de ${client} en solo lectura. Ingreso/gasto = subtotal; IVA en el cuadro de arriba.`
              }
            />
          ) : (
            <GlassPanel>
              <p className="kw-title" style={{ fontSize: 16 }}>Flujo del periodo</p>
              <p className="kw-small" style={{ marginTop: 8 }}>
                {loading
                  ? "Cargando serie…"
                  : `Aún no hay serie mensual para ${client}. No se muestran datos de ejemplo.`}
              </p>
            </GlassPanel>
          )}
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
            title={`${label} · ${client}`}
            actions={[
              { label: "¿De dónde sale?", primary: true, onClick: () => setWhy(true) },
              { label: "Ocultar rastro", text: true, onClick: () => setWhy(false) },
            ]}
          >
            {origin === "kawiil"
              ? `Estas cifras son de ${client}. Tu contador de Kawiil te apoya con lo deducible y el tratamiento correcto.`
              : `Estas cifras son estimadas a partir de los CFDI de ${client}. No son consejo fiscal; consulta a un contador.`}
          </KawiilitoGuide>
          {why ? (
            <LineagePanel
              title="¿De dónde sale «Ingreso bruto del mes»?"
              subtitle={`${label} · ${client}`}
              steps={INCOME_LINEAGE}
            />
          ) : null}
        </div>
      </div>
    </>
  );
}

export default function Resumen() {
  if (shouldUseDemoFixtures()) return <FixtureResumen />;
  return <MirrorResumen />;
}
