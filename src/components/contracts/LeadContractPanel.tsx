import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  Play,
  CheckCircle2,
} from "lucide-react";
import type { ContractPackageKind } from "@/types/contracts";
import {
  ENGAGEMENT_STATUS_LABEL,
  PACKAGE_KIND_LABEL,
} from "@/types/contracts";
import {
  publicContractUrl,
  useLeadContractEngagements,
  useRotateAccessToken,
  useStartContractEngagement,
} from "@/hooks/useContractEngagements";
import { normalizeServices, activeBundles } from "@/lib/leadServices";
import {
  isWonPipelineStage,
  wonStageDisplayLabel,
} from "@/lib/pipelineWonStage";

interface Props {
  leadId: string;
  stageSlug?: string | null;
  /** Nombre visible en el tablero (p. ej. «Cerrado»). */
  stageName?: string | null;
  stageIsTerminal?: boolean | null;
  serviceTypes?: unknown;
}

function suggestKinds(serviceTypes: unknown): ContractPackageKind[] {
  const services = normalizeServices(serviceTypes);
  const kinds: ContractPackageKind[] = [];
  if (services.includes("softlanding")) kinds.push("softlanding");
  const bundles = activeBundles(services);
  if (bundles.some((b) => b.key === "backoffice") || (services.includes("legal") && services.includes("contabilidad"))) {
    kinds.push("backoffice_pm");
  }
  // Si no hay señal clara, ofrecer Backoffice como default MVP
  if (kinds.length === 0) kinds.push("backoffice_pm");
  return kinds;
}

export function LeadContractPanel({
  leadId,
  stageSlug,
  stageName,
  stageIsTerminal,
  serviceTypes,
}: Props) {
  const isWon = isWonPipelineStage({
    slug: stageSlug,
    name: stageName,
    is_terminal: stageIsTerminal,
  });
  const wonLabel = wonStageDisplayLabel(stageName, stageSlug);
  const { data: engagements = [], isLoading, isError, error, refetch } = useLeadContractEngagements(leadId);
  const startMut = useStartContractEngagement();
  const rotateMut = useRotateAccessToken();
  const [lastTokens, setLastTokens] = useState<Record<string, string>>({});

  const suggested = useMemo(() => suggestKinds(serviceTypes), [serviceTypes]);
  const existingKinds = new Set(engagements.map((e) => e.package_kind));

  if (!isWon) {
    return (
      <Card id="contrato">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Onboarding de contrato</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          El onboarding de contrato se habilita cuando el lead está en etapa ganada del
          pipeline (en este tablero: <strong>Cerrado</strong>). Mueve el trato a esa etapa
          para iniciar Softlanding o Backoffice.
        </CardContent>
      </Card>
    );
  }

  const startKind = async (kind: ContractPackageKind) => {
    try {
      const res = await startMut.mutateAsync({ leadId, packageKind: kind });
      setLastTokens((prev) => ({ ...prev, [res.engagement_id]: res.access_token }));
      const url = publicContractUrl(res.access_token);
      try {
        await navigator.clipboard.writeText(url);
        toast.success(
          res.reused
            ? `Link actualizado (${PACKAGE_KIND_LABEL[kind]}). Copiado al portapapeles.`
            : `Onboarding iniciado (${PACKAGE_KIND_LABEL[kind]}). Link copiado.`,
        );
      } catch {
        toast.success(`Onboarding iniciado. Link: ${url}`);
      }
      void refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("lead_not_converted")) {
        toast.error(
          `El lead debe estar en etapa ganada (${wonLabel}) para iniciar el contrato.`,
        );
      } else if (msg.includes("Could not find") || msg.includes("schema cache") || msg.includes("does not exist")) {
        toast.error("Falta aplicar la migración de contratos en Supabase.");
      } else {
        toast.error(msg || "No se pudo iniciar");
      }
    }
  };

  const copyLink = async (engagementId: string) => {
    let token = lastTokens[engagementId];
    if (!token) {
      try {
        const res = await rotateMut.mutateAsync(engagementId);
        token = res.access_token;
        setLastTokens((prev) => ({ ...prev, [engagementId]: token! }));
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : "No se pudo generar link");
        return;
      }
    }
    const url = publicContractUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado");
    } catch {
      toast.message(url);
    }
  };

  return (
    <Card id="contrato">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Onboarding de contrato
          </CardTitle>
          <Badge variant="secondary" className="text-[10px]">
            Firma externa
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground font-normal">
          Trato en <strong className="text-foreground font-medium">{wonLabel}</strong>. Softlanding y
          Backoffice son procesos separados; no dependen de Savio ni del RFC de facturación.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : isError ? (
          <p className="text-sm text-destructive">
            {(error as Error)?.message?.includes("does not exist") ||
            (error as Error)?.message?.includes("schema cache")
              ? "Migración de contratos pendiente en la base."
              : (error as Error)?.message || "Error al cargar engagements"}
          </p>
        ) : null}

        {engagements.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aún no hay procesos de contrato. Softlanding y Backoffice son engagements separados (D9).
          </p>
        ) : (
          <ul className="space-y-3">
            {engagements.map((e) => (
              <li
                key={e.id}
                className="rounded-lg border bg-card px-3 py-2.5 space-y-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">{PACKAGE_KIND_LABEL[e.package_kind]}</span>
                  <Badge variant="outline" className="text-[10px]">
                    {ENGAGEMENT_STATUS_LABEL[e.status] || e.status}
                  </Badge>
                  {e.signed_confirmed_at ? (
                    <Badge className="bg-emerald-600/90 text-[10px]">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Firmado
                    </Badge>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/pipeline/leads/${leadId}/contrato?e=${e.id}`}>
                      Abrir wizard
                      <ExternalLink className="h-3.5 w-3.5 ml-1" />
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={rotateMut.isPending}
                    onClick={() => void copyLink(e.id)}
                  >
                    <Copy className="h-3.5 w-3.5 mr-1" />
                    Copiar link cliente
                  </Button>
                  {e.client_id ? (
                    <Button size="sm" variant="ghost" asChild>
                      <Link to={`/clientes/${e.client_id}`}>Ver cliente</Link>
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {suggested.map((kind) => (
            <Button
              key={kind}
              size="sm"
              disabled={startMut.isPending}
              variant={existingKinds.has(kind) ? "outline" : "default"}
              onClick={() => void startKind(kind)}
            >
              {startMut.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1" />
              )}
              {existingKinds.has(kind) ? "Reabrir link" : "Iniciar"} {PACKAGE_KIND_LABEL[kind]}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
