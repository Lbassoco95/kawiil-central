import { useState, useCallback, useEffect, useRef } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface MetricInsightProps {
  metricKey: string;
  contextPrompt: string;
  ready: boolean;
}

export function MetricInsight({ metricKey, contextPrompt, ready }: MetricInsightProps) {
  const [insight, setInsight] = useState<string | null>(() => {
    try {
      const cached = localStorage.getItem(`kawiil-insight-${metricKey}`);
      if (cached) {
        const { date, content } = JSON.parse(cached);
        if (date === new Date().toISOString().split("T")[0]) return content;
      }
    } catch {}
    return null;
  });
  const [loading, setLoading] = useState(false);
  const attempted = useRef(false);

  const generate = useCallback(async () => {
    if (!ready || loading) return;
    setLoading(true);

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

      if (!resp.ok || !resp.body) throw new Error("Error");

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
              setInsight(fullContent);
            }
          } catch { break; }
        }
      }

      if (fullContent) {
        setInsight(fullContent);
        try {
          localStorage.setItem(
            `kawiil-insight-${metricKey}`,
            JSON.stringify({ date: new Date().toISOString().split("T")[0], content: fullContent })
          );
        } catch {}
      }
    } catch {
      // Silent fail for metric insights
    } finally {
      setLoading(false);
    }
  }, [contextPrompt, ready, metricKey, loading]);

  useEffect(() => {
    if (ready && !insight && !loading && !attempted.current) {
      attempted.current = true;
      generate();
    }
  }, [ready, insight]);

  if (!insight && !loading) return null;

  return (
    <div className="flex items-start gap-1.5 mt-1">
      {loading ? (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin shrink-0" />
          <span>Analizando...</span>
        </div>
      ) : insight ? (
        <div className="flex items-start gap-1.5">
          <Sparkles className="h-3 w-3 text-primary shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground leading-relaxed">{insight}</p>
        </div>
      ) : null}
    </div>
  );
}