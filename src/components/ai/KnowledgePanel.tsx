import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FileText, BookOpen, Sparkles, Trash2, ChevronDown, ChevronRight,
  PanelLeftClose, FolderSync, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ArtifactViewer } from "./ArtifactViewer";
import { DocumentUploader } from "./DocumentUploader";
import type { AiArtifact } from "@/hooks/useAiArtifacts";
import type { AiMemory } from "@/hooks/useAiMemories";

interface KnowledgePanelProps {
  projectDocs: any[];
  memories: AiMemory[];
  artifacts: AiArtifact[];
  activeArtifactId: string | null;
  onClose: () => void;
  onRemoveDoc: (id: string) => void;
  onDeleteMemory: (id: string) => void;
  onDeleteArtifact: (id: string) => void;
  onUpdateArtifact: (id: string, content: string) => void;
  onViewArtifact: (id: string | null) => void;
  onUploadFile: (file: File) => void;
  uploading: boolean;
  uploadProgress: string;
  onIndexDropbox: (path: string) => void;
  indexing: boolean;
}

type Tab = "docs" | "memories" | "artifacts";

export function KnowledgePanel({
  projectDocs, memories, artifacts, activeArtifactId,
  onClose, onRemoveDoc, onDeleteMemory, onDeleteArtifact, onUpdateArtifact,
  onViewArtifact, onUploadFile, uploading, uploadProgress, onIndexDropbox, indexing,
}: KnowledgePanelProps) {
  const [tab, setTab] = useState<Tab>("docs");
  const [expandedMemory, setExpandedMemory] = useState<string | null>(null);
  const [dropboxPath, setDropboxPath] = useState("");

  const activeArtifact = artifacts.find((a) => a.id === activeArtifactId);

  if (activeArtifact) {
    return (
      <div className="w-[45vw] max-w-[600px] min-w-[320px] shrink-0 border-l border-border/40 flex flex-col bg-background">
        <ArtifactViewer
          artifact={activeArtifact}
          onBack={() => onViewArtifact(null)}
          onUpdate={onUpdateArtifact}
        />
      </div>
    );
  }

  return (
    <div className="w-80 shrink-0 border-l border-border/40 flex flex-col bg-secondary/10">
      {/* Header with tabs */}
      <div className="p-2 flex items-center justify-between border-b border-border/30">
        <div className="flex gap-0.5">
          {([
            { key: "docs", label: "Docs", icon: FileText, count: projectDocs.length },
            { key: "memories", label: "Memoria", icon: BookOpen, count: memories.length },
            { key: "artifacts", label: "Artifacts", icon: Sparkles, count: artifacts.length },
          ] as const).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                "px-2.5 py-1.5 text-[11px] font-medium rounded-md transition-colors flex items-center gap-1",
                tab === t.key
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              )}
            >
              <t.icon className="h-3 w-3" />
              {t.label}
              {t.count > 0 && <span className="text-[9px] opacity-70">({t.count})</span>}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} className="h-7 w-7 p-0">
          <PanelLeftClose className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === "docs" && (
          <div className="p-3 space-y-3">
            <DocumentUploader onUpload={onUploadFile} uploading={uploading} progress={uploadProgress} />

            <div className="flex gap-1.5">
              <Input
                placeholder="Ruta Dropbox..."
                value={dropboxPath}
                onChange={(e) => setDropboxPath(e.target.value)}
                className="h-7 text-[11px] flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[10px] gap-1 px-2 shrink-0"
                onClick={() => { onIndexDropbox(dropboxPath); setDropboxPath(""); }}
                disabled={!dropboxPath.trim() || indexing}
              >
                {indexing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderSync className="h-3 w-3" />}
              </Button>
            </div>

            {projectDocs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-6">
                Sube archivos o indexa desde Dropbox para dar contexto a la IA
              </p>
            ) : (
              <div className="space-y-1">
                {projectDocs.map((doc) => (
                  <div key={doc.id} className="group flex items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-secondary/40 transition-colors">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-medium truncate">{doc.name}</p>
                      <p className="text-[9px] text-muted-foreground">{doc.source}</p>
                    </div>
                    <button
                      onClick={() => onRemoveDoc(doc.id)}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "memories" && (
          <div className="p-3 space-y-1">
            {memories.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-6">
                La IA guardara automaticamente insights importantes
              </p>
            ) : (
              memories.map((mem) => (
                <div key={mem.id} className="rounded-lg bg-secondary/30 overflow-hidden">
                  <button
                    className="flex items-center justify-between w-full px-2.5 py-2 text-left hover:bg-secondary/50 transition-colors"
                    onClick={() => setExpandedMemory(expandedMemory === mem.id ? null : mem.id)}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      {expandedMemory === mem.id ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                      <span className="text-[11px] font-medium truncate">{mem.path.replace("/memories/", "")}</span>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteMemory(mem.id); }}
                      className="text-muted-foreground hover:text-destructive shrink-0 ml-1"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </button>
                  {expandedMemory === mem.id && (
                    <div className="px-3 pb-2 pt-0.5 border-t border-border/20">
                      <div className="prose prose-sm max-w-none text-[11px] [&_p]:my-0.5 [&_h1]:text-xs [&_h2]:text-xs [&_code]:text-[10px]">
                        <ReactMarkdown>{mem.content}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === "artifacts" && (
          <div className="p-3 space-y-1">
            {artifacts.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-6">
                Pide a la IA generar un manual, reporte o documento
              </p>
            ) : (
              artifacts.map((art) => (
                <div
                  key={art.id}
                  className="group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer hover:bg-secondary/40 transition-colors"
                  onClick={() => onViewArtifact(art.id)}
                >
                  <Sparkles className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium truncate">{art.title}</p>
                    <p className="text-[9px] text-muted-foreground">
                      {art.content_type} · {new Date(art.created_at).toLocaleDateString("es-MX")}
                    </p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteArtifact(art.id); }}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity shrink-0"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
