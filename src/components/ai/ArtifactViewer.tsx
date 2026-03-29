import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Copy, Download, Pencil, Check, X } from "lucide-react";
import { toast } from "sonner";
import type { AiArtifact } from "@/hooks/useAiArtifacts";

interface ArtifactViewerProps {
  artifact: AiArtifact;
  onBack: () => void;
  onUpdate: (id: string, content: string) => void;
}

export function ArtifactViewer({ artifact, onBack, onUpdate }: ArtifactViewerProps) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(artifact.content);

  const handleCopy = () => {
    navigator.clipboard.writeText(artifact.content);
    toast.success("Copiado al portapapeles");
  };

  const handleDownload = () => {
    const ext = artifact.content_type === "csv" ? "csv" : artifact.content_type === "html" ? "html" : "md";
    const blob = new Blob([artifact.content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${artifact.title.replace(/[^a-zA-Z0-9_-]/g, "_")}.${ext}`;
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
      <div className="p-3 border-b border-border/30 space-y-2">
        <button className="text-xs text-primary hover:underline flex items-center gap-1" onClick={onBack}>
          <ArrowLeft className="h-3 w-3" /> Volver
        </button>
        <h3 className="text-sm font-semibold leading-tight">{artifact.title}</h3>
        <div className="flex gap-1.5">
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2" onClick={handleCopy}>
            <Copy className="h-2.5 w-2.5" /> Copiar
          </Button>
          <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2" onClick={handleDownload}>
            <Download className="h-2.5 w-2.5" /> Descargar
          </Button>
          {!editing ? (
            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2" onClick={() => { setEditContent(artifact.content); setEditing(true); }}>
              <Pencil className="h-2.5 w-2.5" /> Editar
            </Button>
          ) : (
            <>
              <Button size="sm" variant="default" className="h-6 text-[10px] gap-1 px-2" onClick={handleSave}>
                <Check className="h-2.5 w-2.5" /> Guardar
              </Button>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 px-2" onClick={() => setEditing(false)}>
                <X className="h-2.5 w-2.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {editing ? (
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="min-h-[400px] text-sm font-mono resize-none"
          />
        ) : (
          <div className="prose prose-sm max-w-none [&_p]:my-1.5 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_code]:text-xs [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
            <ReactMarkdown>{artifact.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
