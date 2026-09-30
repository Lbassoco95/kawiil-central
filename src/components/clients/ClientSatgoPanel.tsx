import { useCallback, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MoffinPdfActions } from "@/components/clients/MoffinPdfActions";
import { ClientSatCertificatesSection } from "@/components/clients/ClientSatCertificatesSection";
import { SatgoBuzonDetailDialog } from "@/components/clients/SatgoBuzonDetailDialog";
import { useMoffinConsultsByClient } from "@/hooks/useMoffinConsultsByClient";
import { useClientSatCertificates } from "@/hooks/useClientSatCertificates";
import {
  moffinConsultNeedsApiSync,
  pickLatestMoffinByType,
} from "@/lib/moffinDisplay";
import {
  parseComunicadosFromRaw,
  parseNotificacionesFromRaw,
} from "@/lib/satgoBuzonParse";
import {
  SATGO_CONSULT_META,
  satgoConsultLabel,
  type SatgoConsultType,
} from "@/lib/satgoConsultMeta";
import {
  functionInvokeUserMessageAsync,
  invokeFunctionWithSession,
} from "@/lib/supabaseInvoke";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import type { Tables } from "@/integrations/supabase/types";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  ChevronDown,
  Eye,
  KeyRound,
  Landmark,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

type ProjectRow = {
  id: string;
  name: string;
  area: string | null;
  status: string;
};
type ClientRow = Pick<
  Tables<"clients">,
  "id" | "rfc" | "sat_fiel_managed_by_firm" | "sat_fiel_location_hint" | "name"
>;

function isAccountingProject(p: ProjectRow): boolean {
  return (
    (p.area === "contabilidad" || p.area === "softlanding") &&
    p.status !== "cancelado"
  );
}

function statusDot(status: string | undefined): {
  label: string;
  className: string;
} {
  if (status === "success") return { label: "Listo", className: "bg-emerald-500" };
  if (status === "fail" || status === "error") {
    return { label: "Error", className: "bg-destructive" };
  }
  if (status === "pending") return { label: "Pendiente", className: "bg-amber-500" };
  return { label: "Sin consultar", className: "bg-muted-foreground/40" };
}

interface Props {
  clientId: string;
  client?: ClientRow;
  projects?: ProjectRow[];
  className?: string;
}

/**
 * Panel unificado SATgo en la ficha General de cada cliente:
 * 1) e.firma / CSD  2) botones de consulta  3) estado e historial (mismo formato siempre).
 */
export function ClientSatgoPanel({
  clientId,
  client,
  projects = [],
  className,
}: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: certs } = useClientSatCertificates(clientId);
  const { data: rows = [], isLoading } = useMoffinConsultsByClient(clientId);
  const [busy, setBusy] = useState<SatgoConsultType | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [buzonDetail, setBuzonDetail] = useState<{
    kind: "buzon_comunicados" | "buzon_notificaciones";
    raw: unknown;
    at: string | null;
  } | null>(null);

  const accountingProjects = useMemo(
    () => projects.filter(isAccountingProject),
    [projects],
  );
  const [projectId, setProjectId] = useState<string>("");
  const effectiveProjectId = useMemo(() => {
    if (projectId && accountingProjects.some((p) => p.id === projectId)) {
      return projectId;
    }
    return accountingProjects[0]?.id ?? "";
  }, [projectId, accountingProjects]);

  const satgoReady = !!certs?.satgoJweReady || !!certs?.fiel?.satgoJweReady;
  const byType = pickLatestMoffinByType(rows);
  const hasPendingSync = useMemo(
    () => rows.some((r) => r.consult_type === "lista_69b" && moffinConsultNeedsApiSync(r)),
    [rows],
  );

  const fmtDate = (iso: string | undefined) =>
    iso
      ? format(new Date(iso), "dd MMM yyyy HH:mm", { locale: es })
      : "—";

  const invalidateConsults = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["moffin-consults-client", clientId] }),
      queryClient.invalidateQueries({ queryKey: ["client-documents", clientId] }),
      queryClient.invalidateQueries({ queryKey: ["documents"] }),
      ...accountingProjects.map((p) =>
        queryClient.invalidateQueries({ queryKey: ["moffin-consults", p.id] }),
      ),
    ]);
  }, [queryClient, clientId, accountingProjects]);

  const runConsult = useCallback(
    async (consultType: SatgoConsultType) => {
      const meta = SATGO_CONSULT_META[consultType];
      if (!effectiveProjectId) {
        toast.error(
          "Necesitas un proyecto de contabilidad o softlanding activo para registrar la consulta.",
        );
        return;
      }
      if (meta.needsFiel && !satgoReady) {
        toast.error("Sube la e.firma (.cer/.key + contraseña) en la sección de certificados.");
        document.getElementById("sat-certificates")?.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
        });
        return;
      }
      if (
        !window.confirm(
          `Consultar «${meta.label}» vía SATgo puede generar un cargo según tu plan. ¿Continuar?`,
        )
      ) {
        return;
      }
      setBusy(consultType);
      try {
        const { data, error } = await invokeFunctionWithSession("satgo-query", {
          projectId: effectiveProjectId,
          consultType,
        });
        const payload = (data ?? {}) as { error?: string; consult?: unknown };
        if (payload.error || error) {
          toast.error(await functionInvokeUserMessageAsync(data, error));
          if (payload.consult) await invalidateConsults();
          return;
        }
        toast.success(`${meta.short} registrado`);
        await invalidateConsults();
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "Error al consultar SATgo");
      } finally {
        setBusy(null);
      }
    },
    [effectiveProjectId, satgoReady, invalidateConsults],
  );

  const sync69b = useCallback(async () => {
    if (!user) return;
    setSyncBusy(true);
    try {
      const { data, error } = await invokeFunctionWithSession("moffin-query", {
        refreshPendingForClientId: clientId,
      });
      const payload = (data ?? {}) as { error?: string; message?: string };
      if (payload.error || error) {
        toast.error(await functionInvokeUserMessageAsync(data, error));
        return;
      }
      toast.success("Sincronización 69-B lista");
      await invalidateConsults();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al sincronizar");
    } finally {
      setSyncBusy(false);
    }
  }, [user, clientId, invalidateConsults]);

  return (
    <section
      id="satgo"
      className={cn(
        "rounded-xl border border-border/60 bg-card/40 p-5 shadow-sm space-y-5",
        className,
      )}
    >
      <header className="space-y-1">
        <h2 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <Landmark className="h-4 w-4 text-muted-foreground" />
          SAT · SATgo
        </h2>
        <p className="text-[11px] text-muted-foreground leading-snug max-w-3xl">
          Mismo formato para todos los clientes: carga la e.firma una vez y consulta 69-B, CSF, 32D
          y buzón tributario (comunicados / notificaciones) desde aquí. Los resultados quedan en el
          historial del cliente.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        <span>RFC:</span>
        {client?.rfc ? (
          <code className="text-[11px] bg-muted/60 px-1.5 py-0.5 rounded text-foreground">
            {client.rfc}
          </code>
        ) : (
          <span className="text-amber-700 dark:text-amber-400">
            Agrega el RFC en Editar cliente (o súbelo vía .cer).
          </span>
        )}
        {satgoReady ? (
          <Badge
            variant="secondary"
            className="text-[10px] gap-1 font-normal bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
          >
            <KeyRound className="h-3 w-3" />
            e.firma lista (JWE)
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] font-normal text-amber-800 dark:text-amber-200">
            Sin e.firma JWE
          </Badge>
        )}
        {client?.sat_fiel_managed_by_firm !== false ? (
          <Badge variant="secondary" className="text-[10px] font-normal">
            Custodia del despacho
          </Badge>
        ) : null}
      </div>

      {/* 1. Credenciales */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-foreground">1. Credenciales SAT</h3>
        <ClientSatCertificatesSection
          clientId={clientId}
          clientRfc={client?.rfc ?? null}
          embedded
        />
      </div>

      {/* 2. Consultas */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold text-foreground">2. Consultas SATgo</h3>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              69-B solo necesita RFC. CSF, 32D y buzón requieren e.firma.
            </p>
          </div>
          {accountingProjects.length > 1 ? (
            <div className="min-w-[200px]">
              <label className="text-[10px] text-muted-foreground block mb-1">
                Proyecto contable
              </label>
              <Select
                value={effectiveProjectId}
                onValueChange={setProjectId}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Elegir proyecto" />
                </SelectTrigger>
                <SelectContent>
                  {accountingProjects.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : accountingProjects.length === 1 ? (
            <p className="text-[10px] text-muted-foreground">
              Proyecto: <span className="text-foreground font-medium">{accountingProjects[0].name}</span>
            </p>
          ) : (
            <p className="text-[10px] text-amber-700 dark:text-amber-400 max-w-xs text-right">
              Activa un proyecto de contabilidad o softlanding para poder consultar.
            </p>
          )}
        </div>

        <div className="space-y-2.5">
          <div>
            <p className="text-[10px] font-medium text-muted-foreground mb-1.5">
              Documentos / listas
            </p>
            <div className="flex flex-wrap gap-2">
              {(["lista_69b", "constancia_situacion_fiscal", "opinion_cumplimiento"] as SatgoConsultType[]).map(
                (key) => {
                  const meta = SATGO_CONSULT_META[key];
                  const Icon = meta.icon;
                  const disabled =
                    !!busy ||
                    !effectiveProjectId ||
                    (meta.needsFiel && !satgoReady);
                  return (
                    <Button
                      key={key}
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={disabled}
                      title={
                        !effectiveProjectId
                          ? "Falta proyecto contable"
                          : meta.needsFiel && !satgoReady
                            ? "Sube la e.firma primero"
                            : meta.label
                      }
                      onClick={() => void runConsult(key)}
                    >
                      {busy === key ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Icon className="h-3.5 w-3.5" />
                      )}
                      {meta.short}
                    </Button>
                  );
                },
              )}
              {hasPendingSync ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="gap-1.5"
                  disabled={syncBusy}
                  onClick={() => void sync69b()}
                >
                  {syncBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Sincronizar 69-B
                </Button>
              ) : null}
            </div>
          </div>

          <div className="rounded-md border border-border/60 bg-muted/15 p-2.5 space-y-1.5">
            <p className="text-[10px] font-medium text-foreground">
              Buzón tributario
            </p>
            <p className="text-[10px] text-muted-foreground leading-snug">
              Comunicados y notificaciones del portal SAT (misma e.firma JWE). El resultado queda
              en el historial del cliente, igual para todos.
            </p>
            <div className="flex flex-wrap gap-2">
              {(["buzon_comunicados", "buzon_notificaciones"] as SatgoConsultType[]).map((key) => {
                const meta = SATGO_CONSULT_META[key];
                const Icon = meta.icon;
                const disabled = !!busy || !effectiveProjectId || !satgoReady;
                return (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    disabled={disabled}
                    title={
                      !effectiveProjectId
                        ? "Falta proyecto contable"
                        : !satgoReady
                          ? "Sube la e.firma primero"
                          : meta.label
                    }
                    onClick={() => void runConsult(key)}
                  >
                    {busy === key ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Icon className="h-3.5 w-3.5" />
                    )}
                    {meta.short}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Estado unificado */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-foreground">3. Estado actual</h3>
        {isLoading ? (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando consultas…
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] font-medium text-muted-foreground">Documentos / listas</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {(["lista_69b", "constancia_situacion_fiscal", "opinion_cumplimiento"] as SatgoConsultType[]).map(
                (key) => {
                  const row = byType.get(key);
                  const meta = SATGO_CONSULT_META[key];
                  const st = statusDot(row?.status);
                  const doc = row?.documents as
                    | { file_path?: string | null; name?: string | null }
                    | null
                    | undefined;
                  const isErr = row?.status === "fail" || row?.status === "error";
                  const isOk = row?.status === "success";
                  return (
                    <div
                      key={key}
                      className="rounded-md border border-border/60 bg-background/40 p-2.5 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-foreground">{meta.short}</span>
                        <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <span className={`h-1.5 w-1.5 rounded-full ${st.className}`} />
                          {st.label}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {row?.created_at ? fmtDate(row.created_at) : "Aún sin consultar"}
                      </p>
                      {isOk && row?.summary ? (
                        <p
                          className="text-[10px] text-muted-foreground leading-tight line-clamp-3"
                          title={row.summary}
                        >
                          {row.summary}
                        </p>
                      ) : null}
                      {isErr && row?.error_message ? (
                        <p
                          className="text-[10px] text-destructive leading-tight line-clamp-2"
                          title={row.error_message}
                        >
                          {row.error_message}
                        </p>
                      ) : null}
                      {doc?.file_path ? (
                        <MoffinPdfActions filePath={doc.file_path} fileName={doc.name} />
                      ) : null}
                    </div>
                  );
                },
              )}
            </div>

            <p className="text-[10px] font-medium text-muted-foreground pt-1">Buzón tributario</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["buzon_comunicados", "buzon_notificaciones"] as const).map((key) => {
                const row = byType.get(key);
                const meta = SATGO_CONSULT_META[key];
                const st = statusDot(row?.status);
                const isErr = row?.status === "fail" || row?.status === "error";
                const isOk = row?.status === "success";
                const comunicados =
                  key === "buzon_comunicados" && isOk
                    ? parseComunicadosFromRaw(row?.raw_response)
                    : [];
                const notifs =
                  key === "buzon_notificaciones" && isOk
                    ? parseNotificacionesFromRaw(row?.raw_response)
                    : null;
                const itemCount =
                  key === "buzon_comunicados"
                    ? comunicados.length
                    : (notifs?.all.length ?? 0);

                return (
                  <div
                    key={key}
                    className="rounded-md border border-border/60 bg-background/40 p-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground">{meta.short}</span>
                      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className={`h-1.5 w-1.5 rounded-full ${st.className}`} />
                        {st.label}
                      </span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {row?.created_at ? fmtDate(row.created_at) : "Aún sin consultar"}
                      {isOk && itemCount > 0 ? ` · ${itemCount} ítem(s)` : null}
                    </p>

                    {key === "buzon_comunicados" && comunicados.length > 0 ? (
                      <ul className="space-y-1 max-h-28 overflow-auto">
                        {comunicados.slice(0, 5).map((c, i) => (
                          <li
                            key={c.id ?? `${c.titulo}-${i}`}
                            className="text-[10px] leading-snug border-l-2 border-primary/30 pl-1.5"
                          >
                            <span className="text-foreground font-medium line-clamp-2">
                              {c.titulo}
                            </span>
                            {c.fechaComunicado ? (
                              <span className="block text-muted-foreground">{c.fechaComunicado}</span>
                            ) : null}
                          </li>
                        ))}
                        {comunicados.length > 5 ? (
                          <li className="text-[10px] text-muted-foreground">
                            +{comunicados.length - 5} más…
                          </li>
                        ) : null}
                      </ul>
                    ) : null}

                    {key === "buzon_notificaciones" && notifs && notifs.all.length > 0 ? (
                      <ul className="space-y-1 max-h-28 overflow-auto">
                        {notifs.all.slice(0, 5).map((n, i) => (
                          <li
                            key={`${n.grupo}-${n.folio ?? i}`}
                            className="text-[10px] leading-snug border-l-2 border-primary/30 pl-1.5"
                          >
                            <span className="text-foreground font-medium line-clamp-2">
                              {n.acto || n.folio || "Notificación"}
                            </span>
                            <span className="block text-muted-foreground">
                              {[n.folio, n.fecha, n.grupo === "pendientes" ? "pendiente" : "notificada"]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </li>
                        ))}
                        {notifs.all.length > 5 ? (
                          <li className="text-[10px] text-muted-foreground">
                            +{notifs.all.length - 5} más…
                          </li>
                        ) : null}
                      </ul>
                    ) : null}

                    {isOk && itemCount === 0 ? (
                      <p className="text-[10px] text-muted-foreground">Sin ítems en esta consulta.</p>
                    ) : null}

                    {isErr && row?.error_message ? (
                      <p
                        className="text-[10px] text-destructive leading-tight line-clamp-2"
                        title={row.error_message}
                      >
                        {row.error_message}
                      </p>
                    ) : null}

                    {isOk && itemCount > 0 ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-[11px] gap-1.5"
                        onClick={() =>
                          setBuzonDetail({
                            kind: key,
                            raw: row?.raw_response,
                            at: row?.created_at ?? null,
                          })
                        }
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Ver detalle
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {buzonDetail ? (
        <SatgoBuzonDetailDialog
          open={!!buzonDetail}
          onOpenChange={(open) => {
            if (!open) setBuzonDetail(null);
          }}
          kind={buzonDetail.kind}
          rawResponse={buzonDetail.raw}
          consultedAt={buzonDetail.at}
        />
      ) : null}

      {/* 4. Historial */}
      {rows.length > 0 ? (
        <Collapsible className="space-y-1.5" defaultOpen={false}>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-muted-foreground gap-1"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              Historial completo ({rows.length})
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="rounded-md border border-border/60 max-h-72 overflow-auto">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-muted/40 text-muted-foreground sticky top-0 z-[1]">
                <tr>
                  <th className="p-2 font-medium">Tipo</th>
                  <th className="p-2 font-medium">Estado</th>
                  <th className="p-2 font-medium">Resumen</th>
                  <th className="p-2 font-medium">Fecha</th>
                  <th className="p-2 font-medium min-w-[120px]">Detalle / PDF</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((hist) => {
                  const hdoc = hist.documents;
                  const histBadgeVariant =
                    hist.status === "success"
                      ? "default"
                      : hist.status === "fail" || hist.status === "error"
                        ? "destructive"
                        : "secondary";
                  return (
                    <tr key={hist.id} className="border-t border-border/50">
                      <td className="p-2 font-medium align-top">
                        {satgoConsultLabel(hist.consult_type)}
                      </td>
                      <td className="p-2 align-top">
                        <Badge variant={histBadgeVariant} className="text-[10px]">
                          {hist.status}
                        </Badge>
                      </td>
                      <td className="p-2 text-muted-foreground max-w-[240px] align-top">
                        <div className="line-clamp-2" title={hist.summary ?? undefined}>
                          {hist.summary ?? "—"}
                        </div>
                        {hist.error_message ? (
                          <div className="text-[10px] text-destructive mt-0.5 leading-tight line-clamp-2">
                            {hist.error_message}
                          </div>
                        ) : null}
                      </td>
                      <td className="p-2 text-muted-foreground whitespace-nowrap align-top">
                        {fmtDate(hist.created_at)}
                      </td>
                      <td className="p-2 align-top">
                        {hist.consult_type === "buzon_comunicados" ||
                        hist.consult_type === "buzon_notificaciones" ? (
                          hist.status === "success" ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-[10px] gap-1"
                              onClick={() =>
                                setBuzonDetail({
                                  kind: hist.consult_type as
                                    | "buzon_comunicados"
                                    | "buzon_notificaciones",
                                  raw: hist.raw_response,
                                  at: hist.created_at,
                                })
                              }
                            >
                              <Eye className="h-3 w-3" />
                              Ver
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )
                        ) : hdoc?.file_path ? (
                          <MoffinPdfActions
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
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </section>
  );
}
