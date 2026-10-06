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
import { accountOnlyCfdi, isPendingDetailCfdi } from "../lib/cfdiPresentation";
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
          footer="Solo CFDI emitidos vigentes. Datos de ejemplo (vista de diseño)."
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
  const [pendingAmountCount, setPendingAmountCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [rank, setRank] = useState<ReturnType<typeof rankParties>>([]);
  const [sourceNote, setSourceNote] = useState("facturas de tu cuenta");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    listMirrorInvoices(active.client_id, "emitida")
      .then((list) => {
        const vigentes = list.filter((r) => r.sat_status !== "cancelado");
        const account = accountOnlyCfdi(vigentes);
        setRows(toInvoiceRows(account, "emitida"));
        setCount(account.length);
        setPendingAmountCount(account.filter(isPendingDetailCfdi).length);
        setTotal(sumTotals(account));
        setRank(rankParties(account, "emitida"));
        setSourceNote(mirrorSourceNote(account));
        setErr(null);
      })
      .catch(() => {
        setRows([]);
        setCount(0);
        setPendingAmountCount(0);
        setRank([]);
        setErr("No se pudieron cargar las facturas emitidas de tu cuenta.");
      })
      .finally(() => setLoading(false));
  }, [active]);

  const client = active?.client_name ?? "Tu cuenta";
  const kpiNote = total > 0
    ? `${count} CFDI · ${sourceNote}`
    : `${count} CFDI · montos aún no publicados · ${sourceNote}`;

  return (
    <>
      <PageHead
        title="Ingresos"
        subtitle={`${client} · CFDI emitidos · ${sourceNote}`}
      />
      {err ? <p className="kw-small" style={{ color: "var(--caution-text)", marginBottom: 16 }}>{err}</p> : null}
      {loading ? <p className="kw-small" style={{ marginBottom: 16 }}>Cargando facturas…</p> : null}
      {pendingAmountCount > 0 ? (
        <GlassPanel style={{ marginBottom: 16 }}>
          <p className="kw-small" style={{ margin: 0 }}>
            {pendingAmountCount} factura{pendingAmountCount === 1 ? "" : "s"} reales de tu cuenta aparecen con «Detalle pendiente»
            (folio, fecha y contraparte sí; monto/método aún no publicados). Mejor vacío real que un ejemplo inventado.
          </p>
        </GlassPanel>
      ) : null}
      <div className="kw-grid kw-kpis" style={{ marginBottom: 24 }}>
        <KpiTile
          label="Ingresos del periodo"
          value={total}
          tone="ingreso"
          note={kpiNote}
          source="sat"
        />
        <KpiTile
          label="Cliente principal"
          value={rank[0]?.amount ?? 0}
          tone="ingreso"
          note={rank[0] ? `${rank[0].name} · ${rank[0].share}%` : loading ? "Cargando…" : "Sin facturas aún"}
          source="sat"
        />
      </div>
      <div className="kw-grid kw-two" style={{ marginBottom: 24 }}>
        <RankedList title="Clientes que más compran" items={rank} tone="ingreso" />
        <GlassPanel>
          <p className="kw-title" style={{ fontSize: 16 }}>Solo consulta</p>
          <p className="kw-small" style={{ marginTop: 8 }}>
            Facturas emitidas de {client}. En esta fase no cargas XML ni creas facturas desde aquí; si necesitas algo, escribe por Mensajes.
          </p>
        </GlassPanel>
      </div>
      <InvoiceTable title="Facturas emitidas" rows={rows} partyLabel="Cliente" />
    </>
  );
}

export default function Ingresos() {
  if (shouldUseDemoFixtures()) return <FixtureIngresos />;
  return <MirrorIngresos />;
}
