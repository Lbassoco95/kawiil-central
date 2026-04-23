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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArtifactPdfPreview } from "./ArtifactPdfPreview";
import { ArtifactSpreadsheetPreview } from "./ArtifactSpreadsheetPreview";
import { FORMAT_LABEL, getTemplateMeta } from "@/lib/ai-templates";
import { KAWIIL_AI_SOFT_BG, KAWIIL_AI_TEXT_GRADIENT_CLASS } from "@/lib/kawiilAi";

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
  const isKawiilDoc = outputs.length > 0;
  const isLegacyMarkdown = !isKawiilDoc;
  const hasPreviewPanel = Boolean(pdfOutput || xlsxOutput);

  const resolvedPrimaryFormat = (artifact.primary_format || primaryOutput?.format || "pdf") as KawiilOutputFormat;

  const { tabOrder, defaultTab } = useMemo(() => {
    const hasP = !!pdfOutput;
    const hasX = !!xlsxOutput;
    const fmt = resolvedPrimaryFormat;
    let order: ("spreadsheet" | "text" | "pdf")[] = ["text"];
    if (fmt === "xlsx" && hasX) {
      order = ["spreadsheet", "text"];
      if (hasP) order.push("pdf");
    } else if (fmt === "pdf" && hasP) {
      order = ["pdf", "text"];
      if (hasX) order.push("spreadsheet");
    } else if (fmt === "docx") {
      order = ["text"];
      if (hasP) order.push("pdf");
      if (hasX) order.push("spreadsheet");
    } else {
      order = ["text"];
      if (hasP) order.push("pdf");
      if (hasX) order.push("spreadsheet");
    }
    let def: "spreadsheet" | "text" | "pdf" = "text";
    if (fmt === "xlsx" && hasX) def = "spreadsheet";
    else if (fmt === "pdf" && hasP) def = "pdf";
    else if (fmt === "docx" || fmt === "pptx") def = "text";
    else {
      if (hasP) def = "pdf";
      else if (hasX) def = "spreadsheet";
    }
    if (!order.includes(def)) def = order[0] ?? "text";
    return { tabOrder: order, defaultTab: def };
  }, [resolvedPrimaryFormat, pdfOutput, xlsxOutput]);

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

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-3 border-b border-border/30 space-y-2" style={isKawiilDoc ? { background: KAWIIL_AI_SOFT_BG } : undefined}>
        <button className="text-xs text-primary hover:underline flex items-center gap-1" onClick={onBack}>
          <ArrowLeft className="h-3 w-3" /> Volver
        </button>
        <div className="flex items-start gap-2 justify-between">
          <div className="min-w-0">
            {templateMeta ? (
              <Badge variant="secondary" className="text-[10px] mb-1 border-sky-200 bg-sky-50 text-sky-700">
                KAWIIL AI · {templateMeta.shortLabel}
              </Badge>
            ) : null}
            {isPending ? (
              <Badge variant="secondary" className="text-[10px] mb-1 ml-1 border-amber-200 bg-amber-50 text-amber-800 gap-1">
                <Loader2 className="h-2.5 w-2.5 animate-spin" /> Generando PDF/DOCX…
              </Badge>
            ) : null}
            {isFailed ? (
              <Badge variant="secondary" className="text-[10px] mb-1 ml-1 border-rose-200 bg-rose-50 text-rose-800">
                Generación falló
              </Badge>
            ) : null}
            <h3 className={`text-sm font-semibold leading-tight ${isKawiilDoc ? KAWIIL_AI_TEXT_GRADIENT_CLASS : ""}`}>
              {artifact.title}
            </h3>
            {primaryOutput ? (
              <div className="text-[10px] text-muted-foreground mt-0.5 space-y-0.5">
                <p>
                  Formato primario: {FORMAT_LABEL[primaryOutput.format] || primaryOutput.format.toUpperCase()}
                  {outputs.length > 1 ? ` · ${outputs.length} formatos disponibles` : ""}
                </p>
                {resolvedPrimaryFormat === "docx" && outputs.length > 0 ? (
                  <p className="text-[10px] text-foreground/80">
                    Entrega principal en Word: usa <span className="font-medium">Descargar</span> y elige DOCX; el
                    PDF es copia de presentación/lectura. En <span className="font-medium">Texto</span> verás un
                    resumen en markdown.
                  </p>
                ) : null}
                {resolvedPrimaryFormat === "xlsx" && outputs.length > 0 ? (
                  <p className="text-[10px] text-foreground/80">
                    La entrega estructurada es el Excel: usa <span className="font-medium">Descargar</span> y elige
                    XLSX. <span className="font-medium">Vista previa Excel</span> muestra la primera hoja (tabular,
                    podría truncarse); el PDF, si existe, es solo copia de presentación/lectura. En{" "}
                    <span className="font-medium">Texto</span> verás un resumen en markdown.
                  </p>
                ) : null}
              </div>
            ) : null}
            {isFailed && artifact.render_error ? (
              <p className="text-[10px] text-rose-700 mt-0.5 truncate" title={artifact.render_error}>
                {artifact.render_error}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2" onClick={handleCopy}>
            <Copy className="h-2.5 w-2.5" /> Copiar texto
          </Button>
          {outputs.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2" disabled={isPending}>
                  <Download className="h-2.5 w-2.5" /> Descargar
                  <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {outputs.map((out) => (
                  <DropdownMenuItem
                    key={out.format + out.storage_path}
                    onClick={() => void handleDownloadFormat(out)}
                    className="gap-2 text-xs"
                  >
                    {formatIcon(out.format)}
                    {FORMAT_LABEL[out.format] || out.format.toUpperCase()}
                    {out.is_primary ? <span className="ml-1 text-[9px] text-muted-foreground">primario</span> : null}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onClick={() => void handleDownloadMarkdown()}
                  className="gap-2 text-xs border-t mt-1 pt-1"
                >
                  <FileTextIcon className="h-3.5 w-3.5" /> Markdown (.md)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2" onClick={handleDownloadMarkdown}>
              <Download className="h-2.5 w-2.5" /> Descargar .md
            </Button>
          )}

          {/*
            Botón "Generar" a demanda:
            - Si faltan formatos (el artefacto solo tiene MD, o le falta XLSX/PPTX), mostramos
              un dropdown con los que faltan + "Regenerar todos".
            - Si ya tiene los 4 formatos, solo ofrecemos "Regenerar" como submenú.
          */}
          {(missingFormats.length > 0 || isFailed) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="default"
                  className="h-6 text-[10px] gap-1 px-2 bg-sky-600 hover:bg-sky-700"
                  disabled={isPending || generatingFormat !== null}
                >
                  {generatingFormat !== null || isPending ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-2.5 w-2.5" />
                  )}
                  {isFailed ? "Reintentar" : "Generar"}
                  <ChevronDown className="h-2.5 w-2.5 ml-0.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {missingFormats.map((fmt) => (
                  <DropdownMenuItem
                    key={fmt}
                    onClick={() => void handleGenerateFormats([fmt], fmt)}
                    className="gap-2 text-xs"
                  >
                    {formatIcon(fmt)}
                    Generar {FORMAT_LABEL[fmt] || fmt.toUpperCase()}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onClick={() => void handleGenerateFormats(ALL_FORMATS, "all")}
                  className="gap-2 text-xs border-t mt-1 pt-1"
                >
                  <Sparkles className="h-3.5 w-3.5" /> Regenerar todos (PDF+DOCX+XLSX+PPTX)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {!editing && isLegacyMarkdown ? (
            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2" onClick={() => { setEditContent(artifact.content); setEditing(true); }}>
              <Pencil className="h-2.5 w-2.5" /> Editar
            </Button>
          ) : editing ? (
            <>
              <Button size="sm" variant="default" className="h-6 text-[10px] gap-1 px-2" onClick={handleSave}>
                <Check className="h-2.5 w-2.5" /> Guardar
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 px-2" onClick={() => setEditing(false)}>
                <X className="h-2.5 w-2.5" />
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {hasPreviewPanel ? (
          <Tabs
            key={`${artifact.id}-${resolvedPrimaryFormat}`}
            defaultValue={defaultTab}
            className="h-full min-h-0 flex flex-1 flex-col"
          >
            <div className="px-3 pt-2 border-b border-border/30 shrink-0">
              <TabsList className="h-7">
                {tabOrder.map((value) => {
                  if (value === "spreadsheet" && xlsxOutput) {
                    return (
                      <TabsTrigger key="spreadsheet" value="spreadsheet" className="text-[11px] h-5 px-2 gap-1">
                        <FileSpreadsheet className="h-3 w-3" /> Vista previa Excel (lectura)
                      </TabsTrigger>
                    );
                  }
                  if (value === "pdf" && pdfOutput) {
                    return (
                      <TabsTrigger key="pdf" value="pdf" className="text-[11px] h-5 px-2 gap-1">
                        <FileText className="h-3 w-3" /> Vista previa PDF (lectura)
                      </TabsTrigger>
                    );
                  }
                  if (value === "text") {
                    return (
                      <TabsTrigger key="text" value="text" className="text-[11px] h-5 px-2 gap-1">
                        <FileTextIcon className="h-3 w-3" /> Texto
                      </TabsTrigger>
                    );
                  }
                  return null;
                })}
              </TabsList>
            </div>
            {xlsxOutput ? (
              <TabsContent
                value="spreadsheet"
                className="flex-1 m-0 p-0 min-h-0 flex flex-col data-[state=active]:flex-1"
              >
                <div className="flex min-h-0 flex-1 min-h-[50vh] min-[900px]:min-h-0 flex-col">
                  <ArtifactSpreadsheetPreview
                    bucket={xlsxOutput.storage_bucket}
                    storagePath={xlsxOutput.storage_path}
                    fileName={xlsxOutput.file_name}
                  />
                </div>
              </TabsContent>
            ) : null}
            <TabsContent value="text" className="flex-1 m-0 overflow-y-auto p-4 min-h-0">
              <div className="prose prose-sm max-w-none [&_p]:my-1.5 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_code]:text-xs [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                <ReactMarkdown>{artifact.content}</ReactMarkdown>
              </div>
            </TabsContent>
            {pdfOutput ? (
              <TabsContent value="pdf" className="flex-1 m-0 p-0 min-h-0 flex flex-col data-[state=active]:flex-1">
                <div className="flex-1 min-h-[50vh] min-[900px]:min-h-0 flex flex-col">
                  <ArtifactPdfPreview bucket={pdfOutput.storage_bucket} path={pdfOutput.storage_path} />
                </div>
              </TabsContent>
            ) : null}
          </Tabs>
        ) : (
          // IMPORTANTE: el contenedor padre es `flex-1 min-h-0 overflow-hidden`
          // (no flex en sí mismo), así que aquí usamos `h-full overflow-y-auto`
          // para poder hacer scroll de markdown largos. Sin `h-full` el div
          // colapsa al alto del contenido y el viewer recortaba el documento.
          <div className="h-full overflow-y-auto p-4">
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
        )}
      </div>
    </div>
  );
}
