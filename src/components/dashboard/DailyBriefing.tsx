import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import { toDateStringMX } from "@/lib/dateUtils";

interface DailyBriefingProps {
  tasksCount: number;
  completedToday: number;
  overdueCount: number;
  remindersCount: number;
}

export function DailyBriefing({ tasksCount, completedToday, overdueCount, remindersCount }: DailyBriefingProps) {
  const { user } = useAuth();
  const [briefing, setBriefing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const today = useMexicoToday();
  const todayKey = toDateStringMX(today);

  const { data: taskDetails } = useQuery({
    queryKey: ["briefing-tasks", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("title, status, priority, due_date, area, clients(name)")
        .eq("assigned_to", user!.id)
        .in("status", ["pendiente", "en_progreso", "en_revision"])
        .order("due_date", { ascending: true })
        .limit(15);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: teamDeadlines } = useQuery({
    queryKey: ["briefing-team-deadlines", todayKey],
    queryFn: async () => {
      const futureDate = new Date(today.getTime() + 3 * 86400000);
      const { data, error } = await supabase
        .from("tasks")
        .select("title, priority, due_date, assigned_to")
        .in("status", ["pendiente", "en_progreso"])
        .gte("due_date", todayKey)
        .lte("due_date", futureDate.toISOString().split("T")[0])
        .order("due_date", { ascending: true })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: profile } = useQuery({
    queryKey: ["briefing-profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name, area")
        .eq("user_id", user!.id)
        .single();
      return data;
    },
    enabled: !!user,
  });

  const generateBriefing = async () => {
    if (!user || !taskDetails) return;
    setLoading(true);
    setError(false);

    const firstName = profile?.full_name?.split(" ")[0] || "Kawiiler";
    const todayStr = today.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

    const contextPrompt = `Genera un briefing corto y motivador del día para ${firstName}. Hoy es ${todayStr}.

DATOS: ${tasksCount} pendientes, ${completedToday} completadas hoy, ${overdueCount} vencidas, ${remindersCount} recordatorios.

TAREAS: ${JSON.stringify(taskDetails?.map(t => ({ titulo: t.title, prioridad: t.priority, vence: t.due_date, area: t.area, cliente: (t as any).clients?.name || null, estado: t.status })) || [])}

DEADLINES EQUIPO (3 días): ${JSON.stringify(teamDeadlines?.map(t => ({ titulo: t.title, prioridad: t.priority, vence: t.due_date })) || [])}

INSTRUCCIONES:
1. Resume en máximo 3 puntos clave con emojis.
2. Si hay vencidas, menciona con empatía.
3. Si completó, reconoce.
4. Máximo 80 palabras. Sé ultra-conciso. Markdown. Sin saludo largo.`;

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
        body: JSON.stringify({ messages: [{ role: "user", content: contextPrompt }] }),
      });

      if (!resp.ok) throw new Error(`Error ${resp.status}`);
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
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              fullContent += content;
              setBriefing(fullContent);
            }
          } catch { break; }
        }
      }

      if (fullContent) {
        setBriefing(fullContent);
        try {
          localStorage.setItem(
            `kawiil-briefing-${user.id}`,
            JSON.stringify({ date: todayKey, content: fullContent })
          );
        } catch {}
      }
    } catch (e: any) {
      console.error("Briefing error:", e);
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user || !taskDetails) return;
    try {
      const cached = localStorage.getItem(`kawiil-briefing-${user.id}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.date === todayKey) {
          setBriefing(parsed.content);
          return;
        }
      }
    } catch {}
    generateBriefing();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- regenerar si cambia el día civil
  }, [user?.id, taskDetails !== undefined, todayKey]);

  return (
    <section>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span>Briefing del día</span>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-1" />}
      </button>

      {expanded && (
        <div className="mt-3 pl-7">
          {loading && !briefing && (
            <p className="text-sm text-muted-foreground">Generando...</p>
          )}

          {error && !loading && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 space-y-2">
              <p className="text-sm text-destructive">No se pudo generar el briefing. Intenta de nuevo.</p>
              <button
                type="button"
                onClick={() => generateBriefing()}
                className="text-xs font-medium text-primary hover:underline"
              >
                Reintentar
              </button>
            </div>
          )}

          {briefing && (
            <div className="text-[13px] text-foreground leading-relaxed [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_strong]:font-medium">
              <ReactMarkdown>{briefing}</ReactMarkdown>
            </div>
          )}

          {briefing && (
            <button
              onClick={generateBriefing}
              disabled={loading}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mt-2 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              Regenerar
            </button>
          )}
        </div>
      )}
    </section>
  );
}
