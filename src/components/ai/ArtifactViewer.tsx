import { useMemo, useState } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import type { AiArtifact, KawiilArtifactOutput, KawiilOutputFormat } from "@/hooks/useAiArtifacts";
import { supabase } from "@/integrations/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArtifactPdfPreview } from "./ArtifactPdfPreview";
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

export function ArtifactViewer({ artifact, onBack, onUpdate }: ArtifactViewerProps) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(artifact.content);

  const templateMeta = getTemplateMeta(artifact.template_key);
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
  const isKawiilDoc = outputs.length > 0;
  const isLegacyMarkdown = !isKawiilDoc;

  const safeTitle = artifact.title.replace(/[^a-zA-Z0-9_-]/g, "_") || "documento";

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
    <div className="flex flex-col h-full">
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
            <h3 className={`text-sm font-semibold leading-tight ${isKawiilDoc ? KAWIIL_AI_TEXT_GRADIENT_CLASS : ""}`}>
              {artifact.title}
            </h3>
            {primaryOutput ? (
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Formato primario: {FORMAT_LABEL[primaryOutput.format] || primaryOutput.format.toUpperCase()}
                {outputs.length > 1 ? ` · ${outputs.length} formatos disponibles` : ""}
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
                <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2">
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
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2" onClick={handleDownloadMarkdown}>
              <Download className="h-2.5 w-2.5" /> Descargar .md
            </Button>
          )}
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

      <div className="flex-1 min-h-0 overflow-hidden">
        {pdfOutput ? (
          <Tabs defaultValue="pdf" className="h-full flex flex-col">
            <div className="px-3 pt-2 border-b border-border/30">
              <TabsList className="h-7">
                <TabsTrigger value="pdf" className="text-[11px] h-5 px-2 gap-1"><FileText className="h-3 w-3" /> PDF</TabsTrigger>
                <TabsTrigger value="text" className="text-[11px] h-5 px-2 gap-1"><FileTextIcon className="h-3 w-3" /> Texto</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="pdf" className="flex-1 m-0 p-0 min-h-0">
              <ArtifactPdfPreview bucket={pdfOutput.storage_bucket} path={pdfOutput.storage_path} />
            </TabsContent>
            <TabsContent value="text" className="flex-1 m-0 overflow-y-auto p-4 min-h-0">
              <div className="prose prose-sm max-w-none [&_p]:my-1.5 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_code]:text-xs [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                <ReactMarkdown>{artifact.content}</ReactMarkdown>
              </div>
            </TabsContent>
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
