import { useState, useRef, useEffect, useMemo, useCallback, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { useChat } from "@/hooks/useChat";
import { useAiProjects, useAiProjectDocuments, useAiProjectMembers } from "@/hooks/useAiProjects";
import { useAiSharedMemories } from "@/hooks/useAiSharedMemories";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useAuth } from "@/contexts/AuthContext";
import { useAiMemories } from "@/hooks/useAiMemories";
import { useAiArtifacts } from "@/hooks/useAiArtifacts";
import { useProjectDocumentUpload } from "@/hooks/useProjectDocumentUpload";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Send, Sparkles, Loader2, PanelLeftClose, PanelLeft, PanelRightClose, PanelRight,
  BrainCircuit, Settings2, FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ProjectSidebar } from "@/components/ai/ProjectSidebar";
import { KnowledgePanel } from "@/components/ai/KnowledgePanel";
import { ArtifactCard } from "@/components/ai/ArtifactCard";
import { ProjectPreviewCard } from "@/components/ai/ProjectPreviewCard";
import { ChatAttachmentPicker, ChatAttachmentChips } from "@/components/ai/ChatAttachmentPicker";
import { ChatProcessingPanel } from "@/components/ai/ChatProcessingPanel";
import {
  MAX_CHAT_ATTACHMENT_BATCH_BYTES,
  MAX_CHAT_ATTACHMENT_BYTES_PER_FILE,
  MAX_CHAT_ATTACHMENT_FILES,
  formatMb,
} from "@/lib/chatAttachmentLimits";
import { AiProjectMembersDialog } from "@/components/ai/AiProjectMembersDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

const SUGGESTIONS = [
  "¿Cuáles son mis tareas pendientes más urgentes?",
  "No sé cómo hacer una declaración anual, ¿me guías?",
  "¿Qué comunicados internos recientes hay?",
  "¿Cómo está la carga de trabajo del equipo?",
  "Tengo miedo de equivocarme en un trámite, ¿me ayudas?",
  "¿Dónde encuentro el procedimiento para alta en IMSS?",
];

const ARTIFACT_RE = /\[artifact:([a-f0-9-]{36})\|([^\]]+)\|([^\]]+)\]/gi;
const PROJECT_LINK_RE = /\[project:([a-f0-9-]{36})\|([^\]|]+)(?:\|([^\]]*))?\]/gi;

const AsistenteIA = () => {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const {
    messages, isStreaming, streamProgressSteps, conversations, activeConversationId, activeAiProjectId,
    sendMessage, loadConversation, startNewChat, deleteConversation,
    updateConversationFolder, renameConversation, setAiProject,
  } = useChat();
  const {
    projects: aiProjects, createProject: createAiProject,
    archiveProject: archiveAiProject, updateProject: updateAiProject,
    leaveAiProject,
  } = useAiProjects();
  const { data: orgUsers = [] } = useOrgUsers();
  const { members: projectMembers, isLoading: membersLoading, addMember, removeMember } = useAiProjectMembers(activeAiProjectId);
  const { sharedMemories, deleteMemory: deleteSharedMemory } = useAiSharedMemories(activeAiProjectId);
  const { memories, deleteMemory, createMemory, updateMemory } = useAiMemories(activeAiProjectId);
  const { artifacts, deleteArtifact, updateArtifact } = useAiArtifacts(activeAiProjectId);
  const { documents: projectDocs, addDocument, removeDocument } = useAiProjectDocuments(activeAiProjectId);
  const { uploadToProject, uploading, progress: uploadProgress } = useProjectDocumentUpload(activeAiProjectId);

  const [input, setInput] = useState("");
  const [showSidebar, setShowSidebar] = useState(true);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [activeArtifactId, setActiveArtifactId] = useState<string | null>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [newProjectInstructions, setNewProjectInstructions] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [linkFilesToProject, setLinkFilesToProject] = useState(false);
  const [membersDialogOpen, setMembersDialogOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();

  const filteredConversations = useMemo(() => {
    if (activeAiProjectId) {
      return conversations.filter((c) => c.ai_project_id === activeAiProjectId);
    }
    return conversations;
  }, [conversations, activeAiProjectId]);

  const activeProject = useMemo(
    () => aiProjects.find((p) => p.id === activeAiProjectId),
    [aiProjects, activeAiProjectId]
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isMobile) setShowSidebar(false);
  }, [isMobile]);

  useEffect(() => {
    const projectParam = searchParams.get("project");
    if (projectParam && projectParam !== activeAiProjectId) {
      setAiProject(projectParam);
    }
  }, [searchParams]);

  useEffect(() => {
    if (activeProject) setShowKnowledge(true);
  }, [activeProject?.id]);

  const handleSend = () => {
    if ((!input.trim() && pendingFiles.length === 0) || isStreaming) return;
    sendMessage(input.trim(), {
      files: pendingFiles,
      onAfterChatUpload:
        linkFilesToProject && activeAiProjectId ? (file) => uploadToProject(file) : undefined,
    });
    setInput("");
    setPendingFiles([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  };

  const handleCreateAiProject = async () => {
    if (!newProjectName.trim()) return;
    try {
      await createAiProject.mutateAsync({
        name: newProjectName.trim(),
        description: newProjectDesc.trim() || undefined,
        instructions: newProjectInstructions.trim() || undefined,
      });
      toast.success("Proyecto de IA creado");
      setShowCreateProject(false);
      setNewProjectName("");
      setNewProjectDesc("");
      setNewProjectInstructions("");
    } catch (e) {
      console.error("[AsistenteIA] createAiProject", e);
      const msg =
        e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string"
          ? (e as { message: string }).message
          : e instanceof Error
            ? e.message
            : "Error al crear proyecto";
      toast.error(msg);
    }
  };

  const handleIndexDropbox = useCallback(async (path: string) => {
    if (!path.trim()) return;
    setIndexing(true);
    try {
      const { error } = await supabase.functions.invoke("index-dropbox", {
        body: { folder_path: path.trim(), ai_project_id: activeAiProjectId },
      });
      if (error) throw error;
      toast.success("Indexacion de Dropbox iniciada");
    } catch (e: any) {
      toast.error(e.message || "Error al indexar");
    } finally {
      setIndexing(false);
    }
  }, [activeAiProjectId]);

  const handleAddDropboxFile = useCallback(async (file: { name: string; path: string }) => {
    if (!activeAiProjectId || !file.path) return;
    setIndexing(true);
    try {
      const orgRes = await supabase.rpc("get_user_org_id" as any, {
        _user_id: (await supabase.auth.getUser()).data.user?.id,
      });

      const clientId = activeProject?.client_id || null;
      const projectId = activeProject?.project_id || null;

      const { data: doc, error: docErr } = await (supabase as any)
        .from("documents")
        .insert({
          organization_id: orgRes.data,
          client_id: clientId,
          project_id: projectId,
          name: file.name,
          source: "dropbox",
          external_path: file.path,
          document_type: file.name.split(".").pop()?.toUpperCase() || "FILE",
        })
        .select("id")
        .single();

      if (docErr) throw docErr;

      await addDocument.mutateAsync({
        ai_project_id: activeAiProjectId,
        document_id: doc.id,
        dropbox_path: file.path,
        name: file.name,
        source: "dropbox",
      });

      supabase.functions.invoke("process-document", {
        body: { document_id: doc.id },
      }).then(() => {
        toast.success(`${file.name} procesado correctamente`);
      }).catch((err) => {
        console.error("process-document error:", err);
      });

      toast.success(`${file.name} vinculado al proyecto`);
    } catch (e: any) {
      toast.error(e.message || "Error al vincular archivo de Dropbox");
    } finally {
      setIndexing(false);
    }
  }, [activeAiProjectId, activeProject, addDocument]);

  const handleViewArtifact = useCallback((id: string | null) => {
    setActiveArtifactId(id);
    if (id) setShowKnowledge(true);
  }, []);

  const renderMessageContent = (
    content: string,
    role: string,
    attachments?: { name: string; mime_type?: string }[],
    options?: { isError?: boolean }
  ) => {
    if (role === "assistant" && options?.isError) {
      return (
        <div className="text-sm prose prose-sm max-w-none prose-p:text-destructive prose-headings:text-destructive [&_strong]:text-destructive">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      );
    }
    if (role === "user") {
      return (
        <div className="space-y-2">
          <p className="text-sm whitespace-pre-wrap">{content}</p>
          {attachments && attachments.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {attachments.map((a, idx) => (
                <span
                  key={`${a.name}-${idx}`}
                  className="inline-flex items-center gap-1 text-[10px] bg-primary-foreground/15 rounded px-1.5 py-0.5"
                >
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="truncate max-w-[140px]">{a.name}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      );
    }

    const COMBINED_RE = /\[artifact:([a-f0-9-]{36})\|([^\]]+)\|([^\]]+)\]|\[project:([a-f0-9-]{36})\|([^\]|]+)(?:\|([^\]]*))?\]/gi;

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = COMBINED_RE.exec(content)) !== null) {
      if (match.index > lastIndex) {
        const textBefore = content.slice(lastIndex, match.index);
        parts.push(
          <div key={`text-${lastIndex}`} className="prose prose-sm max-w-none text-foreground [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs [&_code]:bg-secondary/60 [&_code]:px-1 [&_code]:rounded">
            <ReactMarkdown>{textBefore}</ReactMarkdown>
          </div>
        );
      }

      if (match[1]) {
        parts.push(
          <ArtifactCard
            key={`artifact-${match[1]}`}
            artifactId={match[1]}
            title={match[2]}
            contentType={match[3]}
            onView={handleViewArtifact}
          />
        );
      } else if (match[4]) {
        parts.push(
          <ProjectPreviewCard
            key={`project-${match[4]}`}
            project={{ id: match[4], name: match[5], area: match[6] || undefined }}
          />
        );
      }
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      parts.push(
        <div key={`text-${lastIndex}`} className="prose prose-sm max-w-none text-foreground [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs [&_code]:bg-secondary/60 [&_code]:px-1 [&_code]:rounded">
          <ReactMarkdown>{content.slice(lastIndex)}</ReactMarkdown>
        </div>
      );
    }

    return parts.length > 0 ? <>{parts}</> : (
      <div className="prose prose-sm max-w-none text-foreground [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs [&_code]:bg-secondary/60 [&_code]:px-1 [&_code]:rounded">
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="flex h-[calc(100vh-4rem)] -mt-2">
        {/* Left sidebar */}
        {showSidebar && (
          <ProjectSidebar
            activeProject={activeProject ?? null}
            aiProjects={aiProjects}
            activeAiProjectId={activeAiProjectId}
            activeConversationId={activeConversationId}
            filteredConversations={filteredConversations}
            onSelectProject={setAiProject}
            onNewChat={startNewChat}
            onLoadConversation={loadConversation}
            onDeleteConversation={deleteConversation}
            onRenameConversation={renameConversation}
            onMoveConversation={(id, folder) => {
              updateConversationFolder(id, folder);
              toast.success(folder ? `Movido a "${folder}"` : "Movido a conversaciones generales");
            }}
            onCreateProject={() => setShowCreateProject(true)}
            onArchiveProject={(id) => archiveAiProject.mutate(id)}
            onLeaveProject={(id) => {
              leaveAiProject.mutate(id, {
                onSuccess: () => {
                  toast.success("Saliste del proyecto compartido");
                  if (activeAiProjectId === id) setAiProject(null);
                },
                onError: (e: Error) => toast.error(e.message),
              });
            }}
            onUpdateInstructions={(id, instr) => {
              updateAiProject.mutate({ id, instructions: instr });
              toast.success("Instrucciones actualizadas");
            }}
            currentUserId={user?.id}
            onOpenMembers={activeAiProjectId ? () => setMembersDialogOpen(true) : undefined}
          />
        )}

        {/* Main chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30">
            <Button size="sm" variant="ghost" onClick={() => setShowSidebar(!showSidebar)} className="h-7 w-7 p-0">
              {showSidebar ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
            </Button>
            <Sparkles className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold text-foreground">Kawiil AI</h1>
            {activeProject ? (
              <span className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full flex items-center gap-1">
                <BrainCircuit className="h-2.5 w-2.5" /> {activeProject.name}
              </span>
            ) : (
              <span className="text-[10px] text-muted-foreground bg-primary/10 px-2 py-0.5 rounded-full">
                Asistente interno
              </span>
            )}
            <div className="flex-1" />
            {activeProject && (
              <Button
                size="sm"
                variant={showKnowledge ? "secondary" : "ghost"}
                onClick={() => { setShowKnowledge(!showKnowledge); setActiveArtifactId(null); }}
                className="h-7 text-xs gap-1.5"
              >
                {showKnowledge ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRight className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">Conocimiento</span>
              </Button>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full max-w-lg mx-auto">
                <div className="rounded-2xl bg-primary/5 p-4 mb-6">
                  {activeProject ? (
                    <BrainCircuit className="h-8 w-8 text-primary" />
                  ) : (
                    <Sparkles className="h-8 w-8 text-primary" />
                  )}
                </div>
                {activeProject ? (
                  <>
                    <h2 className="text-lg font-semibold text-foreground mb-1">{activeProject.name}</h2>
                    {activeProject.description && (
                      <p className="text-sm text-muted-foreground text-center mb-2">{activeProject.description}</p>
                    )}
                    {activeProject.instructions && (
                      <div className="text-xs text-muted-foreground bg-secondary/40 rounded-lg px-3 py-2 mb-6 max-w-sm">
                        <span className="font-medium text-foreground flex items-center gap-1 mb-1">
                          <Settings2 className="h-3 w-3" /> Instrucciones:
                        </span>
                        <p className="line-clamp-3">{activeProject.instructions}</p>
                      </div>
                    )}
                    <p className="text-sm text-muted-foreground text-center mb-6">
                      Inicia una conversacion dentro de este proyecto. La IA usara el contexto y documentos vinculados.
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="text-lg font-semibold text-foreground mb-1">¿En qué te puedo ayudar?</h2>
                    <p className="text-sm text-muted-foreground text-center mb-6">
                      Puedo ayudarte con redacción de correos, documentos, consultas fiscales y priorización de tareas.
                    </p>
                  </>
                )}
                <div className="grid gap-2 w-full grid-cols-1 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => { setInput(s); textareaRef.current?.focus(); }}
                      className="text-left rounded-xl bg-secondary/40 hover:bg-secondary/70 px-4 py-3 text-[13px] text-foreground transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <div className="mt-8 text-center">
                  <p className="text-xs text-muted-foreground/60">
                    {activeProject
                      ? "Las conversaciones de este proyecto tienen contexto personalizado"
                      : "Tip: Crea un Proyecto IA para dar contexto persistente a la IA"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto space-y-6">
                {messages.map((msg, i) => {
                  const showProgressBeforeAssistant =
                    isStreaming &&
                    msg.role === "assistant" &&
                    i === messages.length - 1 &&
                    streamProgressSteps.length > 0;
                  return (
                    <Fragment key={msg.id || `m-${i}`}>
                      {showProgressBeforeAssistant && (
                        <div className="flex gap-3 justify-start">
                          <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                            <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                          </div>
                          <ChatProcessingPanel steps={streamProgressSteps} className="flex-1 min-w-0" />
                        </div>
                      )}
                      <div
                        className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}
                      >
                        {msg.role === "assistant" && (
                          <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                            <Sparkles className="h-3.5 w-3.5 text-primary" />
                          </div>
                        )}
                        <div
                          className={cn(
                            "rounded-2xl px-4 py-3 max-w-[85%]",
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : msg.isError
                                ? "bg-destructive/10 border border-destructive/25 text-foreground"
                                : "bg-secondary/40"
                          )}
                        >
                          {renderMessageContent(msg.content, msg.role, msg.attachments, {
                            isError: msg.isError,
                          })}
                          {msg.role === "assistant" &&
                            msg.activityLog &&
                            msg.activityLog.length > 0 && (
                              <details className="mt-3 text-[10px] text-muted-foreground border-t border-border/40 pt-2">
                                <summary className="cursor-pointer select-none font-medium text-foreground/70">
                                  Pasos del proceso
                                </summary>
                                <ol className="mt-1.5 list-decimal pl-4 space-y-0.5">
                                  {msg.activityLog.map((line, j) => (
                                    <li key={j}>{line}</li>
                                  ))}
                                </ol>
                              </details>
                            )}
                        </div>
                      </div>
                    </Fragment>
                  );
                })}
                {isStreaming &&
                  messages[messages.length - 1]?.role === "user" &&
                  (streamProgressSteps.length > 0 ? (
                    <div className="flex gap-3 justify-start">
                      <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                      </div>
                      <ChatProcessingPanel steps={streamProgressSteps} className="flex-1 min-w-0" />
                    </div>
                  ) : (
                    <div className="flex gap-3">
                      <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                      </div>
                      <div className="rounded-2xl bg-secondary/40 px-4 py-3">
                        <div className="flex gap-1">
                          <div
                            className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce"
                            style={{ animationDelay: "0ms" }}
                          />
                          <div
                            className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce"
                            style={{ animationDelay: "150ms" }}
                          />
                          <div
                            className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce"
                            style={{ animationDelay: "300ms" }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border/30 px-4 py-3">
            <div className="max-w-3xl mx-auto flex flex-col gap-2">
              <ChatAttachmentChips
                files={pendingFiles}
                disabled={isStreaming}
                onRemove={(i) => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
              />
              <div className="flex gap-2 items-end">
                <ChatAttachmentPicker
                  files={pendingFiles}
                  onChange={setPendingFiles}
                  disabled={isStreaming}
                  showChips={false}
                  className="shrink-0"
                />
                <Textarea
                  ref={textareaRef}
                  value={input}
                  onChange={handleTextareaChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Escribe tu mensaje o adjunta archivos…"
                  className="resize-none min-h-[80px] max-h-[200px] text-sm bg-secondary/30 border-0 rounded-xl flex-1 min-w-0"
                  rows={3}
                  disabled={isStreaming}
                />
                <Button
                  size="sm"
                  onClick={handleSend}
                  disabled={(!input.trim() && pendingFiles.length === 0) || isStreaming}
                  className="h-[42px] w-[42px] rounded-xl shrink-0"
                >
                  {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            {activeAiProjectId && (
              <div className="max-w-3xl mx-auto flex items-center gap-2 mt-2">
                <Checkbox
                  id="link-project-files"
                  checked={linkFilesToProject}
                  onCheckedChange={(c) => setLinkFilesToProject(!!c)}
                  disabled={isStreaming}
                />
                <Label htmlFor="link-project-files" className="text-[10px] text-muted-foreground cursor-pointer font-normal">
                  También vincular adjuntos al conocimiento del proyecto (documentos Kawiil)
                </Label>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground text-center mt-2 px-1">
              Adjuntos: imágenes, PDF, Excel, texto, SQLite — hasta {MAX_CHAT_ATTACHMENT_FILES} archivos,{" "}
              {formatMb(MAX_CHAT_ATTACHMENT_BYTES_PER_FILE)} MB por archivo, {formatMb(MAX_CHAT_ATTACHMENT_BATCH_BYTES)}{" "}
              MB total por mensaje. PDF mayores a ~3 MB se procesan como texto en el servidor (no binario completo) para evitar límites de la función. Kawiil AI puede cometer errores.
            </p>
          </div>
        </div>

        {/* Right knowledge panel */}
        {showKnowledge && activeProject && (
          <KnowledgePanel
            projectDocs={projectDocs}
            memories={memories}
            sharedMemories={sharedMemories}
            artifacts={artifacts}
            activeArtifactId={activeArtifactId}
            onClose={() => { setShowKnowledge(false); setActiveArtifactId(null); }}
            onRemoveDoc={(id) => removeDocument.mutate(id)}
            onDeleteMemory={(id) => deleteMemory.mutate(id)}
            onDeleteSharedMemory={(id) => deleteSharedMemory.mutate(id)}
            onDeleteArtifact={(id) => deleteArtifact.mutate(id)}
            onUpdateArtifact={(id, content) => updateArtifact.mutate({ id, content })}
            onViewArtifact={handleViewArtifact}
            onUploadFile={uploadToProject}
            uploading={uploading}
            uploadProgress={uploadProgress}
            onIndexDropbox={handleIndexDropbox}
            indexing={indexing}
            onCreateMemory={(path, content) => createMemory.mutate({ path, content })}
            onUpdateMemory={(id, content) => updateMemory.mutate({ id, content })}
            onAddDropboxFile={handleAddDropboxFile}
          />
        )}
      </div>

      {/* Create AI Project Dialog */}
      <AiProjectMembersDialog
        open={membersDialogOpen}
        onOpenChange={setMembersDialogOpen}
        project={activeProject ?? null}
        members={projectMembers}
        orgUsers={orgUsers}
        currentUserId={user?.id}
        isLoading={membersLoading}
        onAddMember={async (userId, role) => {
          await addMember.mutateAsync({ userId, role });
          toast.success("Miembro invitado");
        }}
        onRemoveMember={async (memberRowId) => {
          await removeMember.mutateAsync(memberRowId);
          toast.success("Miembro eliminado");
        }}
      />

      <Dialog open={showCreateProject} onOpenChange={setShowCreateProject}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-primary" />
              Nuevo Proyecto de IA
            </DialogTitle>
            <DialogDescription>
              Crea un espacio con instrucciones personalizadas y documentos vinculados para que la IA tenga contexto persistente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1 block">Nombre</label>
              <Input
                placeholder="Ej: Cumplimiento PLD, Declaraciones Anuales..."
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Descripcion (opcional)</label>
              <Input
                placeholder="Breve descripcion del proposito del proyecto"
                value={newProjectDesc}
                onChange={(e) => setNewProjectDesc(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Instrucciones para la IA (opcional)</label>
              <Textarea
                placeholder="Ej: Siempre referencia la Ley Federal de PLD. Enfocate en el marco regulatorio mexicano..."
                value={newProjectInstructions}
                onChange={(e) => setNewProjectInstructions(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateProject(false)}>Cancelar</Button>
            <Button onClick={handleCreateAiProject} disabled={!newProjectName.trim() || createAiProject.isPending}>
              {createAiProject.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <BrainCircuit className="h-4 w-4 mr-2" />}
              Crear proyecto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
};

export default AsistenteIA;
