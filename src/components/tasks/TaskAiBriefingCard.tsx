import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, RefreshCw, Loader2, AlertCircle } from "lucide-react";
import { KAWIIL_AI_GRADIENT, KAWIIL_AI_SOFT_BG } from "@/lib/kawiilAi";
import { fetchAiChatSimpleContent, type AiChatSimpleMessage } from "@/lib/fetchAiChatSimple";
import { formatMX, isPastDueCalendarMX } from "@/lib/dateUtils";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";
import { useTaskDependencies } from "@/hooks/useTaskDependencies";
import { AiFeedback } from "@/components/ai/AiFeedback";
import { aiFeedbackKey } from "@/lib/aiFeedbackKey";
import { toast } from "sonner";

interface SubtaskLike {
  id: string;
  title?: string | null;
  status: string;
}

interface Props {
  task: {
    id: string;
    title: string;
    description?: string | null;
    status: string;
    priority: string;
    due_date: string | null;
    estimated_hours?: number | null;
    time_spent_seconds?: number | null;
    area?: string | null;
  };
  subtasks: SubtaskLike[];
  clientName?: string | null;
  projectName?: string | null;
  assigneeName?: string | null;
}

type BriefingSections = {
  resumen: string;
  proximos: string[];
  riesgos: string[];
};

type CachedBriefing = {
  hash: string;
  sections: BriefingSections;
  generatedAt: string;
};

const CACHE_PREFIX = "kawiil.taskAiBriefing.";

function buildPayloadSignature(
  task: Props["task"],
  subtasks: SubtaskLike[],
  blockingOpen: number,
): string {
  return JSON.stringify({
    id: task.id,
    t: (task.title || "").trim(),
    d: (task.description || "").trim().slice(0, 500),
    s: task.status,
    p: task.priority,
    due: task.due_date,
    est: task.estimated_hours ?? null,
    spent: Math.round((task.time_spent_seconds ?? 0) / 60),
    subs: subtasks.map((x) => `${x.status}:${(x.title || "").trim().slice(0, 40)}`),
    blk: blockingOpen,
  });
}

function readCache(taskId: string): CachedBriefing | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(CACHE_PREFIX + taskId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedBriefing;
    if (!parsed?.sections || !parsed?.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(taskId: string, value: CachedBriefing) {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(CACHE_PREFIX + taskId, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function parseBriefing(raw: string): BriefingSections {
  const sections: BriefingSections = { resumen: "", proximos: [], riesgos: [] };
  if (!raw) return sections;
  const text = raw.replace(/\r/g, "");

  const resumenMatch = text.match(/resumen[\s:]*([\s\S]*?)(?=\n\s*(?:pr[óo]ximos|riesgos|$))/i);
  if (resumenMatch) {
    sections.resumen = resumenMatch[1]
      .trim()
      .replace(/^[-*•]\s*/gm, "")
      .replace(/^\*\*|\*\*$/g, "")
      .trim();
  }

  const proximosMatch = text.match(/pr[óo]ximos[^\n]*\n([\s\S]*?)(?=\n\s*(?:riesgos|$))/i);
  if (proximosMatch) {
    sections.proximos = proximosMatch[1]
      .split("\n")
      .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 5);
  }

  const riesgosMatch = text.match(/riesgos[^\n]*\n([\s\S]*)/i);
  if (riesgosMatch) {
    sections.riesgos = riesgosMatch[1]
      .split("\n")
      .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 5);
  }

  if (!sections.resumen && !sections.proximos.length && !sections.riesgos.length) {
    sections.resumen = text.trim();
  }
  return sections;
}

/**
 * Briefing generado por LLM (ai-chat simple) para una tarea:
 * resumen, próximos pasos y riesgos. Caché por sesión en sessionStorage
 * con invalidación por hash del payload relevante (no gasta tokens mientras
 * nada crítico cambie en la tarea).
 */
export function TaskAiBriefingCard({
  task,
  subtasks,
  clientName,
  projectName,
  assigneeName,
}: Props) {
  const { dependsOn } = useTaskDependencies(task.id);
  const blockingOpen = dependsOn.filter(
    (d) => d.related_task && !isTaskClosedStatus(d.related_task.status),
  ).length;

  const payloadSignature = useMemo(
    () => buildPayloadSignature(task, subtasks, blockingOpen),
    [task, subtasks, blockingOpen],
  );

  const [sections, setSections] = useState<BriefingSections | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cachedHash, setCachedHash] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  useEffect(() => {
    const cached = readCache(task.id);
    if (cached) {
      setSections(cached.sections);
      setCachedHash(cached.hash);
      setGeneratedAt(cached.generatedAt);
    } else {
      setSections(null);
      setCachedHash(null);
      setGeneratedAt(null);
    }
  }, [task.id]);

  const stale = !!sections && cachedHash !== payloadSignature;

  const buildMessages = useCallback((): AiChatSimpleMessage[] => {
    const subtaskLines = subtasks
      .slice(0, 20)
      .map((s) => `- ${(s.title || "(sin título)").slice(0, 80)} — ${isTaskClosedStatus(s.status) ? "✔" : "○"}`)
      .join("\n");

    const overdue = task.due_date && isPastDueCalendarMX(task.due_date);
    const dueLabel = task.due_date
      ? `${formatMX(task.due_date, "dd MMM yyyy")}${overdue ? " (VENCIDA)" : ""}`
      : "sin fecha";
    const estLabel = task.estimated_hours ? `${task.estimated_hours}h estimadas` : "sin estimación";
    const spentLabel = task.time_spent_seconds
      ? `${(task.time_spent_seconds / 3600).toFixed(1)}h registradas`
      : "sin tiempo registrado";

    const system: AiChatSimpleMessage = {
      role: "system",
      content:
        "Eres Kawiil IA, asistente interno de un despacho contable, legal y de cumplimiento en México. " +
        "Hablas en español formal, conciso y accionable. Nunca inventes datos, apóyate solo en lo dado. " +
        "Responde SIEMPRE con este formato exacto, sin saludos ni cierres ni prefacios:\n" +
        "Resumen: <1-2 oraciones con el estado real de la tarea>\n" +
        "Próximos pasos:\n- <paso 1, empieza con verbo en infinitivo>\n- <paso 2>\n- <paso 3>\n" +
        "Riesgos:\n- <riesgo o alerta concreta con impacto>\n- <otro si aplica>",
    };

    const user: AiChatSimpleMessage = {
      role: "user",
      content:
        `Analiza esta tarea y genera el briefing:\n\n` +
        `Título: ${task.title}\n` +
        `Estado: ${task.status} · Prioridad: ${task.priority} · Célula: ${task.area || "—"}\n` +
        `Vencimiento: ${dueLabel}\n` +
        `Responsable: ${assigneeName || "sin asignar"}\n` +
        (clientName ? `Cliente: ${clientName}\n` : "") +
        (projectName ? `Proyecto: ${projectName}\n` : "") +
        `Tiempo: ${estLabel} · ${spentLabel}\n` +
        (task.description ? `\nDescripción:\n${task.description.slice(0, 800)}\n` : "") +
        (subtaskLines ? `\nSubtareas:\n${subtaskLines}\n` : "") +
        (blockingOpen > 0
          ? `\nDependencias bloqueantes abiertas: ${blockingOpen}\n`
          : ""),
    };

    return [system, user];
  }, [task, subtasks, blockingOpen, assigneeName, clientName, projectName]);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await fetchAiChatSimpleContent(buildMessages());
      const parsed = parseBriefing(raw);
      const now = new Date().toISOString();
      setSections(parsed);
      setCachedHash(payloadSignature);
      setGeneratedAt(now);
      writeCache(task.id, {
        hash: payloadSignature,
        sections: parsed,
        generatedAt: now,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "No se pudo generar el briefing";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, [buildMessages, payloadSignature, task.id]);

  return (
    <div
      className="rounded-xl border border-sky-200/60 dark:border-sky-500/30 overflow-hidden"
      style={{ background: KAWIIL_AI_SOFT_BG }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sky-200/60 dark:border-sky-500/30">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-md text-white"
          style={{ background: KAWIIL_AI_GRADIENT }}
        >
          <Sparkles className="h-3 w-3" />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700 dark:text-sky-300">
          Briefing IA
        </span>
        <span className="ml-auto flex items-center gap-2">
          {generatedAt && (
            <span className="text-[9px] font-medium text-sky-700/70 dark:text-sky-300/70">
              {formatMX(generatedAt, "dd MMM HH:mm")}
            </span>
          )}
          {sections && (
            <button
              type="button"
              onClick={generate}
              disabled={loading}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-sky-700 dark:text-sky-200 hover:underline disabled:opacity-50"
              title="Regenerar briefing"
            >
              {loading ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <RefreshCw className="h-2.5 w-2.5" />
              )}
              {stale ? "Actualizar" : "Regenerar"}
            </button>
          )}
        </span>
      </div>

      <div className="px-3 py-2.5 space-y-2.5">
        {!sections && !loading && !error && (
          <div className="space-y-2">
            <p className="text-[12px] leading-snug text-foreground/70">
              Genera un resumen inteligente con próximos pasos y riesgos para esta tarea.
            </p>
            <button
              type="button"
              onClick={generate}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-sky-300/60 bg-white/80 dark:bg-white/10 px-2.5 py-1.5 text-[11px] font-medium text-sky-700 dark:text-sky-200 hover:bg-white"
            >
              <Sparkles className="h-3 w-3" /> Generar briefing
            </button>
          </div>
        )}

        {loading && !sections && (
          <div className="flex items-center gap-2 text-[12px] text-sky-700 dark:text-sky-300">
            <Loader2 className="h-3 w-3 animate-spin" />
            Analizando tarea...
          </div>
        )}

        {error && !loading && (
          <div className="flex items-start gap-1.5 text-[11px] text-red-600 dark:text-red-400">
            <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {sections && (
          <>
            {stale && (
              <p className="text-[10px] text-amber-700 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-500/10 rounded px-2 py-1 border border-amber-200/60 dark:border-amber-500/30">
                La tarea cambió desde el último briefing.
              </p>
            )}

            {sections.resumen && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700/80 dark:text-sky-300/80 mb-1">
                  Resumen
                </p>
                <p className="text-[12px] leading-snug text-foreground/90">
                  {sections.resumen}
                </p>
              </div>
            )}

            {sections.proximos.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sky-700/80 dark:text-sky-300/80 mb-1">
                  Próximos pasos
                </p>
                <ul className="space-y-0.5 text-[12px] leading-snug text-foreground/90 list-disc pl-4">
                  {sections.proximos.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              </div>
            )}

            {sections.riesgos.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-amber-700 dark:text-amber-400 mb-1">
                  Riesgos
                </p>
                <ul className="space-y-0.5 text-[12px] leading-snug text-foreground/90 list-disc pl-4">
                  {sections.riesgos.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-1 flex justify-end">
              <AiFeedback surface="task_briefing" contextKey={aiFeedbackKey(task.id)} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
