import { useState, useCallback } from "react";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import ReactMarkdown from "react-markdown";

interface Props {
  /** Unique cache key suffix, e.g. "team-dashboard" or "project-abc123" */
  cacheKey: string;
  /** The context prompt that describes the data for the AI */
  contextPrompt: string;
  /** Title shown on the card */
  title?: string;
  /** Whether required data is loaded */
  ready: boolean;
  /** User id for caching */
  userId?: string;
  /** Accent color class */
  accentClass?: string;
}

export function AISummaryCard({
  cacheKey,
  contextPrompt,
  title = "Resumen Kawiil AI",
  ready,
  userId,
  accentClass = "text-primary",
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

  const generate = useCallback(async () => {
    if (!ready) return;
    setLoading(true);
    setError(null);

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
    <div className="rounded-xl bg-gradient-to-br from-primary/5 to-accent/5 border border-primary/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className={`h-4 w-4 ${accentClass}`} />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={generate}
          disabled={loading || !ready}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <RefreshCw className="h-3 w-3 mr-1" />
              {content ? "Actualizar" : "Generar"}
            </>
          )}
        </Button>
      </div>

      {error && (
        <p className="text-xs text-destructive mb-2">{error}</p>
      )}

      {content ? (
        <div className="prose prose-sm dark:prose-invert max-w-none text-[13px] leading-relaxed">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      ) : !loading ? (
        <p className="text-xs text-muted-foreground">
          Haz clic en "Generar" para obtener un resumen inteligente basado en los datos actuales.
        </p>
      ) : (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-4">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Kawiil AI está analizando los datos...
        </div>
      )}
    </div>
  );
}
