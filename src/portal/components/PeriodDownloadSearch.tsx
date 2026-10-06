import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { usePortal } from "../lib/session";
import { callApi, PortalApiError } from "../lib/api";
import { monthBounds, rangeBounds, todayYmd, weekBounds, type PeriodKind } from "../lib/periodBounds";
import type { CfdiRow } from "./CfdiList";
import { Notice } from "./ui";

export type PeriodSearchResult = {
  coverage: "con_datos" | "sin_datos";
  count: number;
  facturas: CfdiRow[];
  desde: string;
  hasta: string;
  label: string;
  request: { id: string; status: string; created_at: string } | null;
  requested_now: boolean;
  message: string;
};

type Props = {
  direction: "emitida" | "recibida";
  onResult: (result: PeriodSearchResult) => void;
};

export default function PeriodDownloadSearch({ direction, onResult }: Props) {
  const { active } = usePortal();
  const now = new Date();
  const [kind, setKind] = useState<PeriodKind>("mes");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [weekAnchor, setWeekAnchor] = useState(todayYmd());
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "info" | "bad"; text: string } | null>(null);
  const [lastEmpty, setLastEmpty] = useState<PeriodSearchResult | null>(null);

  function bounds() {
    if (kind === "mes") return monthBounds(year, month);
    if (kind === "semana") return weekBounds(weekAnchor);
    return rangeBounds(desde, hasta);
  }

  async function search(solicitar: boolean) {
    if (!active) return;
    setBusy(true);
    setMsg(null);
    try {
      const b = bounds();
      const data = await callApi<PeriodSearchResult>("facturas.periodo", {
        client_id: active.client_id,
        direction,
        period_kind: b.kind,
        desde: b.start,
        hasta: b.end,
        solicitar,
      });
      const enriched = { ...data, label: b.label };
      if (data.coverage === "con_datos") {
        setLastEmpty(null);
        setMsg({ tone: "ok", text: data.message || `${data.count} factura(s) en ${b.label}.` });
        onResult(enriched);
      } else {
        setLastEmpty(enriched);
        setMsg({
          tone: data.requested_now ? "ok" : "warn",
          text: data.message || (solicitar
            ? "Descarga solicitada. Cuando esté lista verás los resultados aquí."
            : "Aún no hay facturas descargadas para este periodo."),
        });
        onResult(enriched);
      }
    } catch (e) {
      setMsg({
        tone: "bad",
        text: e instanceof PortalApiError ? e.message : e instanceof Error ? e.message : "No se pudo consultar el periodo.",
      });
    } finally {
      setBusy(false);
    }
  }

  const moduleHint = direction === "emitida" ? "emitidas (ingresos)" : "recibidas (egresos)";

  return (
    <div className="surface-toolbar mb-4 space-y-3 p-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Buscar o descargar por periodo</p>
          <p className="text-xs text-muted-foreground">
            CFDI {moduleHint}. Si ya están descargadas, buscamos en tu cuenta; si no, pedimos la descarga y la guardamos.
          </p>
        </div>
        <div role="tablist" aria-label="Tipo de periodo" className="portal-pill-group">
          {([
            { id: "mes" as const, label: "Mes" },
            { id: "semana" as const, label: "Semana" },
            { id: "rango" as const, label: "Rango" },
          ]).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={kind === tab.id}
              onClick={() => setKind(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {kind === "mes" && (
          <>
            <div>
              <Label htmlFor={`pd-year-${direction}`}>Año</Label>
              <Input
                id={`pd-year-${direction}`}
                type="number"
                value={year}
                onChange={(e) => setYear(Number(e.target.value) || year)}
              />
            </div>
            <div>
              <Label htmlFor={`pd-month-${direction}`}>Mes</Label>
              <select
                id={`pd-month-${direction}`}
                className="h-10 w-full rounded-md border border-input bg-background px-2"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </>
        )}
        {kind === "semana" && (
          <div className="col-span-2">
            <Label htmlFor={`pd-week-${direction}`}>Día de la semana</Label>
            <Input
              id={`pd-week-${direction}`}
              type="date"
              value={weekAnchor}
              onChange={(e) => setWeekAnchor(e.target.value)}
            />
          </div>
        )}
        {kind === "rango" && (
          <>
            <div>
              <Label htmlFor={`pd-desde-${direction}`}>Desde</Label>
              <Input id={`pd-desde-${direction}`} type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`pd-hasta-${direction}`}>Hasta</Label>
              <Input id={`pd-hasta-${direction}`} type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
            </div>
          </>
        )}
        <div className="flex flex-wrap items-end gap-2 md:col-span-2">
          <Button type="button" disabled={busy || !active} onClick={() => void search(false)}>
            {busy ? "Buscando…" : "Buscar en cuenta"}
          </Button>
          {lastEmpty?.coverage === "sin_datos" && !lastEmpty.requested_now && lastEmpty.request?.status !== "solicitada" && (
            <Button type="button" variant="outline" disabled={busy || !active} onClick={() => void search(true)}>
              Solicitar descarga
            </Button>
          )}
          {lastEmpty?.coverage === "sin_datos" && (lastEmpty.requested_now || lastEmpty.request?.status === "solicitada") && (
            <Button type="button" variant="outline" disabled={busy || !active} onClick={() => void search(true)}>
              Volver a solicitar
            </Button>
          )}
        </div>
      </div>

      {msg && (
        <Notice tone={msg.tone === "bad" ? "bad" : msg.tone === "warn" ? "warn" : msg.tone === "ok" ? "ok" : "info"}>
          {msg.text}
        </Notice>
      )}
    </div>
  );
}
