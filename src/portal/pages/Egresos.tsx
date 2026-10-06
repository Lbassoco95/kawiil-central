import { useEffect, useMemo, useState } from "react";
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
import { accountOnlyCfdi, isPendingDetailCfdi } from "../lib/cfdiPresentation";
import { listMirrorInvoices, mirrorSourceNote, rankParties, sumTotals, toInvoiceRows } from "../lib/mirrorInvoices";
import { calendarMonthBounds } from "../lib/periodIncome";
import CfdiList, { type CfdiRow } from "../components/CfdiList";
import PeriodDownloadSearch, { type PeriodSearchResult } from "../components/PeriodDownloadSearch";

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
        <CashflowChart data={CASHFLOW} title="Egresos por mes" series="egresos" footer="Solo CFDI recibidos vigentes. Datos de ejemplo (vista de diseño)." />
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
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<ReturnType<typeof toInvoiceRows>>([]);
  const [count, setCount] = useState(0);
  const [pendingAmountCount, setPendingAmountCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [rank, setRank] = useState<ReturnType<typeof rankParties>>([]);
  const [pendingAmount, setPendingAmount] = useState(0);
  const [pendingCount, setPendingCount] = useState(0);
  const [sourceNote, setSourceNote] = useState("facturas de tu cuenta");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [periodRows, setPeriodRows] = useState<CfdiRow[] | null>(null);
  const [periodDefaults, setPeriodDefaults] = useState<{ desde: string; hasta: string } | null>(null);

  const bounds = useMemo(() => calendarMonthBounds(year, month), [year, month]);

  useEffect(() => {
    if (!active) return;
    setLoading(true);
    listMirrorInvoices(active.client_id, "recibida")
      .then((list) => {
        const vigentes = list.filter((r) => r.sat_status !== "cancelado");
        const account = accountOnlyCfdi(vigentes);
        const inPeriod = account.filter((r) => {
          const d = String(r.fecha ?? "").slice(0, 10);
          return d >= bounds.start && d <= bounds.end;
        });
        const unclassified = account.filter((r) => r.category_status !== "confirmada");
        setRows(toInvoiceRows(account, "recibida"));
        setCount(account.length);
        setPendingAmountCount(account.filter(isPendingDetailCfdi).length);
        setTotal(sumTotals(inPeriod.length ? inPeriod : account));
        setRank(rankParties(account, "recibida"));
        setPendingAmount(sumTotals(unclassified));
        setPendingCount(unclassified.length);
        setSourceNote(mirrorSourceNote(account));
        setErr(null);
      })
      .catch(() => {
        setRows([]);
        setCount(0);
        setPendingAmountCount(0);
        setRank([]);
        setErr("No se pudieron cargar las facturas recibidas de tu cuenta.");
      })
      .finally(() => setLoading(false));
  }, [active, bounds.start, bounds.end]);

  const client = active?.client_name ?? "Tu cuenta";
  const kpiNote = total > 0
    ? `${count} CFDI · ${bounds.label} · ${sourceNote}`
    : `${count} CFDI · montos aún no publicados · ${sourceNote}`;

  function shiftMonth(delta: number) {
    const d = new Date(Date.UTC(year, month - 1 + delta, 1));
    setYear(d.getUTCFullYear());
    setMonth(d.getUTCMonth() + 1);
  }

  function onPeriodResult(r: PeriodSearchResult) {
    setPeriodDefaults({ desde: r.desde, hasta: r.hasta });
    setPeriodRows(r.coverage === "con_datos" ? r.facturas : []);
  }

  return (
    <>
      <PageHead
        title="Egresos"
        subtitle={`${client} · CFDI recibidas · ${sourceNote}`}
        actions={
          <PeriodSwitch
            value="mes"
            onChange={() => {}}
            label={bounds.label}
            onPrev={() => shiftMonth(-1)}
            onNext={() => shiftMonth(1)}
          />
        }
      />
      {err ? <p className="kw-small" style={{ color: "var(--caution-text)", marginBottom: 16 }}>{err}</p> : null}
      {loading ? <p className="kw-small" style={{ marginBottom: 16 }}>Cargando facturas…</p> : null}
      {pendingAmountCount > 0 ? (
        <GlassPanel style={{ marginBottom: 16 }}>
          <p className="kw-small" style={{ margin: 0 }}>
            {pendingAmountCount} factura{pendingAmountCount === 1 ? "" : "s"} reales de tu cuenta aparecen con «Detalle pendiente»
            (proveedor, folio y fecha sí; monto/método aún no publicados).
          </p>
        </GlassPanel>
      ) : null}
      <div className="kw-grid kw-kpis" style={{ marginBottom: 24 }}>
        <KpiTile label="Egresos del periodo" value={total} tone="egreso" note={kpiNote} source="sat" />
        <KpiTile label="Por clasificar" value={pendingAmount} tone="egreso" source="pendiente" note={`${pendingCount} facturas sin categoría confirmada`} />
      </div>
      <div className="kw-grid kw-two" style={{ marginBottom: 24 }}>
        <RankedList title="Proveedores principales" items={rank} tone="egreso" />
        <GlassPanel>
          <p className="kw-title" style={{ fontSize: 16 }}>CFDI recibidas</p>
          <p className="kw-small" style={{ marginTop: 8 }}>
            Facturas que te emitieron proveedores. Para que Kawiil emita a partir de un ticket → Facturación → Subir ticket.
            Aquí consultas el archivo SatGo y puedes buscar o solicitar descarga por periodo.
          </p>
        </GlassPanel>
      </div>
      <InvoiceTable title="Resumen de recibidas" rows={rows} partyLabel="Proveedor" />
      <div style={{ marginTop: 28 }}>
        <h2 className="kw-title" style={{ fontSize: 18, marginBottom: 12 }}>CFDI recibidas · estatus</h2>
        <PeriodDownloadSearch direction="recibida" onResult={onPeriodResult} />
        <CfdiList
          direction="recibida"
          rows={periodRows}
          periodDefaults={periodDefaults}
        />
      </div>
    </>
  );
}

export default function Egresos() {
  if (shouldUseDemoFixtures()) return <FixtureEgresos />;
  return <MirrorEgresos />;
}
