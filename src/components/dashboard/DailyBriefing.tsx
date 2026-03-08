import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Loader2, RefreshCw, AlertTriangle, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";
import { nowMX } from "@/lib/dateUtils";

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
  const [error, setError] = useState<string | null>(null);
  const [showDelayForm, setShowDelayForm] = useState(false);
  const [delayReason, setDelayReason] = useState("");
  const [delayTaskTitle, setDelayTaskTitle] = useState("");
  const today = useMemo(() => nowMX(), []);

  // Fetch detailed task data for the AI
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

  // Fetch upcoming deadlines for entire org (team visibility)
  const { data: teamDeadlines } = useQuery({
    queryKey: ["briefing-team-deadlines"],
    queryFn: async () => {
      const futureDate = new Date(today.getTime() + 3 * 86400000);
      const { data, error } = await supabase
        .from("tasks")
        .select("title, priority, due_date, assigned_to")
        .in("status", ["pendiente", "en_progreso"])
        .gte("due_date", today.toISOString().split("T")[0])
        .lte("due_date", futureDate.toISOString().split("T")[0])
        .order("due_date", { ascending: true })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Fetch profile for name
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
    setError(null);

    const firstName = profile?.full_name?.split(" ")[0] || "Kawiiler";
    const todayStr = today.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });

    const contextPrompt = `Genera un briefing corto y motivador del día para ${firstName}. Hoy es ${todayStr}.

DATOS DEL DÍA:
- Tareas pendientes: ${tasksCount}
- Completadas hoy: ${completedToday}
- Tareas vencidas: ${overdueCount}
- Recordatorios activos: ${remindersCount}

DETALLE DE TAREAS:
${JSON.stringify(taskDetails?.map(t => ({
  titulo: t.title,
  prioridad: t.priority,
  vence: t.due_date,
  area: t.area,
  cliente: (t as any).clients?.name || null,
  estado: t.status,
})) || [], null, 2)}

DEADLINES DEL EQUIPO (próximos 3 días):
${JSON.stringify(teamDeadlines?.map(t => ({
  titulo: t.title,
  prioridad: t.priority,
  vence: t.due_date,
})) || [], null, 2)}

INSTRUCCIONES:
1. Saluda por nombre con calidez.
2. Resume las prioridades del día en máximo 3-4 puntos con emojis.
3. Si hay tareas vencidas, menciónalas con empatía y sugiere acción (no regañes).
4. Si completó tareas, reconócelo.
5. Da una frase motivadora corta al final.
6. Máximo 150 palabras. Usa markdown. Sé conciso.`;

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
        // Cache it for today
        try {
          localStorage.setItem(
            `kawiil-briefing-${user.id}`,
            JSON.stringify({ date: today.toISOString().split("T")[0], content: fullContent })
          );
        } catch {}
      }
    } catch (e: any) {
      console.error("Briefing error:", e);
      setError(e.message || "Error al generar el briefing");
    } finally {
      setLoading(false);
    }
  };

  // Load cached briefing or generate new one
  useEffect(() => {
    if (!user || !taskDetails) return;
    try {
      const cached = localStorage.getItem(`kawiil-briefing-${user.id}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.date === today.toISOString().split("T")[0]) {
          setBriefing(parsed.content);
          return;
        }
      }
    } catch {}
    // Auto-generate on first load of the day
    generateBriefing();
  }, [user?.id, taskDetails !== undefined]);

  const handleReportDelay = () => {
    if (!delayReason.trim()) return;
    toast.success(`Reporte registrado: ${delayTaskTitle || "tarea"} — ${delayReason}`);
    // In the future this could log to activity_log or send a Slack notification
    setShowDelayForm(false);
    setDelayReason("");
    setDelayTaskTitle("");
  };

  return (
    <section className="rounded-2xl bg-gradient-to-br from-primary/5 via-secondary/20 to-accent/5 border border-primary/10 p-6 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />

      <div className="flex items-center justify-between mb-4 relative">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Tu briefing del día</h2>
            <p className="text-[11px] text-muted-foreground">Generado por Kawiil AI</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1"
          onClick={generateBriefing}
          disabled={loading}
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Actualizar
        </Button>
      </div>

      {loading && !briefing && (
        <div className="flex items-center gap-3 py-8 justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          <span className="text-sm text-muted-foreground">Preparando tu resumen del día...</span>
        </div>
      )}

      {error && !briefing && (
        <div className="flex items-center gap-2 py-4 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span>{error}</span>
        </div>
      )}

      {briefing && (
        <div className="prose prose-sm max-w-none text-foreground [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-xs text-[13px] leading-relaxed relative">
          <ReactMarkdown>{briefing}</ReactMarkdown>
        </div>
      )}

      {/* Overdue alert with delay reporting */}
      {overdueCount > 0 && briefing && (
        <div className="mt-4 pt-4 border-t border-border/30">
          {!showDelayForm ? (
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5 border-warning/30 text-warning hover:bg-warning/5"
              onClick={() => setShowDelayForm(true)}
            >
              <MessageSquare className="h-3 w-3" />
              Reportar un atraso
            </Button>
          ) : (
            <div className="space-y-2 animate-in fade-in duration-200">
              <p className="text-xs text-muted-foreground">¿Qué tarea se atrasó y por qué? Esto nos ayuda a mejorar como equipo.</p>
              <input
                placeholder="Nombre de la tarea..."
                className="w-full h-8 px-3 text-xs bg-background border border-border/50 rounded-lg"
                value={delayTaskTitle}
                onChange={(e) => setDelayTaskTitle(e.target.value)}
              />
              <Textarea
                placeholder="Motivo del atraso..."
                className="text-xs min-h-[60px] bg-background border-border/50"
                value={delayReason}
                onChange={(e) => setDelayReason(e.target.value)}
              />
              <div className="flex gap-2">
                <Button size="sm" className="text-xs h-7" onClick={handleReportDelay} disabled={!delayReason.trim()}>
                  Enviar reporte
                </Button>
                <Button size="sm" variant="ghost" className="text-xs h-7" onClick={() => setShowDelayForm(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
