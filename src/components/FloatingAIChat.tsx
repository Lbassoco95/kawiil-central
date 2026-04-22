import { useState, useRef, useEffect, Fragment, useCallback } from "react";
import { useChat } from "@/hooks/useChat";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sparkles, Send, Loader2, X, Minus, Plus, FileText } from "lucide-react";
import { ChatAttachmentPicker, ChatAttachmentChips } from "@/components/ai/ChatAttachmentPicker";
import { ChatProcessingPanel } from "@/components/ai/ChatProcessingPanel";
import { AiAssistantWelcome } from "@/components/ai/AiAssistantWelcome";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { chatLimits } from "@/lib/fileIntake/limits";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLocation } from "react-router-dom";
import {
  DuplicateFileResolutionDialog,
  type DuplicateResolutionChoice,
} from "@/components/shared/DuplicateFileResolutionDialog";
import { useResolveDuplicateFilenames } from "@/hooks/useResolveDuplicateFilenames";
import { renderTextWithMentionHighlights } from "@/lib/renderMentionHighlights";

export function FloatingAIChat() {
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [input, setInput] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dupChatOpen, setDupChatOpen] = useState(false);
  const [dupChatName, setDupChatName] = useState("");
  const dupChatResolver = useRef<((c: DuplicateResolutionChoice) => void) | null>(null);

  const chatDuplicatePrompt = useCallback((fileName: string) => {
    setDupChatName(fileName);
    setDupChatOpen(true);
    return new Promise<DuplicateResolutionChoice>((resolve) => {
      dupChatResolver.current = resolve;
    });
  }, []);

  const onDupChatResolve = useCallback((c: DuplicateResolutionChoice) => {
    setDupChatOpen(false);
    dupChatResolver.current?.(c);
    dupChatResolver.current = null;
  }, []);

  const resolveChatDuplicateFilenames = useResolveDuplicateFilenames(chatDuplicatePrompt);

  const handlePendingFilesChange = useCallback(
    async (next: File[]) => {
      const resolved = await resolveChatDuplicateFilenames(next);
      setPendingFiles(resolved);
    },
    [resolveChatDuplicateFilenames]
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const location = useLocation();
  const isMobile = useIsMobile();

  const {
    messages,
    isStreaming,
    streamProgressSteps,
    pdfIndexingStatus,
    sendMessage,
    startNewChat,
  } = useChat();

  const isAssistantPage = location.pathname === "/asistente";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open && !minimized) {
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [open, minimized]);

  // Don't show on the full AI assistant page
  if (isAssistantPage) return null;

  const handleSend = () => {
    if ((!input.trim() && pendingFiles.length === 0) || isStreaming) return;
    sendMessage(input.trim(), { files: pendingFiles });
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
    ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
  };

  // FAB button
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={cn(
          "fixed right-4 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center group sm:right-6",
          isMobile ? "bottom-[calc(env(safe-area-inset-bottom)+4.5rem)]" : "bottom-6",
        )}
        title="Kawiil AI"
      >
        <Sparkles className="h-6 w-6 group-hover:rotate-12 transition-transform" />
        {messages.length > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center font-bold">
            {messages.filter(m => m.role === "assistant").length}
          </span>
        )}
      </button>
    );
  }

  // Minimized bar
  if (minimized) {
    return (
      <div
        className={cn(
          "fixed right-4 z-50 bg-card border border-border rounded-2xl shadow-xl px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:shadow-2xl transition-shadow sm:right-6",
          isMobile ? "bottom-[calc(env(safe-area-inset-bottom)+4.5rem)]" : "bottom-6",
        )}
        onClick={() => setMinimized(false)}
      >
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground">Kawiil AI</span>
        {(isStreaming || pdfIndexingStatus) && (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
        )}
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0 ml-1" onClick={(e) => { e.stopPropagation(); setOpen(false); setMinimized(false); }}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  // Full chat panel
  return (
    <>
    <FileDropzone
      files={pendingFiles}
      onChange={handlePendingFilesChange}
      limits={chatLimits}
      disabled={isStreaming}
      variant="overlay"
      showChips={false}
      enablePaste={false}
      hint="Suelta archivos para adjuntar"
      enableFolderPicker
      className={cn(
        "fixed z-50 bg-card border border-border shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200",
        isMobile
          ? "inset-x-2 top-2 bottom-[calc(env(safe-area-inset-bottom)+4rem)] rounded-2xl"
          : "bottom-6 right-6 w-[380px] h-[520px] rounded-2xl",
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40 bg-secondary/20">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold text-foreground flex-1">Kawiil AI</span>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={startNewChat} title="Nueva conversación">
          <Plus className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setMinimized(true)} title="Minimizar">
          <Minus className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => { setOpen(false); setMinimized(false); }} title="Cerrar">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <AiAssistantWelcome
            onSendPrompt={(prompt) => {
              if (isStreaming) return;
              sendMessage(prompt);
            }}
          />
        ) : (
          <div className="px-3 py-3">
            <div className="space-y-3">
            {messages.map((msg, i) => {
              const showProgressBeforeAssistant =
                isStreaming &&
                msg.role === "assistant" &&
                i === messages.length - 1 &&
                streamProgressSteps.length > 0;
              return (
                <Fragment key={msg.id || `fm-${i}`}>
                  {showProgressBeforeAssistant && (
                    <div className="flex gap-2 justify-start">
                      <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Loader2 className="h-3 w-3 text-primary animate-spin" />
                      </div>
                      <ChatProcessingPanel steps={streamProgressSteps} className="flex-1 min-w-0 text-[11px]" />
                    </div>
                  )}
                  <div
                    className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}
                  >
                    {msg.role === "assistant" && (
                      <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <Sparkles className="h-3 w-3 text-primary" />
                      </div>
                    )}
                    <div
                      className={cn(
                        "rounded-xl px-3 py-2 max-w-[85%] text-[13px]",
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : msg.isError
                            ? "bg-destructive/10 border border-destructive/25"
                            : "bg-secondary/40"
                      )}
                    >
                      {msg.role === "assistant" ? (
                        <div
                          className={cn(
                            "prose prose-sm max-w-none [&_p]:my-0.5 [&_ul]:my-0.5 [&_ol]:my-0.5 [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_code]:text-xs [&_code]:bg-secondary/60 [&_code]:px-1 [&_code]:rounded text-[13px]",
                            msg.isError
                              ? "text-destructive prose-headings:text-destructive"
                              : "text-foreground"
                          )}
                        >
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="whitespace-pre-wrap">
                            {renderTextWithMentionHighlights(msg.content, `fc-${msg.id || `i-${i}`}`, {
                              mentionClassName:
                                "font-bold text-primary-foreground underline decoration-primary-foreground/70 underline-offset-2",
                            })}
                          </p>
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-0.5">
                              {msg.attachments.map((a, idx) => (
                                <span
                                  key={idx}
                                  className="inline-flex items-center gap-0.5 text-[9px] bg-primary-foreground/15 rounded px-1"
                                >
                                  <FileText className="h-2.5 w-2.5" />
                                  <span className="truncate max-w-[100px]">{a.name}</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {msg.role === "assistant" &&
                        msg.activityLog &&
                        msg.activityLog.length > 0 && (
                          <details className="mt-2 text-[9px] text-muted-foreground border-t border-border/30 pt-1.5">
                            <summary className="cursor-pointer select-none">Pasos</summary>
                            <ol className="mt-1 list-decimal pl-3 space-y-0.5">
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
                <div className="flex gap-2 justify-start">
                  <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <Loader2 className="h-3 w-3 text-primary animate-spin" />
                  </div>
                  <ChatProcessingPanel steps={streamProgressSteps} className="flex-1 min-w-0" />
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="h-6 w-6 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                    <Loader2 className="h-3 w-3 text-primary animate-spin" />
                  </div>
                  <div className="rounded-xl bg-secondary/40 px-3 py-2">
                    <div className="flex gap-1">
                      <div
                        className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
                        style={{ animationDelay: "0ms" }}
                      />
                      <div
                        className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
                        style={{ animationDelay: "150ms" }}
                      />
                      <div
                        className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
                        style={{ animationDelay: "300ms" }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            <div ref={messagesEndRef} />
            </div>
          </div>
        )}
      </div>

      {pdfIndexingStatus && (
        <div className="shrink-0 border-t border-primary/15 bg-primary/5 px-3 py-1.5">
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
            <span className="min-w-0 truncate">
              {pdfIndexingStatus.phase === "extracting"
                ? `Leyendo «${pdfIndexingStatus.fileName}»…`
                : (() => {
                    const s = pdfIndexingStatus;
                    const frag =
                      s.lastBatchChunks != null && s.lastBatchChunks > 0
                        ? ` · +${s.lastBatchChunks} frag.`
                        : "";
                    return `«${s.fileName}» ${s.pageDone}/${s.totalPages}${frag}`;
                  })()}
            </span>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="border-t border-border/40 px-3 py-2.5 bg-secondary/10 flex flex-col gap-2">
        <ChatAttachmentChips
          files={pendingFiles}
          disabled={isStreaming}
          onRemove={(i) => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
          className="max-h-24"
        />
        <div className="flex gap-1.5 items-end">
          <ChatAttachmentPicker
            files={pendingFiles}
            onChange={handlePendingFilesChange}
            disabled={isStreaming}
            showChips={false}
            className="shrink-0"
          />
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            placeholder="Mensaje o archivos…"
            className="resize-none min-h-[64px] max-h-[120px] text-[13px] bg-background border-border/50 rounded-xl py-2 flex-1 min-w-0"
            rows={2}
            disabled={isStreaming}
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={(!input.trim() && pendingFiles.length === 0) || isStreaming}
            className="h-[36px] w-[36px] rounded-xl shrink-0"
          >
            {isStreaming ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>
    </FileDropzone>
    <DuplicateFileResolutionDialog
      open={dupChatOpen}
      fileName={dupChatName}
      onResolve={onDupChatResolve}
    />
    </>
  );
}
