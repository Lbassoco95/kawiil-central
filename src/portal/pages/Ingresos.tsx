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
  INCOME_GROUPS,
  INCOME_INVOICES,
  TOP_CLIENTS,
} from "../lib/sampleData";
import { clampPeriodIndex, notifyPeriod, periodLabel } from "../lib/periodDemo";
import { pushDemoToast } from "../lib/demoStore";
import { shouldUseDemoFixtures } from "../lib/dataMode";
import { usePortal } from "../lib/session";
import { listMirrorInvoices, mirrorSourceNote, rankParties, sumTotals, toInvoiceRows } from "../lib/mirrorInvoices";

function FixtureIngresos() {
  const [period, setPeriod] = useState<PeriodId>("mes");
  const [idx, setIdx] = useState(2);
  const label = periodLabel(period, idx);

  return (
    <>
      <PageHead
        title="Ingresos"
        subtitle={`${label} · CFDI emitidos vigentes · fixture demo`}
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
        <KpiTile label="Ingresos del periodo" value={571000} delta={14.7} tone="ingreso" spark={[412, 465, 438, 520, 498, 571]} note="26 CFDI" />
        <KpiTile label="Cliente principal" value={185000} tone="ingreso" note="Constructora Aldea del Sol · 32%" />
      </div>

      <div className="kw-grid" style={{ marginBottom: 24 }}>
        <CashflowChart
          data={CASHFLOW}
          title="Ingresos por mes"
          series="ingresos"
          footer="Solo CFDI emitidos vigentes. Fixture demo (equivalente al espejo publicado)."
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
            onAnswer={(id) => pushDemoToast({ tone: "ok", text: `Respuesta demo guardada (${id}). Tu contador la verá en central.` })}
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

function MirrorIngresos() {
  const { active } = usePortal();
  const [rows, setRows] = useState<ReturnType<typeof toInvoiceRows>>([]);
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [rank, setRank] = useState<ReturnType<typeof rankParties>>([]);
  const [sourceNote, setSourceNote] = useState("espejo local");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    listMirrorInvoices(active.client_id, "emitida")
      .then((list) => {
        const vigentes = list.filter((r) => r.sat_status !== "cancelado");
        setRows(toInvoiceRows(vigentes, "emitida"));
        setCount(vigentes.length);
        setTotal(sumTotals(vigentes));
        setRank(rankParties(vigentes, "emitida"));
        setSourceNote(mirrorSourceNote(vigentes));
        setErr(null);
      })
      .catch(() => {
        setRows([]);
        setCount(0);
        setRank([]);
        setErr("No se pudo leer el espejo de facturas emitidas.");
      })
      .finally(() => setLoading(false));
  }, [active]);

  const zeroMeta = count > 0 && total === 0;
  const client = active?.client_name ?? "Portal";

  return (
    <>
      <PageHead
        title="Ingresos"
        subtitle={`${client} · CFDI emitidos publicados · ${sourceNote}`}
      />
      {err ? <p className="kw-small" style={{ color: "var(--caution-text)", marginBottom: 16 }}>{err}</p> : null}
      {loading ? <p className="kw-small" style={{ marginBottom: 16 }}>Cargando representación publicada…</p> : null}
      {zeroMeta ? (
        <GlassPanel style={{ marginBottom: 16 }}>
          <p className="kw-small" style={{ margin: 0 }}>
            Hay {count} CFDI emitidos de {client} en el espejo; los montos vienen en $0 (metadatos SatGo sin XML completo).
            No son fixtures de demo.
          </p>
        </GlassPanel>
      ) : null}
      <div className="kw-grid kw-kpis" style={{ marginBottom: 24 }}>
        <KpiTile
          label="Ingresos publicados"
          value={total}
          tone="ingreso"
          note={`${count} CFDI · ${sourceNote}`}
          source="sat"
        />
        <KpiTile
          label="Cliente principal"
          value={rank[0]?.amount ?? 0}
          tone="ingreso"
          note={rank[0] ? `${rank[0].name} · ${rank[0].share}%` : loading ? "Cargando…" : "Sin datos publicados aún"}
          source="sat"
        />
      </div>
      <div className="kw-grid kw-two" style={{ marginBottom: 24 }}>
        <RankedList title="Clientes (espejo local)" items={rank} tone="ingreso" />
        <GlassPanel>
          <p className="kw-title" style={{ fontSize: 16 }}>Solo representación</p>
          <p className="kw-small" style={{ marginTop: 8 }}>
            Lectura de `facturas.listar` sobre tablas portal de {client}. Central publica con `invoice.publish`; OS no consulta el SAT.
          </p>
        </GlassPanel>
      </div>
      <InvoiceTable title="Facturas emitidas publicadas" rows={rows} partyLabel="Cliente" />
    </>
  );
}

export default function Ingresos() {
  if (shouldUseDemoFixtures()) return <FixtureIngresos />;
  return <MirrorIngresos />;
}
