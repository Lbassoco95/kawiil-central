import { useState, useRef, useEffect } from "react";
import { AppLayout } from "@/components/AppLayout";
import { useChat } from "@/hooks/useChat";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  Send,
  Trash2,
  MessageSquare,
  Sparkles,
  Loader2,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

const SUGGESTIONS = [
  "¿Cuáles son mis tareas pendientes más urgentes?",
  "Crea recordatorios para mis tareas que vencen esta semana",
  "¿Cómo está la carga de trabajo del equipo?",
  "Redacta un correo profesional para un cliente sobre su declaración",
];

const AsistenteIA = () => {
  const {
    messages,
    isStreaming,
    conversations,
    activeConversationId,
    sendMessage,
    loadConversation,
    startNewChat,
    deleteConversation,
  } = useChat();

  const [input, setInput] = useState("");
  const [showSidebar, setShowSidebar] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (isMobile) setShowSidebar(false);
  }, [isMobile]);

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
              <Button size="sm" variant="ghost" onClick={startNewChat} className="h-7 w-7 p-0">
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {conversations.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3 text-center">Sin conversaciones</p>
              ) : (
                conversations.map((c) => (
                  <div
                    key={c.id}
                    className={cn(
                      "group flex items-center gap-2 rounded-lg px-3 py-2 text-sm cursor-pointer transition-colors",
                      activeConversationId === c.id
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                    )}
                    onClick={() => loadConversation(c.id)}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate flex-1 text-[13px]">{c.title}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))
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
              OpenAI
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
