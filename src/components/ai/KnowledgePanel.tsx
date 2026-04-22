import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  FileText, BookOpen, Sparkles, Trash2, ChevronDown, ChevronRight,
  PanelLeftClose, Loader2, Pencil, Clock, Check, X,
  FolderSync, BookmarkPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ArtifactViewer } from "./ArtifactViewer";
import { DocumentUploader } from "./DocumentUploader";
import { DropboxFilePicker } from "@/components/projects/DropboxFilePicker";
import type { AiArtifact } from "@/hooks/useAiArtifacts";
import type { AiMemory } from "@/hooks/useAiMemories";
import type { AiSharedMemory } from "@/hooks/useAiSharedMemories";

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `hace ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days}d`;
  return new Date(dateStr).toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

interface KnowledgePanelProps {
  projectDocs: any[];
  memories: AiMemory[];
  sharedMemories?: AiSharedMemory[];
  artifacts: AiArtifact[];
  activeArtifactId: string | null;
  onClose: () => void;
  onRemoveDoc: (id: string) => void;
  onDeleteMemory: (id: string) => void;
  onDeleteSharedMemory?: (id: string) => void;
  onDeleteArtifact: (id: string) => void;
  onUpdateArtifact: (id: string, content: string) => void;
  onViewArtifact: (id: string | null) => void;
  onUploadFile: (file: File) => void;
  uploading: boolean;
  uploadProgress: string;
  onIndexDropbox: (path: string) => void;
  indexing: boolean;
  onCreateMemory?: (path: string, content: string) => void;
  onUpdateMemory?: (id: string, content: string) => void;
  onAddDropboxFile?: (file: { name: string; path: string }) => void;
}

type Tab = "docs" | "memories" | "artifacts";

export function KnowledgePanel({
  projectDocs, memories, sharedMemories = [], artifacts, activeArtifactId,
  onClose, onRemoveDoc, onDeleteMemory, onDeleteSharedMemory, onDeleteArtifact, onUpdateArtifact,
  onViewArtifact, onUploadFile, uploading, uploadProgress, onIndexDropbox, indexing,
  onCreateMemory, onUpdateMemory, onAddDropboxFile,
}: KnowledgePanelProps) {
  const [tab, setTab] = useState<Tab>("docs");
  const [expandedMemory, setExpandedMemory] = useState<string | null>(null);
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryContent, setEditingMemoryContent] = useState("");
  const [showDropboxPicker, setShowDropboxPicker] = useState(false);

  const activeArtifact = artifacts.find((a) => a.id === activeArtifactId);

  if (activeArtifact) {
    return (
      <div className="w-[min(45vw,900px)] max-w-[min(92vw,900px)] min-w-[320px] shrink-0 border-l border-border/40 flex flex-col bg-background min-h-0">
        <ArtifactViewer
          artifact={activeArtifact}
          onBack={() => onViewArtifact(null)}
          onUpdate={onUpdateArtifact}
        />
      </div>
    );
  }

  const handlePromoteToMemory = (name: string, content: string) => {
    if (!onCreateMemory) return;
    const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, "_").substring(0, 60);
    onCreateMemory(`/memories/${safeName}`, content);
  };

  const handleSaveMemoryEdit = (id: string) => {
    if (onUpdateMemory && editingMemoryContent.trim()) {
      onUpdateMemory(id, editingMemoryContent.trim());
    }
    setEditingMemoryId(null);
    setEditingMemoryContent("");
  };

  return (
    <div className="w-80 shrink-0 border-l border-border/40 flex flex-col bg-secondary/10">
      {/* Header with tabs */}
      <div className="p-2 flex items-center justify-between border-b border-border/30">
        <div className="flex gap-0.5">
          {([
            { key: "docs", label: "Docs", icon: FileText, count: projectDocs.length },
            { key: "memories", label: "Memoria", icon: BookOpen, count: memories.length },
            { key: "artifacts", label: "Artefactos", icon: Sparkles, count: artifacts.length },
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

            {/* Dropbox file picker button */}
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-[10px] gap-1.5"
              onClick={() => setShowDropboxPicker(true)}
              disabled={indexing}
            >
              {indexing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderSync className="h-3 w-3" />}
              Seleccionar de Dropbox
            </Button>

            {projectDocs.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-6">
                Sube archivos o selecciona de Dropbox para dar contexto a la IA
              </p>
            ) : (
              <div className="space-y-0.5">
                {projectDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="group flex items-start gap-1.5 rounded-md px-1.5 py-1.5 hover:bg-secondary/40 transition-colors"
                  >
                    <FileText className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-normal text-foreground leading-snug line-clamp-2 break-words normal-case">
                        {doc.name}
                      </p>
                      <p className="text-[8px] text-muted-foreground/90">{doc.source}</p>
                    </div>
                    <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      {onCreateMemory && (
                        <button
                          onClick={() => handlePromoteToMemory(doc.name, `Documento: ${doc.name}\nFuente: ${doc.source}\n${doc.dropbox_path ? `Dropbox: ${doc.dropbox_path}` : ""}`)}
                          className="text-muted-foreground hover:text-primary"
                          title="Agregar a memoria"
                        >
                          <BookmarkPlus className="h-3 w-3" />
                        </button>
                      )}
                      <button
                        onClick={() => onRemoveDoc(doc.id)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "memories" && (
          <div className="p-3 space-y-1.5">
            {sharedMemories.length > 0 && (
              <div className="mb-3 pb-3 border-b border-border/30">
                <p className="text-[10px] font-semibold text-primary mb-1.5">Memoria de equipo (/team/)</p>
                <div className="space-y-1">
                  {sharedMemories.map((sm) => (
                    <div key={sm.id} className="flex items-start justify-between gap-2 rounded-lg bg-primary/5 px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-medium truncate">{sm.path.replace(/^\/team\//, "")}</p>
                        <p className="text-[9px] text-muted-foreground line-clamp-2">{sm.content}</p>
                      </div>
                      {onDeleteSharedMemory && (
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => onDeleteSharedMemory(sm.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {memories.length === 0 && sharedMemories.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-6">
                La IA guardara automaticamente insights importantes.
                Tambien puedes promover documentos o artefactos a memoria.
              </p>
            ) : null}
            {memories.length > 0 ? (
              memories.map((mem) => {
                const isExpanded = expandedMemory === mem.id;
                const isEditing = editingMemoryId === mem.id;
                const wasUpdated = mem.updated_at !== mem.created_at;

                return (
                  <div key={mem.id} className="rounded-lg bg-secondary/30 overflow-hidden">
                    <button
                      className="flex items-center justify-between w-full px-2.5 py-2 text-left hover:bg-secondary/50 transition-colors"
                      onClick={() => setExpandedMemory(isExpanded ? null : mem.id)}
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                        <span className="text-[11px] font-medium truncate">{mem.path.replace("/memories/", "")}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-1">
                        <span className="text-[8px] text-muted-foreground/60 flex items-center gap-0.5">
                          <Clock className="h-2 w-2" />
                          {timeAgo(mem.updated_at)}
                        </span>
                        {wasUpdated && (
                          <span className="text-[7px] bg-primary/10 text-primary px-1 rounded">editada</span>
                        )}
                      </div>
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-2 pt-0.5 border-t border-border/20">
                        {isEditing ? (
                          <div className="space-y-1.5">
                            <Textarea
                              value={editingMemoryContent}
                              onChange={(e) => setEditingMemoryContent(e.target.value)}
                              rows={4}
                              className="text-[11px] resize-none"
                              autoFocus
                            />
                            <div className="flex gap-1">
                              <Button size="sm" className="h-5 text-[9px] flex-1 gap-1" onClick={() => handleSaveMemoryEdit(mem.id)}>
                                <Check className="h-2.5 w-2.5" /> Guardar
                              </Button>
                              <Button size="sm" variant="ghost" className="h-5 text-[9px] gap-1" onClick={() => setEditingMemoryId(null)}>
                                <X className="h-2.5 w-2.5" /> Cancelar
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="prose prose-sm max-w-none text-[11px] [&_p]:my-0.5 [&_h1]:text-xs [&_h2]:text-xs [&_code]:text-[10px]">
                              <ReactMarkdown>{mem.content}</ReactMarkdown>
                            </div>
                            <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-border/20">
                              <span className="text-[8px] text-muted-foreground/50">
                                Creada: {new Date(mem.created_at).toLocaleDateString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                              </span>
                              <div className="flex gap-1">
                                {onUpdateMemory && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingMemoryId(mem.id);
                                      setEditingMemoryContent(mem.content);
                                    }}
                                    className="text-muted-foreground hover:text-primary"
                                    title="Editar"
                                  >
                                    <Pencil className="h-2.5 w-2.5" />
                                  </button>
                                )}
                                <button
                                  onClick={(e) => { e.stopPropagation(); onDeleteMemory(mem.id); }}
                                  className="text-muted-foreground hover:text-destructive"
                                >
                                  <Trash2 className="h-2.5 w-2.5" />
                                </button>
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            ) : null}
          </div>
        )}

        {tab === "artifacts" && (
          <div className="p-3 space-y-1">
            {artifacts.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-6">
                Pide a la IA generar un manual, reporte o documento
              </p>
            ) : (
              artifacts.map((art) => {
                const typeLabel = art.template_key
                  ? `Kawiil · ${(art.primary_format || "pdf").toUpperCase()}`
                  : art.content_type === "office"
                    ? art.office_kind === "spreadsheet"
                      ? "Excel"
                      : art.office_kind === "presentation"
                        ? "PowerPoint"
                        : "Word"
                    : art.content_type;
                return (
                <div
                  key={art.id}
                  className="group flex items-center gap-2 rounded-lg px-2.5 py-2 cursor-pointer hover:bg-secondary/40 transition-colors"
                  onClick={() => onViewArtifact(art.id)}
                >
                  <Sparkles className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium truncate">{art.title}</p>
                    <p className="text-[9px] text-muted-foreground">
                      {typeLabel} · {new Date(art.created_at).toLocaleDateString("es-MX")}
                    </p>
                  </div>
                  <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {onCreateMemory && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePromoteToMemory(`artifact_${art.title}`, art.content);
                        }}
                        className="text-muted-foreground hover:text-primary"
                        title="Guardar como memoria"
                      >
                        <BookmarkPlus className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteArtifact(art.id); }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Dropbox file picker dialog */}
      <DropboxFilePicker
        open={showDropboxPicker}
        onClose={() => setShowDropboxPicker(false)}
        onSelect={(file) => {
          if (onAddDropboxFile) {
            onAddDropboxFile({ name: file.name, path: file.url });
          }
          setShowDropboxPicker(false);
        }}
      />
    </div>
  );
}
