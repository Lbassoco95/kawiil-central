import { useEffect, useState } from "react";
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
import { MONTHS } from "../lib/format";

interface Dash {
  gasto_total: number;
  gasto_mes_anterior: number;
  ingreso_total: number;
  ingreso_mes_anterior: number;
  por_mes: { mes: string; gasto: number | null; ingreso: number | null }[];
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
          label="Ingresos del mes"
          value={571000}
          delta={14.7}
          tone="ingreso"
          spark={[412, 465, 438, 520, 498, 571]}
          source="sat"
          note="26 CFDI emitidos · fixture demo"
          onExplain={() => setWhy(true)}
        />
        <KpiTile
          label="Egresos del mes"
          value={389000}
          delta={-3.9}
          tone="egreso"
          spark={[298, 331, 352, 361, 405, 389]}
          source="sat"
          note="41 CFDI recibidos · fixture demo"
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
            <LineagePanel title="¿De dónde sale «Ingresos del mes»?" subtitle={label} steps={INCOME_LINEAGE} />
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
  const ingreso = d?.ingreso_total ?? 0;
  const gasto = d?.gasto_total ?? 0;
  const neto = ingreso - gasto;
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
            No se muestran datos de ejemplo (hoteles Tulum / constructora ficticia).
          </p>
        </GlassPanel>
      ) : null}

      <div className="kw-grid kw-kpis" style={{ marginBottom: 24 }}>
        <KpiTile
          label="Ingresos del mes"
          value={ingreso}
          delta={pctDelta(ingreso, d?.ingreso_mes_anterior ?? 0)}
          tone="ingreso"
          spark={sparkIn.length ? sparkIn : undefined}
          source="sat"
          note={`${client} · CFDI de tu cuenta`}
          onExplain={() => setWhy(true)}
        />
        <KpiTile
          label="Egresos del mes"
          value={gasto}
          delta={pctDelta(gasto, d?.gasto_mes_anterior ?? 0)}
          tone="egreso"
          spark={sparkOut.length ? sparkOut : undefined}
          source="sat"
          note={`${client} · CFDI de tu cuenta`}
          onExplain={() => setWhy(true)}
        />
        <KpiTile
          label="Neto del mes"
          value={neto}
          tone="neto"
          spark={sparkNet.length ? sparkNet : undefined}
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
          {cashflow.length ? (
            <CashflowChart
              data={cashflow}
              source="sat"
              onExplain={() => setWhy(true)}
              footer={
                (d?.leyenda ? stripEspejoJargon(d.leyenda) : "")
                || `Cifras de ${client} en solo lectura. Sin consultas al SAT desde esta pantalla.`
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
            Estas cifras son de {client}: el equipo de Kawiil ya las tiene listas aquí. En esta fase solo consultas.
          </KawiilitoGuide>
          {why ? (
            <LineagePanel title="¿De dónde sale «Ingresos del mes»?" subtitle={`${label} · ${client}`} steps={INCOME_LINEAGE} />
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
