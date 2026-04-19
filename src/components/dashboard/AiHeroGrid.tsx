import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProfile, getFirstName, getGreeting } from "@/hooks/useCurrentProfile";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import { DailyBriefing } from "@/components/dashboard/DailyBriefing";
import { MoodCheckin } from "@/components/dashboard/MoodCheckin";
import { Sparkles, Quote, RotateCw, CalendarPlus, BarChart3, Ban } from "lucide-react";
import { cn } from "@/lib/utils";

interface AiHeroGridProps {
  tasksCount: number;
  completedToday: number;
  overdueCount: number;
  remindersCount: number;
  userCelula: string | null;
  className?: string;
}

const PHRASE_FALLBACK =
  "La mejor manera de predecir el futuro es creándolo.\n— Peter Drucker, Managing for Results";

function splitPhrase(raw: string): { quote: string; author: string | null } {
  if (!raw) return { quote: PHRASE_FALLBACK, author: null };
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && /^[—-]/.test(lines[lines.length - 1])) {
    const author = lines[lines.length - 1].replace(/^[—-]\s*/, "");
    const quote = lines.slice(0, -1).join(" ").replace(/^["“]|["”]$/g, "");
    return { quote, author };
  }
  return { quote: raw, author: null };
}

export function AiHeroGrid({
  tasksCount,
  completedToday,
  overdueCount,
  remindersCount,
  userCelula,
  className,
}: AiHeroGridProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: profile } = useCurrentProfile();
  const today = useMexicoToday();

  const firstName = getFirstName(profile, user?.email);
  const greeting = getGreeting();
  const eyebrow = `Briefing · ${today
    .toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "short" })
    .replace(/\./g, "")}`;

  const phraseQuery = useQuery({
    queryKey: ["ai-hero-phrase", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-phrase", {
        body: { time_of_day: "morning" },
      });
      if (error) throw error;
      const payload = data as { phrase?: string } | null;
      return payload?.phrase || PHRASE_FALLBACK;
    },
    enabled: !!user,
    staleTime: 8 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const regeneratePhrase = useCallback(async () => {
    if (!user) return;
    await supabase.functions.invoke("generate-phrase", {
      body: { time_of_day: "morning", force_regenerate: true },
    });
    await phraseQuery.refetch();
  }, [user, phraseQuery]);

  const goToAssistant = useCallback(
    (prompt: string) => {
      navigate(`/asistente?prompt=${encodeURIComponent(prompt)}`);
    },
    [navigate],
  );

  const phrase = splitPhrase(phraseQuery.data || PHRASE_FALLBACK);

  return (
    <div className={cn("kw-ai-hero-grid", className)}>
      {/* Briefing card */}
      <div className="kw-ai-card kw-ai-brief">
        <div className="kw-ai-eyebrow">
          <Sparkles className="h-3 w-3" />
          <span className="capitalize">{eyebrow}</span>
        </div>
        <div className="kw-ai-greet">
          {greeting}, {firstName} <span className="kw-ai-wave">👋</span>
        </div>
        <div className="kw-ai-brief-body">
          <DailyBriefing
            tasksCount={tasksCount}
            completedToday={completedToday}
            overdueCount={overdueCount}
            remindersCount={remindersCount}
            variant="compact"
            hideHeader
          />
        </div>
        <div className="kw-ai-chips">
          <button
            type="button"
            className="kw-ai-chip"
            onClick={() =>
              goToAssistant(
                "Arma mi día con base en mis tareas pendientes, vencimientos y prioridades. Sugiere bloques de tiempo realistas.",
              )
            }
          >
            <CalendarPlus className="h-3 w-3" />
            Arma mi día
          </button>
          <button
            type="button"
            className="kw-ai-chip"
            onClick={() =>
              goToAssistant(
                "Dame un resumen de cómo voy esta semana: avances, tareas completadas, pendientes críticos y proyectos en riesgo.",
              )
            }
          >
            <BarChart3 className="h-3 w-3" />
            Resumen semana
          </button>
          <button
            type="button"
            className="kw-ai-chip"
            onClick={() =>
              goToAssistant(
                "¿Qué tareas o proyectos tengo bloqueados o en espera de terceros? Dame una lista priorizada con próximas acciones.",
              )
            }
          >
            <Ban className="h-3 w-3" />
            ¿Qué me bloquea?
          </button>
        </div>
      </div>

      {/* Right column */}
      <div className="kw-ai-right">
        <div className="kw-ai-card kw-ai-quote">
          <div className="kw-ai-eyebrow kw-ai-eyebrow-accent">
            <Quote className="h-3 w-3" />
            <span>Tu frase de hoy</span>
          </div>
          <blockquote className="kw-ai-quote-text">
            «{phrase.quote.replace(/^[«"]|[»"]$/g, "").trim()}»
          </blockquote>
          <div className="kw-ai-quote-foot">
            <span className="truncate">{phrase.author ? `— ${phrase.author}` : "Curada para ti"}</span>
            <button
              type="button"
              onClick={regeneratePhrase}
              disabled={phraseQuery.isFetching}
              className="kw-ai-quote-refresh"
              aria-label="Otra frase"
              title="Otra frase"
            >
              <RotateCw className={cn("h-3 w-3", phraseQuery.isFetching && "animate-spin")} />
            </button>
          </div>
        </div>

        <div className="kw-ai-mood">
          <MoodCheckin userCelula={userCelula} />
        </div>
      </div>
    </div>
  );
}
