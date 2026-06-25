import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ChevronLeft, ChevronRight, Check, Minus, KeyRound, UserCheck, FileText, ShieldCheck, AlertTriangle, Loader2, Send,
} from "lucide-react";
import { useSatCoverage, type SatDoc } from "@/hooks/useSatCoverage";
import { MoffinPdfActions } from "@/components/clients/MoffinPdfActions";
import { invokeFunctionWithSession, functionInvokeUserMessageAsync } from "@/lib/supabaseInvoke";

type ConsultType = "constancia_situacion_fiscal" | "opinion_cumplimiento";

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function StatCard({
  icon: Icon, label, value, hint, tone = "default",
}: {
  icon: typeof KeyRound;
  label: string;
  value: number;
  hint?: string;
  tone?: "default" | "ok" | "warn";
}) {
  const toneCls =
    tone === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="rounded-lg bg-muted p-2 shrink-0">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <div className={`text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
          <div className="text-xs text-muted-foreground truncate">{label}</div>
          {hint ? <div className="text-[11px] text-muted-foreground/70">{hint}</div> : null}
        </div>
      </CardContent>
    </Card>
  );
}

function YesNo({ ok, okLabel, noLabel }: { ok: boolean; okLabel: string; noLabel: string }) {
  return ok ? (
    <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
      <Check className="h-3.5 w-3.5" /> {okLabel}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-muted-foreground">
      <Minus className="h-3.5 w-3.5" /> {noLabel}
    </span>
  );
}

/** Celda de CSF/32D: muestra el visor si ya se descargó, o un botón para solicitarla. */
function ConsultCell({
  downloaded, doc, canRequest, busy, onRequest,
}: {
  downloaded: boolean;
  doc: SatDoc | null;
  canRequest: boolean;
  busy: boolean;
  onRequest: () => void;
}) {
  if (downloaded) {
    return doc ? (
      <MoffinPdfActions filePath={doc.filePath} fileName={doc.name} />
    ) : (
      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs">
        <Check className="h-3.5 w-3.5" /> Descargada
      </span>
    );
  }
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 px-2 text-[11px] gap-1"
      disabled={!canRequest || busy}
      onClick={onRequest}
      title={canRequest ? "Solicitar a Moffin" : "Requiere CIEC registrada y proyecto de contabilidad"}
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
      Solicitar
    </Button>
  );
}

export function SatCoverageTab() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month0, setMonth0] = useState(now.getMonth());

  const { data, isLoading, error } = useSatCoverage(year, month0);
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const toggleBusy = (key: string, on: boolean) =>
    setBusy((prev) => {
      const n = new Set(prev);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });

  const requestConsult = async (clientId: string, projectId: string | null, type: ConsultType) => {
    if (!projectId) {
      toast.error("El cliente no tiene proyecto de contabilidad para disparar la consulta.");
      return;
    }
    if (!window.confirm("Cada consulta puede generar un cargo según tu plan con Moffin. ¿Continuar?")) {
      return;
    }
    const key = `${clientId}:${type}`;
    toggleBusy(key, true);
    try {
      const { data: res, error: invErr } = await invokeFunctionWithSession("moffin-query", {
        projectId,
        consultType: type,
      });
      if (invErr || (res as { error?: string } | null)?.error) {
        toast.error(await functionInvokeUserMessageAsync(res, invErr));
        return;
      }
      toast.success("Consulta solicitada. Puede tardar unos minutos en Moffin; vuelve a revisar.");
      queryClient.invalidateQueries({ queryKey: ["sat-coverage", year, month0] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo solicitar la consulta");
    } finally {
      toggleBusy(key, false);
    }
  };

  const goPrev = () => {
    if (month0 === 0) { setYear((y) => y - 1); setMonth0(11); }
    else setMonth0((m) => m - 1);
  };
  const goNext = () => {
    if (month0 === 11) { setYear((y) => y + 1); setMonth0(0); }
    else setMonth0((m) => m + 1);
  };
  const isCurrentMonth = year === now.getFullYear() && month0 === now.getMonth();

  const totals = data?.totals;
  const clients = data?.clients ?? [];

  const coveragePct = useMemo(() => {
    if (!totals || totals.withAccess === 0) return 0;
    return Math.round((totals.withCiec / totals.withAccess) * 100);
  }, [totals]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Cobertura SAT (Moffin)
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Clientes activos con proyecto de contabilidad/softlanding (con acceso a CSF y opinión 32D).
            La descarga automática corre los primeros 5 días de cada mes para los que tienen CIEC.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard icon={ShieldCheck} label="Con acceso a SAT" value={totals?.withAccess ?? 0} />
            <StatCard icon={UserCheck} label="Con responsable" value={totals?.withResponsible ?? 0} />
            <StatCard icon={KeyRound} label="Con CIEC" value={totals?.withCiec ?? 0} tone="ok" hint={`${coveragePct}% cobertura`} />
            <StatCard icon={AlertTriangle} label="Sin CIEC" value={totals?.withoutCiec ?? 0} tone="warn" />
            <StatCard icon={FileText} label="CSF este mes" value={totals?.csfDownloaded ?? 0} tone="ok" />
            <StatCard icon={FileText} label="32D este mes" value={totals?.opinionDownloaded ?? 0} tone="ok" />
          </div>

          {/* Selector de mes */}
          <div className="flex items-center justify-between rounded-lg border border-border/50 bg-background/40 px-3 py-2">
            <Button variant="ghost" size="sm" onClick={goPrev} className="gap-1">
              <ChevronLeft className="h-4 w-4" /> Anterior
            </Button>
            <div className="text-sm font-medium">
              {MONTHS_ES[month0]} {year}
              {isCurrentMonth ? <Badge variant="outline" className="ml-2 text-[10px]">mes actual</Badge> : null}
            </div>
            <Button variant="ghost" size="sm" onClick={goNext} disabled={isCurrentMonth} className="gap-1">
              Siguiente <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
            </div>
          ) : error ? (
            <div className="p-4 text-sm text-destructive">Error al cargar: {(error as Error).message}</div>
          ) : clients.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">
              No hay clientes activos con proyecto de contabilidad/softlanding.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left text-xs text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Cliente</th>
                    <th className="px-4 py-2 font-medium">Responsable</th>
                    <th className="px-4 py-2 font-medium">CIEC</th>
                    <th className="px-4 py-2 font-medium">CSF ({MONTHS_ES[month0].slice(0, 3)})</th>
                    <th className="px-4 py-2 font-medium">32D ({MONTHS_ES[month0].slice(0, 3)})</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map((c) => (
                    <tr key={c.clientId} className="border-b border-border/30 last:border-0 hover:bg-muted/40">
                      <td className="px-4 py-2 font-medium">{c.name}</td>
                      <td className="px-4 py-2">
                        {c.responsibleName ? (
                          <span className="text-foreground">{c.responsibleName}</span>
                        ) : c.responsibleUserId ? (
                          <span className="text-muted-foreground">Asignado</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" /> Sin responsable
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <YesNo ok={c.hasCiec} okLabel="Registrada" noLabel="Falta" />
                      </td>
                      <td className="px-4 py-2">
                        <ConsultCell
                          downloaded={c.csfDownloaded}
                          doc={c.csfDoc}
                          canRequest={c.hasCiec && !!c.projectId}
                          busy={busy.has(`${c.clientId}:constancia_situacion_fiscal`)}
                          onRequest={() => requestConsult(c.clientId, c.projectId, "constancia_situacion_fiscal")}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <ConsultCell
                          downloaded={c.opinionDownloaded}
                          doc={c.opinionDoc}
                          canRequest={c.hasCiec && !!c.projectId}
                          busy={busy.has(`${c.clientId}:opinion_cumplimiento`)}
                          onRequest={() => requestConsult(c.clientId, c.projectId, "opinion_cumplimiento")}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
