import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useMoffinConsultsByClient } from "@/hooks/useMoffinConsultsByClient";
import {
  certConsultLine,
  lista69bHeadline,
  moffinConsultNeedsApiSync,
  pickLatestMoffinByType,
} from "@/lib/moffinDisplay";
import { MoffinPdfActions } from "@/components/clients/MoffinPdfActions";
import { format, differenceInMinutes } from "date-fns";
import { es } from "date-fns/locale";
import { Landmark, Loader2, RefreshCw, ExternalLink, KeyRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  functionInvokeUserMessageAsync,
  invokeFunctionWithSession,
} from "@/lib/supabaseInvoke";
import { useCallback, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MOFFIN_USE_SOLUTIONS } from "@/lib/moffinUseSolutions";

const toneClass: Record<string, string> = {
  ok: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200",
  warn: "bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200",
  muted: "bg-muted text-muted-foreground",
  bad: "bg-destructive/15 text-destructive",
};

const MOFFIN_TYPE_LABEL: Record<string, string> = MOFFIN_USE_SOLUTIONS
  ? {
      lista_69b: "Lista 69-B",
      constancia_situacion_fiscal: "CSF (SAT)",
      opinion_cumplimiento: "32D (SAT)",
    }
  : {
      lista_69b: "Lista 69-B",
      constancia_situacion_fiscal: "RFC · constancia",
      opinion_cumplimiento: "RFC · opinión",
    };

interface Props {
  clientId: string;
  /** Título de la tarjeta (mismo contenido en cliente vs contabilidad) */
  title?: string;
  className?: string;
  /**
   * Cliente y proyectos: cuando se pasan (vista Detalle de Cliente), se muestra un pie
   * con RFC, nota de custodia e.firma y accesos a las consultas del proyecto.
   * En la pestaña Contabilidad del proyecto se omiten (ahí ya hay panel completo).
   */
  client?: Tables<"clients">;
  projects?: Tables<"projects">[];
}

export function MoffinSatStatusSummary({
  clientId,
  title = "SAT (SATgo)",
  className,
  client,
  projects,
}: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accountingProjects = useMemo(
    () =>
      (projects ?? []).filter(
        (p) =>
          (p.area === "contabilidad" || p.area === "softlanding") && p.status !== "cancelado",
      ),
    [projects],
  );
  const showFiscalFooter = !!client;
  const managedByFirm = client?.sat_fiel_managed_by_firm !== false;
  const { data: rows = [], isLoading } = useMoffinConsultsByClient(clientId);
  const [syncBusy, setSyncBusy] = useState(false);
  const byType = pickLatestMoffinByType(rows);

  const hasPendingSyncable = useMemo(
    () => rows.some((r) => r.consult_type === "lista_69b" && moffinConsultNeedsApiSync(r)),
    [rows],
  );

  const stalePending = useMemo(
    () =>
      rows.some(
        (r) =>
          r.consult_type === "lista_69b" &&
          r.status === "pending" &&
          r.moffin_query_id &&
          r.created_at &&
          differenceInMinutes(Date.now(), new Date(r.created_at)) >= 10,
      ),
    [rows],
  );

  const syncWithMoffin = useCallback(async () => {
    if (!user) {
      toast.error("Inicia sesión para sincronizar.");
      return;
    }
    setSyncBusy(true);
    try {
      const { data, error } = await invokeFunctionWithSession("moffin-query", {
        refreshPendingForClientId: clientId,
      });
      const payload = (data ?? {}) as {
        refresh?: boolean;
        results?: Array<{ ok: boolean; error?: string; newStatus?: string }>;
        pendingFound?: number;
        error?: string;
        message?: string;
      };
      if (payload.error || error) {
        toast.error(await functionInvokeUserMessageAsync(data, error));
        return;
      }
      const failed = payload.results?.filter((r) => !r.ok) ?? [];
      const okRows = payload.results?.filter((r) => r.ok) ?? [];
      const stillPending = okRows.filter((r) => r.newStatus === "pending").length;
      if (failed.length) {
        toast.warning(
          `Sincronización parcial: ${failed.length} consulta(s). ${failed[0]?.error ?? ""}`.trim(),
        );
      } else if (payload.pendingFound === 0) {
        toast.success("No había consultas pendientes con ID en Moffin.");
      } else if (stillPending > 0) {
        toast("Sincronización lista — Moffin en cola", {
          description: `Es normal: ${stillPending} consulta(s) aún en cola; la tabla en pendiente y sin PDF hasta éxito. No es un error. Revisa el webhook (Svix) o sincroniza más tarde.`,
        });
      } else {
        toast.success("Estado actualizado desde Moffin (éxito; PDF si tu plan lo entrega).");
      }
      await queryClient.refetchQueries({ queryKey: ["moffin-consults-client", clientId] });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al sincronizar");
    } finally {
      setSyncBusy(false);
    }
  }, [clientId, queryClient, user]);
  const r69 = lista69bHeadline(byType.get("lista_69b"));
  const constancia = certConsultLine(
    "CSF · constancia (SATgo)",
    byType.get("constancia_situacion_fiscal")
  );
  const opinion = certConsultLine(
    "32D · opinión (SATgo)",
    byType.get("opinion_cumplimiento")
  );

  const fmtDate = (iso: string | undefined) =>
    iso
      ? format(new Date(iso), "dd MMM yyyy HH:mm", { locale: es })
      : "—";

  // Solo 69-B sigue siendo asíncrono; CSF/32D con SATgo son PDF inmediato.
  return (
    <section className={cn("rounded-xl border border-border/60 bg-card/40 p-5 shadow-sm", className)}>
      <h2 className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
        <Landmark className="h-3.5 w-3.5" />
        {title}
      </h2>
      <p className="text-[10px] text-muted-foreground leading-snug mb-3">
        Constancia (CSF) y opinión 32D se descargan con la <strong className="font-medium text-foreground/80">e.firma</strong> del
        cliente vía <strong className="font-medium text-foreground/80">SATgo</strong> (PDF al momento). Sube .cer, .key y
        contraseña en Certificados SAT. Lista 69-B sigue aparte.
      </p>
      {!isLoading && hasPendingSyncable ? (
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {stalePending ? (
            <p className="text-[11px] text-amber-900 dark:text-amber-100 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 flex-1 min-w-[220px] leading-snug">
              La lista 69-B lleva varios minutos en pendiente. Puedes sincronizar cuando el resultado ya esté listo.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1 shrink-0"
            disabled={syncBusy || !user}
            onClick={syncWithMoffin}
          >
            {syncBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Sincronizar 69-B
          </Button>
        </div>
      ) : null}
      {isLoading ? (
        <p className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando…
        </p>
      ) : (
        <>
        <ul className="space-y-3 text-[13px]">
          <li className="rounded-md border border-border/60 p-3 bg-background/40">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-muted-foreground text-xs font-medium">Lista 69-B</span>
              <Badge className={toneClass[r69.tone] ?? toneClass.muted}>{r69.title}</Badge>
            </div>
            {r69.detail ? (
              <p className="text-xs text-muted-foreground leading-snug">{r69.detail}</p>
            ) : null}
            {byType.get("lista_69b")?.created_at ? (
              <p className="text-[10px] text-muted-foreground mt-1">
                Última consulta: {fmtDate(byType.get("lista_69b")!.created_at)}
              </p>
            ) : null}
          </li>
          <li className="rounded-md border border-border/60 p-3 bg-background/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                  <span className="text-muted-foreground text-xs font-medium">Opinión 32D (SATgo)</span>
                  <Badge
                    variant="outline"
                    className={toneClass[opinion.tone] ?? toneClass.muted}
                  >
                    {opinion.title}
                  </Badge>
                </div>
                {opinion.detail ? (
                  <p className="text-xs text-muted-foreground line-clamp-2">{opinion.detail}</p>
                ) : null}
                {byType.get("opinion_cumplimiento")?.created_at ? (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {fmtDate(byType.get("opinion_cumplimiento")!.created_at)}
                  </p>
                ) : null}
              </div>
              {opinion.hasFile && byType.get("opinion_cumplimiento")?.documents?.file_path ? (
                <MoffinPdfActions
                  className="shrink-0"
                  filePath={byType.get("opinion_cumplimiento")!.documents!.file_path!}
                  fileName={byType.get("opinion_cumplimiento")?.documents?.name}
                />
              ) : null}
            </div>
          </li>
          <li className="rounded-md border border-border/60 p-3 bg-background/40">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-0.5">
                  <span className="text-muted-foreground text-xs font-medium">Constancia CSF (SATgo)</span>
                  <Badge
                    variant="outline"
                    className={toneClass[constancia.tone] ?? toneClass.muted}
                  >
                    {constancia.title}
                  </Badge>
                </div>
                {constancia.detail ? (
                  <p className="text-xs text-muted-foreground line-clamp-2">{constancia.detail}</p>
                ) : null}
                {byType.get("constancia_situacion_fiscal")?.created_at ? (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {fmtDate(byType.get("constancia_situacion_fiscal")!.created_at)}
                  </p>
                ) : null}
              </div>
              {constancia.hasFile && byType.get("constancia_situacion_fiscal")?.documents?.file_path ? (
                <MoffinPdfActions
                  className="shrink-0"
                  filePath={byType.get("constancia_situacion_fiscal")!.documents!.file_path!}
                  fileName={byType.get("constancia_situacion_fiscal")?.documents?.name}
                />
              ) : null}
            </div>
          </li>
        </ul>
        {rows.length > 0 ? (
          <div className="mt-4 pt-4 border-t border-border/60 space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">Historial reciente (por consulta)</h3>
            <div className="max-h-56 overflow-auto rounded-md border border-border/60">
              <table className="w-full text-left text-[11px]">
                <thead className="bg-muted/40 text-muted-foreground sticky top-0">
                  <tr>
                    <th className="p-2 font-medium">Tipo</th>
                    <th className="p-2 font-medium">Estado</th>
                    <th className="p-2 font-medium">Fecha</th>
                    <th className="p-2 font-medium min-w-[120px]">PDF</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 40).map((hist) => {
                    const hdoc = hist.documents;
                    const label = MOFFIN_TYPE_LABEL[hist.consult_type] ?? hist.consult_type;
                    const histBadgeVariant =
                      hist.status === "success"
                        ? "default"
                        : hist.status === "fail" || hist.status === "error"
                          ? "destructive"
                          : "secondary";
                    return (
                      <tr key={hist.id} className="border-t border-border/50">
                        <td className="p-2 font-medium align-top">{label}</td>
                        <td className="p-2 align-top">
                          <Badge variant={histBadgeVariant} className="text-[10px]">
                            {hist.status}
                          </Badge>
                        </td>
                        <td className="p-2 text-muted-foreground whitespace-nowrap align-top">
                          {fmtDate(hist.created_at)}
                        </td>
                        <td className="p-2 align-top">
                          {hdoc?.file_path ? (
                            <MoffinPdfActions
                              className="shrink-0"
                              filePath={hdoc.file_path}
                              fileName={hdoc.name}
                            />
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        </>
      )}
      {showFiscalFooter ? (
        <div className="mt-4 pt-4 border-t border-border/60 space-y-2.5 text-[12px] text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <span>RFC:</span>
            {client?.rfc ? (
              <code className="text-[11px] bg-muted/60 px-1.5 py-0.5 rounded">{client.rfc}</code>
            ) : (
              <span className="text-amber-700 dark:text-amber-400">Agrega el RFC en Editar cliente.</span>
            )}
            {managedByFirm ? (
              <Badge variant="secondary" className="text-[10px] gap-1 font-normal">
                <KeyRound className="h-3 w-3" />
                e.firma custodiada por el despacho
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] font-normal">
                e.firma no marcada como custodia del despacho
              </Badge>
            )}
          </div>
          {client?.sat_fiel_location_hint ? (
            <p className="border-l-2 border-primary/30 pl-3">
              <span>Referencia interna: </span>
              <span className="text-foreground whitespace-pre-wrap">{client.sat_fiel_location_hint}</span>
            </p>
          ) : null}
          {accountingProjects.length === 0 ? (
            <p className="text-amber-700 dark:text-amber-400">
              No hay proyecto de contabilidad (o softlanding) activo para este cliente. Activa el servicio o crea el
              proyecto para ejecutar las consultas SAT.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2 pt-0.5">
              {accountingProjects.map((p) => (
                <Button
                  key={p.id}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-[12px]"
                  onClick={() => navigate(`/proyectos/${p.id}?tab=contabilidad`)}
                >
                  Ir a consultas — {p.name}
                  <ExternalLink className="h-3 w-3 opacity-70" />
                </Button>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
