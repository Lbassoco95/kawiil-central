import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sparkles, Loader2, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import { toDateStringMX } from "@/lib/dateUtils";
import { useAiModuleBriefing, sha256Hex } from "@/hooks/useAiModuleBriefing";

interface DailyBriefingProps {
  tasksCount: number;
  completedToday: number;
  overdueCount: number;
  remindersCount: number;
  /** "compact" reduces padding/typography for use inside hero grids */
  variant?: "default" | "compact";
  /** Hide the wrapper section header (when used inside another card with own eyebrow) */
  hideHeader?: boolean;
}

/**
 * Briefing IA del día (módulo `dashboard`). Usa `ai_module_briefings` en Supabase
 * en lugar de `localStorage`: invalidación por payload_hash y compartible entre
 * dispositivos del mismo usuario.
 */
export function DailyBriefing({
  tasksCount,
  completedToday,
  overdueCount,
  remindersCount,
  variant = "default",
  hideHeader = false,
}: DailyBriefingProps) {
  const { user } = useAuth();
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

  const ready = !!user && !!taskDetails;
  const firstName = profile?.full_name?.split(" ")[0] || "Kawiiler";
  const todayStr = today.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const payload = useMemo(() => {
    const taskIds = (taskDetails ?? []).map((t, i) => `${i}:${t.title}:${t.due_date ?? ""}:${t.status}:${t.priority}`);
    const teamIds = (teamDeadlines ?? []).map((t, i) => `${i}:${t.title}:${t.due_date ?? ""}:${t.priority}`);
    return {
      v: 1,
      module: "dashboard",
      date: todayKey,
      counts: { tasksCount, completedToday, overdueCount, remindersCount },
      tasks: taskIds,
      team: teamIds,
    };
  }, [taskDetails, teamDeadlines, todayKey, tasksCount, completedToday, overdueCount, remindersCount]);

  const [payloadHash, setPayloadHash] = useState<string>("");
  useEffect(() => {
    if (!ready) return;
    void sha256Hex(JSON.stringify(payload)).then(setPayloadHash);
  }, [payload, ready]);

  const briefing = useAiModuleBriefing({
    module: "dashboard",
    payloadHash,
    enabled: ready && !!payloadHash,
    buildMessages: () => {
      const contextPrompt = `Genera un briefing corto y motivador del día para ${firstName}. Hoy es ${todayStr}.

DATOS: ${tasksCount} pendientes, ${completedToday} completadas hoy, ${overdueCount} vencidas, ${remindersCount} recordatorios.

TAREAS: ${JSON.stringify((taskDetails ?? []).map((t) => ({ titulo: t.title, prioridad: t.priority, vence: t.due_date, area: t.area, cliente: (t as unknown as { clients?: { name?: string } }).clients?.name ?? null, estado: t.status })))}

DEADLINES EQUIPO (3 días): ${JSON.stringify((teamDeadlines ?? []).map((t) => ({ titulo: t.title, prioridad: t.priority, vence: t.due_date })))}

INSTRUCCIONES:
1. Resume en máximo 3 puntos clave con emojis.
2. Si hay vencidas, menciona con empatía.
3. Si completó, reconoce.
4. Máximo 80 palabras. Sé ultra-conciso.
5. Markdown obligatorio: línea de título con emoji (ej. 🗒️ **Briefing del …**), subtítulo **Situación actual**, viñetas con emojis (🔥 ⚠️ ✅), **negritas** en cifras y alertas. Sin saludo largo.`;
      return [{ role: "user", content: contextPrompt }];
    },
  });

  const isCompact = variant === "compact";
  const loading = briefing.isLoading || briefing.isRefreshing;
  const content = briefing.content;
  const error = briefing.error;

  return (
    <section>
      {!hideHeader && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors w-full text-left"
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span>Briefing del día</span>
          {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground ml-1" />}
        </button>
      )}

      {(hideHeader || expanded) && (
        <div className={hideHeader ? "" : "mt-3 pl-7"}>
          {loading && !content && (
            <p className={isCompact ? "text-xs text-muted-foreground" : "text-sm text-muted-foreground"}>
              Generando...
            </p>
          )}

          {error && !content && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 space-y-2">
              <p className="text-sm text-destructive">
                No se pudo generar el briefing. Intenta de nuevo.
              </p>
              <button
                type="button"
                onClick={() => void briefing.regenerate()}
                className="text-xs font-medium text-primary hover:underline"
              >
                Reintentar
              </button>
            </div>
          )}

          {content && <KawiilAiMarkdown>{content}</KawiilAiMarkdown>}

          {content && (
            <button
              onClick={() => void briefing.regenerate()}
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
