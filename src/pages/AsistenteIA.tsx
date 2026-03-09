import { useState, useRef, useEffect, useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useChat, ChatConversation } from "@/hooks/useChat";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Plus, Send, Trash2, MessageSquare, Sparkles, Loader2,
  PanelLeftClose, PanelLeft, FolderOpen, Folder, FolderPlus,
  MoreHorizontal, Pencil, FolderInput, ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";

const SUGGESTIONS = [
  "¿Cuáles son mis tareas pendientes más urgentes?",
  "No sé cómo hacer una declaración anual, ¿me guías?",
  "¿Qué comunicados internos recientes hay?",
  "¿Cómo está la carga de trabajo del equipo?",
  "Tengo miedo de equivocarme en un trámite, ¿me ayudas?",
  "¿Dónde encuentro el procedimiento para alta en IMSS?",
];

const FOLDER_PRESETS = [
  "📋 Proyectos",
  "📊 Contabilidad",
  "⚖️ Legal",
  "📝 Redacción",
  "🔍 Consultas",
  "💡 Ideas",
];

const AsistenteIA = () => {
  const {
    messages, isStreaming, conversations, activeConversationId,
    sendMessage, loadConversation, startNewChat, deleteConversation,
    updateConversationFolder, renameConversation,
  } = useChat();

  const [input, setInput] = useState("");
  const [showSidebar, setShowSidebar] = useState(true);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(["__none__"]));
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  // Group conversations by folder
  const groupedConversations = useMemo(() => {
    const groups: Record<string, ChatConversation[]> = {};
    conversations.forEach((c) => {
      const key = c.folder || "__none__";
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    return groups;
  }, [conversations]);

  const folders = useMemo(() => {
    return Object.keys(groupedConversations).filter(f => f !== "__none__").sort();
  }, [groupedConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isMobile) setShowSidebar(false);
  }, [isMobile]);

  useEffect(() => {
    if (renamingId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingId]);

  const handleSend = () => {
    if (!input.trim() || isStreaming) return;
    sendMessage(input.trim());
    setInput("");
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
    ta.style.height = Math.min(ta.scrollHeight, 150) + "px";
  };

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });
  };

  const handleRenameSubmit = (id: string) => {
    if (renameValue.trim()) {
      renameConversation(id, renameValue.trim());
    }
    setRenamingId(null);
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    // Folders are created by assigning conversations to them
    toast.success(`Carpeta "${newFolderName.trim()}" lista. Mueve conversaciones aquí.`);
    setExpandedFolders(prev => new Set([...prev, newFolderName.trim()]));
    setNewFolderName("");
    setShowNewFolder(false);
  };

  const handleMoveToFolder = (convId: string, folder: string | null) => {
    updateConversationFolder(convId, folder);
    if (folder) {
      setExpandedFolders(prev => new Set([...prev, folder]));
    }
    toast.success(folder ? `Movido a "${folder}"` : "Movido a conversaciones generales");
  };

  const renderConversation = (c: ChatConversation) => (
    <div
      key={c.id}
      className={cn(
        "group flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm cursor-pointer transition-colors",
        activeConversationId === c.id
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      )}
      onClick={() => loadConversation(c.id)}
    >
      <MessageSquare className="h-3 w-3 shrink-0" />
      {renamingId === c.id ? (
        <Input
          ref={renameRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => handleRenameSubmit(c.id)}
          onKeyDown={(e) => { if (e.key === "Enter") handleRenameSubmit(c.id); if (e.key === "Escape") setRenamingId(null); }}
          className="h-6 text-[12px] px-1 py-0 border-primary/30"
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="truncate flex-1 text-[12px]">{c.title}</span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            onClick={(e) => e.stopPropagation()}
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity shrink-0"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={(e) => {
            e.stopPropagation();
            setRenamingId(c.id);
            setRenameValue(c.title);
          }}>
            <Pencil className="h-3 w-3 mr-2" /> Renombrar
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput className="h-3 w-3 mr-2" /> Mover a carpeta
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {c.folder && (
                <DropdownMenuItem onClick={() => handleMoveToFolder(c.id, null)}>
                  <FolderOpen className="h-3 w-3 mr-2" /> Sin carpeta
                </DropdownMenuItem>
              )}
              {folders.filter(f => f !== c.folder).map(f => (
                <DropdownMenuItem key={f} onClick={() => handleMoveToFolder(c.id, f)}>
                  <Folder className="h-3 w-3 mr-2" /> {f}
                </DropdownMenuItem>
              ))}
              {FOLDER_PRESETS.filter(f => !folders.includes(f) && f !== c.folder).map(f => (
                <DropdownMenuItem key={f} onClick={() => handleMoveToFolder(c.id, f)}>
                  <FolderPlus className="h-3 w-3 mr-2 text-muted-foreground" /> {f}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
          >
            <Trash2 className="h-3 w-3 mr-2" /> Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );

  return (
    <AppLayout>
      <div className="flex h-[calc(100vh-4rem)] -mt-2">
        {/* Conversation sidebar */}
        {showSidebar && (
          <div className="w-64 shrink-0 border-r border-border/40 flex flex-col bg-secondary/10">
            <div className="p-3 flex items-center justify-between border-b border-border/30">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Conversaciones
              </span>
              <div className="flex items-center gap-0.5">
                <Button size="sm" variant="ghost" onClick={() => setShowNewFolder(true)} className="h-7 w-7 p-0" title="Nueva carpeta">
                  <FolderPlus className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={startNewChat} className="h-7 w-7 p-0" title="Nueva conversación">
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {showNewFolder && (
              <div className="px-3 py-2 border-b border-border/30 flex gap-1.5">
                <Input
                  placeholder="Nombre de carpeta..."
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") setShowNewFolder(false); }}
                  className="h-7 text-xs"
                  autoFocus
                />
                <Button size="sm" variant="default" className="h-7 w-7 p-0 shrink-0" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {conversations.length === 0 ? (
                <div className="text-center py-8 px-3">
                  <FolderOpen className="h-8 w-8 text-muted-foreground/30 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">Sin conversaciones</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    Organiza tus chats en carpetas por proyecto o tema
                  </p>
                </div>
              ) : (
                <>
                  {/* Folders */}
                  {folders.map(folder => (
                    <div key={folder}>
                      <button
                        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/40 transition-colors"
                        onClick={() => toggleFolder(folder)}
                      >
                        {expandedFolders.has(folder) ? (
                          <ChevronDown className="h-3 w-3 shrink-0" />
                        ) : (
                          <ChevronRight className="h-3 w-3 shrink-0" />
                        )}
                        <Folder className="h-3 w-3 shrink-0" />
                        <span className="truncate flex-1 text-left">{folder}</span>
                        <span className="text-[10px] text-muted-foreground/60">{groupedConversations[folder]?.length}</span>
                      </button>
                      {expandedFolders.has(folder) && (
                        <div className="ml-3 pl-2 border-l border-border/30 space-y-0.5 mt-0.5">
                          {groupedConversations[folder]?.map(renderConversation)}
                        </div>
                      )}
                    </div>
                  ))}

                  {/* Ungrouped conversations */}
                  {groupedConversations["__none__"]?.length > 0 && (
                    <div>
                      {folders.length > 0 && (
                        <button
                          className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary/40 transition-colors"
                          onClick={() => toggleFolder("__none__")}
                        >
                          {expandedFolders.has("__none__") ? (
                            <ChevronDown className="h-3 w-3 shrink-0" />
                          ) : (
                            <ChevronRight className="h-3 w-3 shrink-0" />
                          )}
                          <MessageSquare className="h-3 w-3 shrink-0" />
                          <span className="truncate flex-1 text-left">General</span>
                          <span className="text-[10px] text-muted-foreground/60">{groupedConversations["__none__"]?.length}</span>
                        </button>
                      )}
                      {(expandedFolders.has("__none__") || folders.length === 0) && (
                        <div className={folders.length > 0 ? "ml-3 pl-2 border-l border-border/30 space-y-0.5 mt-0.5" : "space-y-0.5"}>
                          {groupedConversations["__none__"]?.map(renderConversation)}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Main chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowSidebar(!showSidebar)}
              className="h-7 w-7 p-0"
            >
              {showSidebar ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
            </Button>
            <Sparkles className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold text-foreground">Kawiil AI</h1>
            <span className="text-[10px] text-muted-foreground bg-primary/10 px-2 py-0.5 rounded-full">
              Asistente interno
            </span>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-6">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full max-w-lg mx-auto">
                <div className="rounded-2xl bg-primary/5 p-4 mb-6">
                  <Sparkles className="h-8 w-8 text-primary" />
                </div>
                <h2 className="text-lg font-semibold text-foreground mb-1">¿En qué te puedo ayudar?</h2>
                <p className="text-sm text-muted-foreground text-center mb-6">
                  Puedo ayudarte con redacción de correos, documentos, consultas fiscales y priorización de tareas.
                </p>
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
                    💡 Tip: Organiza tus conversaciones en carpetas por proyecto o tema para consultar fácilmente
                  </p>
                </div>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto space-y-6">
                {messages.map((msg, i) => (
                  <div key={i} className={cn("flex gap-3", msg.role === "user" ? "justify-end" : "justify-start")}>
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
                          : "bg-secondary/40"
                      )}
                    >
                      {msg.role === "assistant" ? (
                        <div className="prose prose-sm max-w-none text-foreground [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_code]:text-xs [&_code]:bg-secondary/60 [&_code]:px-1 [&_code]:rounded">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      )}
                    </div>
                  </div>
                ))}
                {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
                  <div className="flex gap-3">
                    <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
                    </div>
                    <div className="rounded-2xl bg-secondary/40 px-4 py-3">
                      <div className="flex gap-1">
                        <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "0ms" }} />
                        <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "150ms" }} />
                        <div className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border/30 px-4 py-3">
            <div className="max-w-3xl mx-auto flex gap-2 items-end">
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={handleTextareaChange}
                onKeyDown={handleKeyDown}
                placeholder="Escribe tu mensaje..."
                className="resize-none min-h-[42px] max-h-[150px] text-sm bg-secondary/30 border-0 rounded-xl"
                rows={1}
                disabled={isStreaming}
              />
              <Button
                size="sm"
                onClick={handleSend}
                disabled={!input.trim() || isStreaming}
                className="h-[42px] w-[42px] rounded-xl shrink-0"
              >
                {isStreaming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center mt-2">
              Kawiil AI puede cometer errores. Verifica la información importante.
            </p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
};

export default AsistenteIA;
