import { useState, useCallback } from "react";
import { Sparkles, Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import ReactMarkdown from "react-markdown";

interface Props {
  cacheKey: string;
  contextPrompt: string;
  title?: string;
  ready: boolean;
  userId?: string;
  accentClass?: string;
}

export function AISummaryCard({
  cacheKey,
  contextPrompt,
  title = "Resumen Kawiil AI",
  ready,
  userId,
}: Props) {
  const [content, setContent] = useState<string | null>(() => {
    try {
      const cached = localStorage.getItem(`kawiil-summary-${cacheKey}`);
      if (cached) {
        const { date, content: c } = JSON.parse(cached);
        const today = new Date().toISOString().split("T")[0];
        if (date === today) return c;
      }
    } catch {}
    return null;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const generate = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);
    setExpanded(true);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: contextPrompt }],
        }),
      });

      if (!resp.ok) {
        if (resp.status === 429) throw new Error("Demasiadas solicitudes. Intenta en unos minutos.");
        if (resp.status === 402) throw new Error("Créditos de IA agotados.");
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `Error ${resp.status}`);
      }

      if (!resp.body) throw new Error("No stream");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;
          try {
            const parsed = JSON.parse(jsonStr);
            const c = parsed.choices?.[0]?.delta?.content;
            if (c) {
              fullContent += c;
              setContent(fullContent);
            }
          } catch {
            break;
          }
        }
      }

      if (fullContent) {
        setContent(fullContent);
        try {
          localStorage.setItem(
            `kawiil-summary-${cacheKey}`,
            JSON.stringify({ date: new Date().toISOString().split("T")[0], content: fullContent })
          );
        } catch {}
      }
    } catch (err: any) {
      setError(err.message || "Error al generar resumen");
    } finally {
      setLoading(false);
    }
  }, [contextPrompt, ready, cacheKey]);

  return (
    <section>
      <div className="flex items-center gap-2">
        <button
          onClick={() => content ? setExpanded(!expanded) : generate()}
          className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>{title}</span>
        </button>
        {content && (
          <button
            onClick={generate}
            disabled={loading || !ready}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 pl-7">
          {error && (
            <p className="text-xs text-destructive mb-2">{error}</p>
          )}

          {content ? (
            <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
              <ReactMarkdown>{content}</ReactMarkdown>
            </div>
          ) : loading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analizando datos...
            </div>
          ) : (
            <button
              onClick={generate}
              disabled={!ready}
              className="text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
            >
              Generar resumen
            </button>
          )}
        </div>
      )}
    </section>
  );
}
