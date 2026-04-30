import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Copy,
  Download,
  Pencil,
  Check,
  X,
  ChevronDown,
  FileText,
  FileSpreadsheet,
  FileType2,
  Presentation,
  FileTextIcon,
  Loader2,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import type { AiArtifact, KawiilArtifactOutput, KawiilOutputFormat } from "@/hooks/useAiArtifacts";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArtifactPdfPreview } from "./ArtifactPdfPreview";
import { ArtifactSpreadsheetPreview } from "./ArtifactSpreadsheetPreview";
import { ArtifactDocxPreview } from "./ArtifactDocxPreview";
import { ArtifactOfficeOnlinePreview } from "./ArtifactOfficeOnlinePreview";
import { FORMAT_LABEL, getTemplateMeta } from "@/lib/ai-templates";
import { KAWIIL_AI_TEXT_GRADIENT_CLASS } from "@/lib/kawiilAi";

interface ArtifactViewerProps {
  artifact: AiArtifact;
  onBack: () => void;
  onUpdate: (id: string, content: string) => void;
}

function formatIcon(format: KawiilOutputFormat) {
  switch (format) {
    case "pdf":
      return <FileText className="h-3.5 w-3.5" />;
    case "xlsx":
      return <FileSpreadsheet className="h-3.5 w-3.5" />;
    case "docx":
      return <FileType2 className="h-3.5 w-3.5" />;
    case "pptx":
      return <Presentation className="h-3.5 w-3.5" />;
  }
}

const ALL_FORMATS: KawiilOutputFormat[] = ["pdf", "docx", "xlsx", "pptx"];

type ViewerTabId = "docx" | "pptx" | "pdf" | "spreadsheet" | "text";

export function ArtifactViewer({ artifact, onBack, onUpdate }: ArtifactViewerProps) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(artifact.content);
  const [generatingFormat, setGeneratingFormat] = useState<KawiilOutputFormat | "all" | null>(null);
  const qc = useQueryClient();

  const templateMeta = getTemplateMeta(artifact.template_key);
  const renderStatus = artifact.render_status ?? "ready";
  const isPending = renderStatus === "pending";
  const isFailed = renderStatus === "failed";

  const outputs: KawiilArtifactOutput[] = useMemo(() => {
    if (Array.isArray(artifact.output_formats) && artifact.output_formats.length) {
      return artifact.output_formats as KawiilArtifactOutput[];
    }
    // Back-compat: artifacts viejos (office_kind / storage_path) se muestran como 1 solo formato.
    if (artifact.storage_path && artifact.storage_bucket && artifact.file_ext) {
      const fmt = (artifact.file_ext as KawiilOutputFormat) || "docx";
      return [{
        format: fmt,
        storage_bucket: artifact.storage_bucket,
        storage_path: artifact.storage_path,
        file_name: `${artifact.title}.${artifact.file_ext}`,
        mime_type: artifact.mime_type || "",
        is_primary: true,
      }];
    }
    return [];
  }, [artifact]);

  const primaryOutput = useMemo(() => {
    if (!outputs.length) return null;
    return outputs.find((o) => o.is_primary) || outputs[0];
  }, [outputs]);

  const pdfOutput = useMemo(() => outputs.find((o) => o.format === "pdf") || null, [outputs]);
  const xlsxOutput = useMemo(() => outputs.find((o) => o.format === "xlsx") || null, [outputs]);
  const docxOutput = useMemo(() => outputs.find((o) => o.format === "docx") || null, [outputs]);
  const pptxOutput = useMemo(() => outputs.find((o) => o.format === "pptx") || null, [outputs]);
  const isKawiilDoc = outputs.length > 0;
  const isLegacyMarkdown = !isKawiilDoc;
  const hasPreviewPanel = Boolean(pdfOutput || xlsxOutput || docxOutput || pptxOutput);

  const resolvedPrimaryFormat = (artifact.primary_format || primaryOutput?.format || "docx") as KawiilOutputFormat;

  const { tabOrder, defaultTab } = useMemo(() => {
    const hasP = !!pdfOutput;
    const hasX = !!xlsxOutput;
    const hasD = !!docxOutput;
    const hasS = !!pptxOutput;
    const fmt = resolvedPrimaryFormat;

    const pieces: ViewerTabId[] = [];
    const pushAvailable = (...ids: ViewerTabId[]) => {
      for (const id of ids) {
        if (pieces.includes(id)) continue;
        if (id === "pdf" && !hasP) continue;
        if (id === "spreadsheet" && !hasX) continue;
        if (id === "docx" && !hasD) continue;
        if (id === "pptx" && !hasS) continue;
        pieces.push(id);
      }
    };

    if (fmt === "xlsx" && hasX) {
      pushAvailable("spreadsheet", "pdf", "docx", "pptx", "text");
    } else if (fmt === "pdf" && hasP) {
      pushAvailable("pdf", "docx", "spreadsheet", "pptx", "text");
    } else if (fmt === "docx" && hasD) {
      // PDF primero cuando existe: más cercano al entregable impreso/enviado que solo Word en navegador.
      if (hasP) pushAvailable("pdf", "docx", "spreadsheet", "pptx", "text");
      else pushAvailable("docx", "pdf", "spreadsheet", "pptx", "text");
    } else if (fmt === "pptx" && hasS) {
      pushAvailable("pptx", "pdf", "docx", "spreadsheet", "text");
    } else {
      pushAvailable("pdf", "docx", "spreadsheet", "pptx", "text");
    }

    let def: ViewerTabId = "text";
    if (fmt === "xlsx" && hasX) def = "spreadsheet";
    else if (fmt === "pptx" && hasS) def = "pptx";
    else if (hasP && fmt !== "pptx") def = "pdf";
    else if (fmt === "docx" && hasD) def = "docx";
    else if (hasD) def = "docx";
    else if (hasX) def = "spreadsheet";
    else if (hasS) def = "pptx";

    const tabOrder = pieces.length ? pieces : ["text"];
    const defaultTab = tabOrder.includes(def) ? def : (tabOrder[0] ?? "text");
    return { tabOrder, defaultTab };
  }, [resolvedPrimaryFormat, pdfOutput, xlsxOutput, docxOutput, pptxOutput]);

  const [activeTab, setActiveTab] = useState<ViewerTabId>(defaultTab);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab, artifact.id]);

  const tabDownloadOutput = useMemo(() => {
    switch (activeTab) {
      case "pdf":
        return pdfOutput;
      case "docx":
        return docxOutput;
      case "spreadsheet":
        return xlsxOutput;
      case "pptx":
        return pptxOutput;
      default:
        return null;
    }
  }, [activeTab, pdfOutput, docxOutput, xlsxOutput, pptxOutput]);

  const availableFormats = useMemo(() => new Set(outputs.map((o) => o.format)), [outputs]);
  const missingFormats = useMemo(
    () => ALL_FORMATS.filter((f) => !availableFormats.has(f)),
    [availableFormats],
  );

  const safeTitle = artifact.title.replace(/[^a-zA-Z0-9_-]/g, "_") || "documento";

  /**
   * Cuando el artefacto está `pending`, forzamos refetch del hook `useAiArtifacts`
   * cada 3s (además del polling de 5s del hook) para que el badge "Generando…"
   * se actualice rápido cuando el reconciliador termina.
   */
  useEffect(() => {
    if (!isPending) return;
    const iv = setInterval(() => {
      qc.invalidateQueries({ queryKey: ["ai-artifacts"] });
    }, 3000);
    return () => clearInterval(iv);
  }, [isPending, qc]);

  const handleGenerateFormats = async (formats: KawiilOutputFormat[], label: KawiilOutputFormat | "all") => {
    setGeneratingFormat(label);
    try {
      const { data, error } = await (supabase.functions as { invoke: (fn: string, opts: { body: unknown }) => Promise<{ data: unknown; error: unknown }> })
        .invoke("reconcile-ai-artifact-formats", {
          body: { artifact_id: artifact.id, formats },
        });
      const errObj = error as { message?: string } | null;
      if (errObj?.message) throw new Error(errObj.message);
      const respErr = (data as { error?: string } | null)?.error;
      if (respErr) throw new Error(respErr);
      toast.success(
        label === "all"
          ? "Documento regenerado en todos los formatos."
          : `Formato ${label.toUpperCase()} generado.`,
      );
      qc.invalidateQueries({ queryKey: ["ai-artifacts"] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo generar el formato";
      toast.error(msg);
    } finally {
      setGeneratingFormat(null);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(artifact.content);
    toast.success("Copiado al portapapeles");
  };

  const handleDownloadFormat = async (output: KawiilArtifactOutput) => {
    try {
      const { data, error } = await supabase.storage
        .from(output.storage_bucket)
        .download(output.storage_path);
      if (error || !data) throw new Error(error?.message || "No se pudo descargar el archivo");
      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = output.file_name || `${safeTitle}.${output.format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo descargar el archivo");
    }
  };

  const handleDownloadMarkdown = () => {
    const blob = new Blob([artifact.content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeTitle}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = () => {
    onUpdate(artifact.id, editContent);
    setEditing(false);
    toast.success("Artifact actualizado");
  };

  const handleMainDownload = () => {
    if (activeTab === "text") {
      handleDownloadMarkdown();
      return;
    }
    const target = tabDownloadOutput ?? primaryOutput;
    if (target) void handleDownloadFormat(target);
  };

  const mainDownloadSuffix =
    activeTab === "text"
      ? "Markdown (.md)"
      : tabDownloadOutput ?? primaryOutput
        ? FORMAT_LABEL[(tabDownloadOutput ?? primaryOutput)!.format] ||
          (tabDownloadOutput ?? primaryOutput)!.format.toUpperCase()
        : "";

  const mainDownloadDisabled =
    isPending ||
    (activeTab === "text" ? false : !(tabDownloadOutput ?? primaryOutput));

  const moreMenuDownloadSection = outputs.length > 0 ? (
    <>
      {outputs.map((out) => (
        <DropdownMenuItem
          key={out.format + out.storage_path}
          onClick={() => void handleDownloadFormat(out)}
          className="gap-2 text-xs"
        >
          {formatIcon(out.format)}
          {FORMAT_LABEL[out.format] || out.format.toUpperCase()}
          {out.is_primary ? <span className="ml-1 text-[9px] text-muted-foreground">principal</span> : null}
        </DropdownMenuItem>
      ))}
      <DropdownMenuItem onClick={() => void handleDownloadMarkdown()} className="gap-2 text-xs">
        <FileTextIcon className="h-3.5 w-3.5" /> Markdown (.md)
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  ) : (
    <>
      <DropdownMenuItem onClick={() => void handleDownloadMarkdown()} className="gap-2 text-xs">
        <FileTextIcon className="h-3.5 w-3.5" /> Markdown (.md)
      </DropdownMenuItem>
      <DropdownMenuSeparator />
    </>
  );

  const moreMenuUtilities = (
    <>
      <DropdownMenuItem onClick={handleCopy} className="gap-2 text-xs">
        <Copy className="h-3.5 w-3.5" /> Copiar texto fuente
      </DropdownMenuItem>
      {(missingFormats.length > 0 || isFailed) ? (
        <>
          <DropdownMenuSeparator />
          {missingFormats.map((fmt) => (
            <DropdownMenuItem
              key={fmt}
              onClick={() => void handleGenerateFormats([fmt], fmt)}
              disabled={isPending || generatingFormat !== null}
              className="gap-2 text-xs"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Generar {FORMAT_LABEL[fmt] || fmt.toUpperCase()}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onClick={() => void handleGenerateFormats(ALL_FORMATS, "all")}
            disabled={isPending || generatingFormat !== null}
            className="gap-2 text-xs"
          >
            <Sparkles className="h-3.5 w-3.5" /> Regenerar todos los formatos
          </DropdownMenuItem>
        </>
      ) : null}
      {!editing && isLegacyMarkdown ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2 text-xs"
            onClick={() => {
              setEditContent(artifact.content);
              setEditing(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" /> Editar markdown
          </DropdownMenuItem>
        </>
      ) : null}
      {editing ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="gap-2 text-xs" onClick={handleSave}>
            <Check className="h-3.5 w-3.5" /> Guardar cambios
          </DropdownMenuItem>
          <DropdownMenuItem className="gap-2 text-xs" onClick={() => setEditing(false)}>
            <X className="h-3.5 w-3.5" /> Cancelar edición
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 border-b border-border/30 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" className="text-xs text-primary hover:underline flex items-center gap-1 shrink-0" onClick={onBack}>
            <ArrowLeft className="h-3 w-3" /> Volver
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className={`text-sm font-semibold leading-tight truncate ${isKawiilDoc ? KAWIIL_AI_TEXT_GRADIENT_CLASS : ""}`}>
                {artifact.title}
              </h3>
              {templateMeta ? (
                <span className="text-[10px] text-muted-foreground shrink-0">{templateMeta.shortLabel}</span>
              ) : null}
              {isPending ? (
                <Badge variant="secondary" className="text-[10px] h-5 gap-1 border-amber-200 bg-amber-50 text-amber-800">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> Generando…
                </Badge>
              ) : null}
              {isFailed ? (
                <Badge variant="secondary" className="text-[10px] h-5 border-rose-200 bg-rose-50 text-rose-800">
                  Error al generar
                </Badge>
              ) : null}
            </div>
            {isFailed && artifact.render_error ? (
              <p className="text-[10px] text-rose-700 mt-0.5 truncate" title={artifact.render_error}>
                {artifact.render_error}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-[min(80vh,900px)] overflow-hidden flex flex-col">
        {hasPreviewPanel ? (
          <Tabs
            key={`${artifact.id}-${resolvedPrimaryFormat}`}
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as ViewerTabId)}
            className="h-full min-h-[min(80vh,900px)] flex flex-1 flex-col"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 gap-y-2 border-b border-border/30 px-3 py-2 shrink-0 bg-muted/20">
              <TabsList className="h-8 flex-wrap bg-background/80">
                {tabOrder.map((value) => {
                  if (value === "spreadsheet" && xlsxOutput) {
                    return (
                      <TabsTrigger key="spreadsheet" value="spreadsheet" className="text-[11px] h-7 px-2 gap-1">
                        <FileSpreadsheet className="h-3 w-3" /> Excel
                      </TabsTrigger>
                    );
                  }
                  if (value === "pdf" && pdfOutput) {
                    return (
                      <TabsTrigger key="pdf" value="pdf" className="text-[11px] h-7 px-2 gap-1">
                        <FileText className="h-3 w-3" /> PDF
                      </TabsTrigger>
                    );
                  }
                  if (value === "docx" && docxOutput) {
                    return (
                      <TabsTrigger key="docx" value="docx" className="text-[11px] h-7 px-2 gap-1">
                        <FileType2 className="h-3 w-3" /> Word
                      </TabsTrigger>
                    );
                  }
                  if (value === "pptx" && pptxOutput) {
                    return (
                      <TabsTrigger key="pptx" value="pptx" className="text-[11px] h-7 px-2 gap-1">
                        <Presentation className="h-3 w-3" /> PowerPoint
                      </TabsTrigger>
                    );
                  }
                  if (value === "text") {
                    return (
                      <TabsTrigger key="text" value="text" className="text-[11px] h-7 px-2 gap-1">
                        <FileTextIcon className="h-3 w-3" /> Texto
                      </TabsTrigger>
                    );
                  }
                  return null;
                })}
              </TabsList>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  disabled={mainDownloadDisabled}
                  className="h-8 gap-1.5 bg-sky-600 px-3 text-xs hover:bg-sky-700"
                  onClick={handleMainDownload}
                >
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  ) : (
                    <Download className="h-3.5 w-3.5 shrink-0" />
                  )}
                  Descargar{mainDownloadSuffix ? ` · ${mainDownloadSuffix}` : ""}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" size="sm" className="h-8 w-8 shrink-0 p-0" aria-label="Más opciones">
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {moreMenuDownloadSection}
                    {moreMenuUtilities}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            {docxOutput ? (
              <TabsContent value="docx" className="flex-1 m-0 p-0 min-h-0 min-h-[min(80vh,900px)] flex flex-col data-[state=active]:flex-1 overflow-hidden">
                <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                  <ArtifactOfficeOnlinePreview
                    bucket={docxOutput.storage_bucket}
                    storagePath={docxOutput.storage_path}
                    suiteLabel="Word"
                    simplifiedFallback={
                      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                        <ArtifactDocxPreview bucket={docxOutput.storage_bucket} storagePath={docxOutput.storage_path} />
                      </div>
                    }
                  />
                </div>
              </TabsContent>
            ) : null}
            {pptxOutput ? (
              <TabsContent
                value="pptx"
                className="flex-1 m-0 p-0 min-h-0 min-h-[min(80vh,900px)] flex flex-col data-[state=active]:flex-1 overflow-hidden"
              >
                <div className="flex min-h-0 flex-1 flex-col overflow-auto">
                  <ArtifactOfficeOnlinePreview
                    bucket={pptxOutput.storage_bucket}
                    storagePath={pptxOutput.storage_path}
                    suiteLabel="PowerPoint"
                    simplifiedFallback={
                      <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center max-w-md mx-auto">
                        <Presentation className="h-12 w-12 text-muted-foreground/50" />
                        <p className="text-sm text-foreground">No hay vista simplificada en la app.</p>
                        <p className="text-xs text-muted-foreground">
                          Usa <span className="font-medium text-foreground">Descargar · PowerPoint</span> en la barra superior.
                        </p>
                      </div>
                    }
                  />
                </div>
              </TabsContent>
            ) : null}
            {xlsxOutput ? (
              <TabsContent
                value="spreadsheet"
                className="flex-1 m-0 p-0 min-h-0 min-h-[min(80vh,900px)] flex flex-col data-[state=active]:flex-1"
              >
                <div className="flex min-h-0 flex-1 min-h-[min(80vh,900px)] min-[900px]:min-h-0 flex-col">
                  <ArtifactOfficeOnlinePreview
                    bucket={xlsxOutput.storage_bucket}
                    storagePath={xlsxOutput.storage_path}
                    suiteLabel="Excel"
                    simplifiedFallback={
                      <ArtifactSpreadsheetPreview
                        bucket={xlsxOutput.storage_bucket}
                        storagePath={xlsxOutput.storage_path}
                        fileName={xlsxOutput.file_name}
                      />
                    }
                  />
                </div>
              </TabsContent>
            ) : null}
            <TabsContent value="text" className="flex-1 m-0 overflow-y-auto p-4 min-h-0 min-h-[min(80vh,900px)]">
              <div className="prose prose-sm max-w-none [&_p]:my-1.5 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_code]:text-xs [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                <ReactMarkdown>{artifact.content}</ReactMarkdown>
              </div>
            </TabsContent>
            {pdfOutput ? (
              <TabsContent value="pdf" className="flex-1 m-0 p-0 min-h-0 min-h-[min(80vh,900px)] flex flex-col data-[state=active]:flex-1">
                <div className="flex-1 min-h-[min(80vh,900px)] min-[900px]:min-h-0 flex flex-col">
                  <ArtifactPdfPreview bucket={pdfOutput.storage_bucket} path={pdfOutput.storage_path} />
                </div>
              </TabsContent>
            ) : null}
          </Tabs>
        ) : (
          <div className="flex flex-1 flex-col min-h-[min(80vh,900px)] min-h-0 overflow-hidden">
            <div className="flex shrink-0 justify-end gap-1 border-b border-border/30 bg-muted/20 px-3 py-2">
              <Button
                type="button"
                size="sm"
                variant="default"
                className="h-8 gap-1.5 bg-sky-600 px-3 text-xs hover:bg-sky-700"
                onClick={handleDownloadMarkdown}
              >
                <Download className="h-3.5 w-3.5 shrink-0" />
                Descargar · Markdown (.md)
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="h-8 w-8 shrink-0 p-0" aria-label="Más opciones">
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {moreMenuUtilities}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4">
              {editing ? (
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="min-h-[400px] text-sm font-mono resize-none"
                />
              ) : (
                <div className="prose prose-sm max-w-none pb-8 [&_p]:my-1.5 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_code]:text-xs [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                  <ReactMarkdown>{artifact.content}</ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

