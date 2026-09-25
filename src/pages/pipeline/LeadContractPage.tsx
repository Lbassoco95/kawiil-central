import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Download, FileText, Loader2, Play, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ContractWizard } from "@/components/contracts/ContractWizard";
import {
  useActiveContractTemplate,
  useConfirmContractSigned,
  useContractPackageItems,
  useGenerateContractVersion,
  useLeadContractEngagements,
  useStaffPatchAnswers,
  publicContractUrl,
  useRotateAccessToken,
  useStartContractEngagement,
} from "@/hooks/useContractEngagements";
import type { ContractAnswers, ContractPackageKind } from "@/types/contracts";
import {
  ENGAGEMENT_STATUS_LABEL,
  PACKAGE_KIND_LABEL,
} from "@/types/contracts";
import {
  downloadHtmlDocument,
  openPrintPreview,
} from "@/lib/contractMerge";
import { useLeadDetail, usePipelineStages } from "@/hooks/usePipeline";
import { normalizeServices, activeBundles } from "@/lib/leadServices";
import {
  isWonPipelineStage,
  wonStageDisplayLabel,
} from "@/lib/pipelineWonStage";
import { formatContractRpcError } from "@/lib/contractRpcError";

function suggestKinds(serviceTypes: unknown): ContractPackageKind[] {
  const services = normalizeServices(serviceTypes);
  const kinds: ContractPackageKind[] = [];
  if (services.includes("softlanding")) kinds.push("softlanding");
  const bundles = activeBundles(services);
  if (
    bundles.some((b) => b.key === "backoffice") ||
    (services.includes("legal") && services.includes("contabilidad"))
  ) {
    kinds.push("backoffice_pm");
  }
  if (kinds.length === 0) kinds.push("backoffice_pm");
  return kinds;
}

export default function LeadContractPage() {
  const { id: leadId } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const { data: lead } = useLeadDetail(leadId);
  const { data: stages = [] } = usePipelineStages();
  const { data: engagements = [], isLoading, refetch } = useLeadContractEngagements(leadId);
  const engagementId = search.get("e") || engagements[0]?.id;
  const engagement = engagements.find((e) => e.id === engagementId) || engagements[0];
  const startMut = useStartContractEngagement();

  const currentStage = useMemo(
    () => (lead ? stages.find((s) => s.id === lead.stage_id) : undefined),
    [stages, lead],
  );
  const isWon = isWonPipelineStage({
    slug: currentStage?.slug,
    name: currentStage?.name,
    is_terminal: currentStage?.is_terminal,
  });
  const wonLabel = wonStageDisplayLabel(currentStage?.name, currentStage?.slug);
  const suggested = useMemo(
    () => suggestKinds(lead?.service_types ?? (lead as { service_type?: unknown } | undefined)?.service_type),
    [lead],
  );

  const { data: tplBundle } = useActiveContractTemplate(engagement?.id);
  const { data: items = [] } = useContractPackageItems(engagement?.id);
  const patchMut = useStaffPatchAnswers();
  const genMut = useGenerateContractVersion();
  const confirmMut = useConfirmContractSigned();
  const rotateMut = useRotateAccessToken();

  const [localAnswers, setLocalAnswers] = useState<ContractAnswers>({});
  const [lastMerged, setLastMerged] = useState<string | null>(null);
  const [clientToken, setClientToken] = useState<string | null>(null);

  useEffect(() => {
    if (engagement?.answers) setLocalAnswers(engagement.answers);
  }, [engagement?.id, engagement?.answers]);

  const deferredItems = useMemo(
    () => items.filter((i) => i.status === "pending"),
    [items],
  );

  const startKind = async (kind: ContractPackageKind) => {
    if (!leadId) return;
    try {
      const res = await startMut.mutateAsync({ leadId, packageKind: kind });
      toast.success(`Onboarding iniciado (${PACKAGE_KIND_LABEL[kind]})`);
      void refetch();
      window.location.replace(`/pipeline/leads/${leadId}/contrato?e=${res.engagement_id}`);
    } catch (e: unknown) {
      const msg = formatContractRpcError(e);
      if (msg.toLowerCase().includes("etapa ganada") || msg.includes("lead_not_converted")) {
        toast.error(`El lead debe estar en etapa ganada (${wonLabel}).`);
      } else {
        toast.error(msg || "No se pudo iniciar");
      }
    }
  };

  if (isLoading || !leadId) {
    return (
      <div className="flex items-center gap-2 p-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando contrato…
      </div>
    );
  }

  if (!engagement) {
    return (
      <div className="max-w-lg space-y-4 p-6">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/pipeline/leads/${leadId}`}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Volver al lead
          </Link>
        </Button>
        {isWon ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Iniciar onboarding</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                El trato está en <strong>{wonLabel}</strong>. Aún no hay engagement: elige Softlanding o
                Backoffice para generar el link (RFC no es obligatorio en Softlanding).
              </p>
              <div className="flex flex-wrap gap-2">
                {suggested.map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    disabled={startMut.isPending}
                    onClick={() => void startKind(kind)}
                  >
                    {startMut.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                    ) : (
                      <Play className="h-3.5 w-3.5 mr-1" />
                    )}
                    Iniciar {PACKAGE_KIND_LABEL[kind]}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">
            No hay engagement activo. Mueve el lead a la etapa ganada del pipeline (
            <strong>Cerrado</strong> en el tablero) e inicia Softlanding o Backoffice desde la ficha.
          </p>
        )}
      </div>
    );
  }

  const onPatch = (patch: ContractAnswers) => {
    setLocalAnswers((prev) => ({ ...prev, ...patch }));
  };

  const save = async () => {
    try {
      await patchMut.mutateAsync({
        engagementId: engagement.id,
        answers: localAnswers,
        leadId,
      });
      toast.success("Datos guardados (visibles para el cliente)");
      void refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    }
  };

  const generate = async () => {
    if (!tplBundle?.template?.body_html) {
      toast.error("No hay plantilla activa. ¿Se aplicó el seed de templates?");
      return;
    }
    try {
      await patchMut.mutateAsync({
        engagementId: engagement.id,
        answers: localAnswers,
        leadId,
      });
      const res = await genMut.mutateAsync({
        engagementId: engagement.id,
        leadId,
        answers: localAnswers,
        bodyHtml: tplBundle.template.body_html,
        fields: tplBundle.fields || [],
      });
      setLastMerged(String(res.merged_html || ""));
      toast.success("Documento generado. Puedes descargarlo o imprimir a PDF.");
      void refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al generar");
    }
  };

  const download = () => {
    if (!lastMerged && !tplBundle?.template) {
      toast.message("Genera el documento primero");
      return;
    }
    const html = lastMerged || "";
    if (!html) {
      toast.message("Genera el documento primero");
      return;
    }
    const name = `contrato-${engagement.package_kind}-${engagement.id.slice(0, 8)}.html`;
    downloadHtmlDocument(name, html);
    toast.success("Descarga lista. Ábrela e imprime / Guarda como PDF para firma externa.");
  };

  const printPdf = () => {
    if (!lastMerged) {
      toast.message("Genera el documento primero");
      return;
    }
    if (!openPrintPreview(lastMerged)) {
      toast.error("El navegador bloqueó la ventana de impresión");
    }
  };

  const confirmSigned = async () => {
    try {
      const res = await confirmMut.mutateAsync({ engagementId: engagement.id, leadId });
      toast.success(
        res.already
          ? "Ya estaba confirmado"
          : `Firmado confirmado. Cliente creado${res.client_id ? ` (${res.client_id.slice(0, 8)}…)` : ""}.`,
      );
      void refetch();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Error al confirmar");
    }
  };

  const ensureLink = async () => {
    try {
      const res = await rotateMut.mutateAsync(engagement.id);
      setClientToken(res.access_token);
      const url = publicContractUrl(res.access_token);
      await navigator.clipboard.writeText(url);
      toast.success("Link del cliente copiado");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "No se pudo generar link");
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-16">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/pipeline/leads/${leadId}`}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            {lead?.full_name || "Lead"}
          </Link>
        </Button>
        <Badge variant="outline">{PACKAGE_KIND_LABEL[engagement.package_kind]}</Badge>
        <Badge>{ENGAGEMENT_STATUS_LABEL[engagement.status]}</Badge>
      </div>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <FileText className="h-6 w-6" />
          Onboarding · contrato
        </h1>
        <p className="text-sm text-muted-foreground">
          Dual fill con el cliente. Genera, descarga y confirma la firma hecha fuera de Kawiil
          {engagement.package_kind === "softlanding"
            ? ". En Softlanding el RFC es opcional hasta que exista la sociedad."
            : "."}
        </p>
      </header>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => void ensureLink()} disabled={rotateMut.isPending}>
          Copiar link cliente
        </Button>
        {clientToken ? (
          <span className="text-xs text-muted-foreground self-center truncate max-w-[240px]">
            …{clientToken.slice(-8)}
          </span>
        ) : null}
        <Button size="sm" onClick={() => void generate()} disabled={genMut.isPending || engagement.status === "signed_confirmed"}>
          {genMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
          Generar contrato
        </Button>
        <Button size="sm" variant="outline" onClick={download} disabled={!lastMerged}>
          <Download className="h-4 w-4 mr-1" />
          Descargar HTML
        </Button>
        <Button size="sm" variant="outline" onClick={printPdf} disabled={!lastMerged}>
          <Printer className="h-4 w-4 mr-1" />
          Imprimir / PDF
        </Button>
        <Button
          size="sm"
          className="bg-emerald-700 hover:bg-emerald-800"
          onClick={() => void confirmSigned()}
          disabled={confirmMut.isPending || engagement.status === "signed_confirmed"}
        >
          {confirmMut.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
          Confirmar que ya se firmó
        </Button>
      </div>

      {engagement.client_id ? (
        <Card>
          <CardContent className="py-3 text-sm">
            Cliente creado:{" "}
            <Link className="text-primary underline" to={`/clientes/${engagement.client_id}`}>
              abrir ficha
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {deferredItems.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Hitos diferidos (post-firma)</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {deferredItems.map((i) => (
              <Badge key={i.id} variant="outline" className="text-[11px]">
                {i.item_key} · pending
              </Badge>
            ))}
            <p className="w-full text-xs text-muted-foreground mt-1">
              Anexos C/D/OS se emiten durante el servicio (D11). Stub en este MVP.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <ContractWizard
            packageKind={engagement.package_kind}
            answers={localAnswers}
            updatedByRole={engagement.answers_updated_by_role}
            updatedAt={engagement.answers_updated_at}
            mode="staff"
            saving={patchMut.isPending}
            onChange={onPatch}
            onSave={() => void save()}
          />
        </CardContent>
      </Card>
    </div>
  );
}
