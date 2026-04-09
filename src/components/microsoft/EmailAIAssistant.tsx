import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Copy, X, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`;

const FULL_PROMPTS = [
  { label: "Respuesta profesional", prompt: "Redacta una respuesta profesional y cordial a este correo." },
  { label: "Respuesta breve", prompt: "Redacta una respuesta breve y directa a este correo." },
  { label: "Tono formal", prompt: "Redacta una respuesta con tono muy formal y corporativo a este correo." },
];

const DRAFT_SNIPPET_MAX = 4000;
const MAX_API_MESSAGES = 17;

type ApiMsg = { role: "user" | "assistant"; content: string };
type CompletedTurn = { user: string; assistant: string };

interface Props {
  mode: "quick" | "full";
  emailSubject: string;
  emailBody: string;
  senderName?: string;
  /** Hilo completo (texto plano); si existe, sustituye el contexto de un solo mensaje. */
  threadContext?: string;
  /** HTML del borrador actual; se envía como referencia en el último mensaje de usuario. */
  draftHtml?: string;
  /** Al cambiar (p. ej. draftId), se reinicia la conversación. */
  conversationKey?: string;
  onInsertText?: (text: string) => void;
  /** Sustituye el HTML del borrador por la propuesta (texto plano/markdown de la IA). */
  onReplaceDraft?: (text: string) => void;
  /** Si true, pide confirmación antes de reemplazar (borrador no vacío). */
  hasDraftText?: boolean;
  onClose?: () => void;
  /** For quick mode: auto-execute this prompt on mount */
  autoPrompt?: string;
  /** Tras la primera respuesta del asistente, anteponer la sugerencia al borrador. */
  insertIntoDraftOnComplete?: boolean;
}

function extractSseDataText(parsed: Record<string, unknown>): string | null {
  if (parsed.type === "kawiil_progress") return null;
  if (typeof parsed.text === "string" && parsed.text.length > 0) return parsed.text;
  const choices = parsed.choices as Array<{ delta?: { content?: string } }> | undefined;
  const chunk = choices?.[0]?.delta?.content;
  if (typeof chunk === "string" && chunk.length > 0) return chunk;
  return null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function trimApiMessages(m: ApiMsg[]): ApiMsg[] {
  if (m.length <= MAX_API_MESSAGES) return m;
  const head = m[0];
  return [head, ...m.slice(-(MAX_API_MESSAGES - 1))];
}

function buildApiMessages(
  anchor: string,
  completedTurns: CompletedTurn[],
  nextUser: string,
  draftPlain: string,
): ApiMsg[] {
  const draftLine =
    draftPlain.trim().length > 0
      ? `\n\n[Borrador actual del usuario para referencia (texto plano)]\n${draftPlain.slice(0, DRAFT_SNIPPET_MAX)}`
      : "";

  const out: ApiMsg[] = [];
  if (completedTurns.length === 0) {
    out.push({
      role: "user",
      content: `Contexto del correo:\n${anchor}\n\nInstrucción: ${nextUser}${draftLine}`,
    });
    return trimApiMessages(out);
  }

  out.push({
    role: "user",
    content: `Contexto del correo:\n${anchor}\n\nInstrucción: ${completedTurns[0].user}`,
  });
  out.push({ role: "assistant", content: completedTurns[0].assistant });
  for (let i = 1; i < completedTurns.length; i++) {
    const t = completedTurns[i];
    out.push({ role: "user", content: t.user });
    out.push({ role: "assistant", content: t.assistant });
  }
  out.push({ role: "user", content: `${nextUser}${draftLine}` });
  return trimApiMessages(out);
}

export function EmailAIAssistant({
  mode,
  emailSubject,
  emailBody,
  senderName,
  threadContext,
  draftHtml = "",
  conversationKey,
  onInsertText,
  onReplaceDraft,
  hasDraftText = false,
  onClose,
  autoPrompt,
  insertIntoDraftOnComplete = false,
}: Props) {
  const [prompt, setPrompt] = useState("");
  /** Turnos ya completados (usuario + asistente). */
  const [completedTurns, setCompletedTurns] = useState<CompletedTurn[]>([]);
  /** Texto del asistente en curso (streaming). */
  const [streamingAssistant, setStreamingAssistant] = useState("");
  const [loading, setLoading] = useState(false);

  const anchor = useMemo(() => {
    const context = threadContext?.trim()
      ? `Asunto del hilo: ${emailSubject}\nRemitente del mensaje abierto: ${senderName || "Desconocido"}\n\n${threadContext.trim()}`
      : `Asunto: ${emailSubject}\nDe: ${senderName || "Desconocido"}\n\nContenido del correo:\n${stripHtml(emailBody).substring(0, 3000)}`;
    return context;
  }, [emailSubject, emailBody, senderName, threadContext]);

  const systemPromptClient = useMemo(() => {
    const systemBase =
      "Eres un asistente de correo electrónico profesional. Ayudas a redactar respuestas, resumir hilos y traducir correos. Responde de forma concisa y profesional en el idioma que te pidan. Puedes hacer preguntas de aclaración cuando ayude a mejorar el borrador.";
    const systemThread = threadContext?.trim()
      ? " Cuando se incluye una conversación completa, basa tu respuesta en todo el hilo y en el mensaje marcado como «RESPONDER A ESTE»."
      : "";
    return `${systemBase}${systemThread}`;
  }, [threadContext]);

  const draftPlain = useMemo(() => stripHtml(draftHtml || ""), [draftHtml]);

  useEffect(() => {
    setCompletedTurns([]);
    setPrompt("");
    setStreamingAssistant("");
  }, [conversationKey]);

  const lastAssistantText = useMemo(() => {
    if (streamingAssistant) return streamingAssistant;
    const last = completedTurns[completedTurns.length - 1];
    return last?.assistant ?? "";
  }, [completedTurns, streamingAssistant]);

  const runChatRequest = useCallback(
    async (messages: ApiMsg[], opts: { isFirstExchange: boolean; userDisplayText: string }) => {
      const { supabase } = await import("@/integrations/supabase/client");
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("No session");

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          messages,
          systemPrompt: systemPromptClient,
        }),
      });

      if (!resp.ok) throw new Error(`Error ${resp.status}`);

      let accumulated = "";

      if (resp.headers.get("content-type")?.includes("text/event-stream")) {
        const reader = resp.body?.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;
              const piece = extractSseDataText(parsed);
              if (piece) {
                accumulated += piece;
                setStreamingAssistant(accumulated);
              }
            } catch {
              /* línea incompleta o no JSON */
            }
          }
        }
        if (sseBuffer.trim().startsWith("data: ")) {
          const data = sseBuffer.trim().slice(6).trim();
          if (data && data !== "[DONE]") {
            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;
              const piece = extractSseDataText(parsed);
              if (piece) {
                accumulated += piece;
                setStreamingAssistant(accumulated);
              }
            } catch {
              /* ignore */
            }
          }
        }
      } else {
        const data = (await resp.json()) as Record<string, unknown>;
        if (data.error && typeof data.error === "string") {
          throw new Error(data.error);
        }
        const text =
          (typeof data.content === "string" && data.content) ||
          (typeof data.reply === "string" && data.reply) ||
          (typeof data.text === "string" && data.text) ||
          (typeof data.message === "string" && data.message) ||
          "";
        accumulated = text || JSON.stringify(data);
        setStreamingAssistant(accumulated);
      }

      setCompletedTurns((prev) => [...prev, { user: opts.userDisplayText, assistant: accumulated }]);
      setStreamingAssistant("");

      if (insertIntoDraftOnComplete && opts.isFirstExchange && onInsertText && accumulated.trim()) {
        onInsertText(accumulated);
        toast.success("Sugerencia añadida al cuerpo del correo");
      }
    },
    [insertIntoDraftOnComplete, onInsertText, systemPromptClient],
  );

  const sendPrompt = async (text: string) => {
    if (!text.trim() || loading) return;
    setLoading(true);
    setStreamingAssistant("");

    const isFirstExchange = completedTurns.length === 0;
    const messages = buildApiMessages(anchor, completedTurns, text.trim(), draftPlain);

    try {
      await runChatRequest(messages, { isFirstExchange, userDisplayText: text.trim() });
      setPrompt("");
    } catch (err) {
      console.error("AI assistant error:", err);
      toast.error(err instanceof Error ? err.message : "Error al consultar el asistente");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!lastAssistantText) return;
    navigator.clipboard.writeText(lastAssistantText);
    toast.success("Copiado al portapapeles");
  };

  const handleInsert = () => {
    if (onInsertText && lastAssistantText) {
      onInsertText(lastAssistantText);
      toast.success("Texto añadido al borrador");
    }
  };

  const handleReplaceDraft = () => {
    if (!onReplaceDraft || !lastAssistantText) return;
    if (hasDraftText && typeof window !== "undefined") {
      const ok = window.confirm(
        "¿Reemplazar todo el contenido del borrador por la propuesta de la IA? Se perderá el texto actual del cuerpo.",
      );
      if (!ok) return;
    }
    onReplaceDraft(lastAssistantText);
    toast.success("Borrador reemplazado");
  };

  const resetConversation = () => {
    setCompletedTurns([]);
    setPrompt("");
    setStreamingAssistant("");
  };

  // Quick mode: una sola consulta (sin hilo persistente)
  const [quickResponse, setQuickResponse] = useState("");
  const sendQuickPrompt = async (text: string) => {
    if (!text.trim() || loading) return;
    setLoading(true);
    setQuickResponse("");
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error("No session");

      const context = threadContext?.trim()
        ? `Asunto del hilo: ${emailSubject}\nRemitente del mensaje abierto: ${senderName || "Desconocido"}\n\n${threadContext.trim()}`
        : `Asunto: ${emailSubject}\nDe: ${senderName || "Desconocido"}\n\nContenido del correo:\n${stripHtml(emailBody).substring(0, 3000)}`;

      const systemBase =
        "Eres un asistente de correo electrónico profesional. Ayudas a redactar respuestas, resumir hilos y traducir correos. Responde de forma concisa y profesional en el idioma que te pidan.";
      const systemThread = threadContext?.trim()
        ? " Cuando se incluye una conversación completa, basa tu respuesta en todo el hilo y en el mensaje marcado como «RESPONDER A ESTE»."
        : "";

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: `Contexto del correo:\n${context}\n\nInstrucción: ${text}` }],
          systemPrompt: `${systemBase}${systemThread}`,
        }),
      });

      if (!resp.ok) throw new Error(`Error ${resp.status}`);

      let accumulated = "";

      if (resp.headers.get("content-type")?.includes("text/event-stream")) {
        const reader = resp.body?.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = "";
        while (reader) {
          const { done, value } = await reader.read();
          if (done) break;
          sseBuffer += decoder.decode(value, { stream: true });
          const lines = sseBuffer.split("\n");
          sseBuffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;
              const piece = extractSseDataText(parsed);
              if (piece) {
                accumulated += piece;
                setQuickResponse(accumulated);
              }
            } catch {
              /* ignore */
            }
          }
        }
        if (sseBuffer.trim().startsWith("data: ")) {
          const data = sseBuffer.trim().slice(6).trim();
          if (data && data !== "[DONE]") {
            try {
              const parsed = JSON.parse(data) as Record<string, unknown>;
              const piece = extractSseDataText(parsed);
              if (piece) {
                accumulated += piece;
                setQuickResponse(accumulated);
              }
            } catch {
              /* ignore */
            }
          }
        }
      } else {
        const data = (await resp.json()) as Record<string, unknown>;
        if (data.error && typeof data.error === "string") throw new Error(data.error);
        const t =
          (typeof data.content === "string" && data.content) ||
          (typeof data.reply === "string" && data.reply) ||
          (typeof data.text === "string" && data.text) ||
          (typeof data.message === "string" && data.message) ||
          "";
        accumulated = t || JSON.stringify(data);
        setQuickResponse(accumulated);
      }
    } catch (err) {
      console.error("AI assistant error:", err);
      toast.error(err instanceof Error ? err.message : "Error al consultar el asistente");
    } finally {
      setLoading(false);
    }
  };

  if (mode === "quick") {
    return (
      <div className="border border-border rounded-lg p-3 bg-muted/30 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Kawiil AI
          </div>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onClose}>
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
        {loading && !quickResponse && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Procesando...
          </div>
        )}
        {quickResponse && (
          <div>
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
              <ReactMarkdown>{quickResponse}</ReactMarkdown>
            </div>
            <div className="flex gap-2 mt-2 pt-2 border-t border-border">
              <Button variant="outline" size="sm" className="text-xs h-6" onClick={() => navigator.clipboard.writeText(quickResponse)}>
                <Copy className="mr-1 h-3 w-3" /> Copiar
              </Button>
            </div>
          </div>
        )}
        {!quickResponse && !loading && autoPrompt && (
          <Button variant="outline" size="sm" className="text-xs" onClick={() => sendQuickPrompt(autoPrompt)}>
            Ejecutar
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg p-3 bg-muted/30 space-y-3 flex flex-col min-h-0 max-h-[min(50vh,420px)]">
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-primary" />
          Asistente Kawiil AI
        </div>
        <div className="flex items-center gap-1">
          {completedTurns.length > 0 && (
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={resetConversation}>
              <RotateCcw className="h-3 w-3" />
              Nuevo tema
            </Button>
          )}
          {onClose && (
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 shrink-0">
        {FULL_PROMPTS.map((qp) => (
          <Button
            key={qp.label}
            variant="outline"
            size="sm"
            className="text-xs h-7"
            onClick={() => {
              setPrompt(qp.prompt);
              void sendPrompt(qp.prompt);
            }}
            disabled={loading}
          >
            {qp.label}
          </Button>
        ))}
      </div>

      <ScrollArea className="flex-1 min-h-[120px] rounded-md border border-border bg-background/50">
        <div className="p-2 space-y-3">
          {completedTurns.map((turn, i) => (
            <div key={i} className="space-y-2">
              <div className="flex justify-end">
                <div
                  className={cn(
                    "rounded-lg px-3 py-2 text-xs max-w-[92%] bg-primary/15 text-foreground",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{turn.user}</p>
                </div>
              </div>
              <div className="flex justify-start">
                <div className="rounded-lg px-3 py-2 text-xs max-w-[92%] bg-muted border border-border">
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown>{turn.assistant}</ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {loading && streamingAssistant && (
            <div className="flex justify-start">
              <div className="rounded-lg px-3 py-2 text-xs max-w-[92%] bg-muted border border-border border-dashed">
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown>{streamingAssistant}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}
          {loading && !streamingAssistant && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" /> Generando...
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="flex gap-2 shrink-0">
        <Textarea
          placeholder="Escribe una instrucción o responde a la IA…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          className="text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendPrompt(prompt);
            }
          }}
        />
        <Button size="sm" onClick={() => void sendPrompt(prompt)} disabled={loading || !prompt.trim()} className="shrink-0">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {(lastAssistantText || loading) && (
        <div className="border border-border rounded-md p-2 bg-background shrink-0">
          <p className="text-[10px] text-muted-foreground mb-1.5">Última respuesta del asistente</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="text-xs h-7" onClick={handleCopy} disabled={!lastAssistantText}>
              <Copy className="mr-1 h-3 w-3" /> Copiar
            </Button>
            {onInsertText && (
              <Button size="sm" className="text-xs h-7" onClick={handleInsert} disabled={!lastAssistantText}>
                Añadir al borrador
              </Button>
            )}
            {onReplaceDraft && (
              <Button variant="secondary" size="sm" className="text-xs h-7" onClick={handleReplaceDraft} disabled={!lastAssistantText}>
                Reemplazar borrador
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
