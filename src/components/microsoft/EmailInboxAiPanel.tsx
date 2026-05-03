import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  X,
  Loader2,
  RefreshCw,
  AlertTriangle,
  ListChecks,
  Inbox,
  CalendarClock,
  Clock,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import { fetchAiChatSimpleContent } from "@/lib/fetchAiChatSimple";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Category = "needs_reply" | "action" | "fyi" | "scheduling" | "waiting";

interface EmailRow {
  id: string;
  subject?: string | null;
  bodyPreview?: string | null;
  from?: { emailAddress?: { name?: string; address?: string } } | null;
  isRead?: boolean | null;
  receivedDateTime?: string | null;
  toRecipients?: Array<{ emailAddress?: { address?: string } }> | null;
  ccRecipients?: Array<{ emailAddress?: { address?: string } }> | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  emails: EmailRow[];
  onOpenEmail: (email: EmailRow) => void;
  selfAddress?: string | null;
  folderLabel?: string;
}

interface ClassifiedItem {
  id: string;
  reason?: string;
}

interface ClassifyResult {
  summary?: string;
  categories: Partial<Record<Category, ClassifiedItem[]>>;
}

const MAX_TO_CLASSIFY = 30;
const PREVIEW_LEN = 220;

const META: Record<Category, { label: string; icon: typeof Inbox; tone: string; ring: string; bg: string; text: string }> = {
  needs_reply: {
    label: "Necesita respuesta",
    icon: AlertTriangle,
    tone: "destructive",
    ring: "border-destructive/30",
    bg: "bg-destructive/5",
    text: "text-destructive",
  },
  action: {
    label: "Acción",
    icon: ListChecks,
    tone: "warning",
    ring: "border-amber-500/30",
    bg: "bg-amber-500/5",
    text: "text-amber-600",
  },
  scheduling: {
    label: "Agenda",
    icon: CalendarClock,
    tone: "primary",
    ring: "border-primary/30",
    bg: "bg-primary/5",
    text: "text-primary",
  },
  waiting: {
    label: "Esperando",
    icon: Clock,
    tone: "muted",
    ring: "border-border/60",
    bg: "bg-background/60",
    text: "text-muted-foreground",
  },
  fyi: {
    label: "Para conocimiento",
    icon: Inbox,
    tone: "emerald",
    ring: "border-emerald-500/25",
    bg: "bg-emerald-500/5",
    text: "text-emerald-600",
  },
};

const CATEGORY_ORDER: Category[] = ["needs_reply", "action", "scheduling", "waiting", "fyi"];

function senderLabel(e: EmailRow): string {
  return (
    e.from?.emailAddress?.name ||
    e.from?.emailAddress?.address ||
    "Sin remitente"
  );
}

function clipPreview(s?: string | null): string {
  if (!s) return "";
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > PREVIEW_LEN ? `${t.slice(0, PREVIEW_LEN)}…` : t;
}

function buildClassificationPrompt(
  rows: EmailRow[],
  selfAddress: string | null | undefined,
): string {
  const lines: string[] = [];
  lines.push("Eres el triage de bandeja de Kawiil. Clasifica los siguientes correos en una de estas categorías:");
  lines.push("- needs_reply: requiere una respuesta directa del usuario y aún no la dio.");
  lines.push("- action: pide hacer algo concreto (no solo responder).");
  lines.push("- scheduling: invitaciones, propuestas de fecha, reagendamientos.");
  lines.push("- waiting: el usuario espera respuesta de alguien o un envío externo.");
  lines.push("- fyi: solo informativo, lista, newsletter o copia (CC).");
  lines.push("");
  if (selfAddress) {
    lines.push(`El usuario es: ${selfAddress}`);
  }
  lines.push("");
  lines.push("Devuelve SOLO un JSON válido con esta forma EXACTA, sin texto adicional:");
  lines.push(
    `{ "summary": "1-2 frases sobre el estado general del inbox", "categories": { "needs_reply": [{"id":"...", "reason":"..."}], "action": [], "scheduling": [], "waiting": [], "fyi": [] } }`,
  );
  lines.push("Cada item debe llevar el id del correo y un `reason` muy breve (≤ 80 caracteres) en español.");
  lines.push("Ningún correo debe aparecer en más de una categoría. Sé estricto: si dudas, usa `fyi`.");
  lines.push("");
  lines.push("Correos:");
  for (const e of rows) {
    const isCc = !!e.ccRecipients?.some((r) => r.emailAddress?.address?.toLowerCase() === selfAddress?.toLowerCase());
    const tag = isCc ? " [CC]" : "";
    lines.push(
      `- id=${e.id}${tag} | de=${senderLabel(e)} | leido=${e.isRead ? "si" : "no"} | asunto="${(e.subject || "(sin asunto)").slice(0, 120)}" | resumen="${clipPreview(e.bodyPreview)}"`,
    );
  }
  return lines.join("\n");
}

function parseClassification(raw: string): ClassifyResult | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const json = raw.slice(start, end + 1);
    const parsed = JSON.parse(json) as ClassifyResult;
    if (!parsed?.categories) return null;
    return parsed;
  } catch {
    return null;
  }
}

function hashIds(ids: string[]): string {
  let h = 0;
  for (const id of ids) {
    for (let i = 0; i < id.length; i++) {
      h = (h * 31 + id.charCodeAt(i)) | 0;
    }
  }
  return String(h >>> 0);
}

export function EmailInboxAiPanel({
  open,
  onClose,
  emails,
  onOpenEmail,
  selfAddress,
  folderLabel,
}: Props) {
  const subset = useMemo(() => emails.slice(0, MAX_TO_CLASSIFY), [emails]);
  const cacheKey = useMemo(() => {
    const ids = subset.map((e) => e.id);
    return `kawiil-email-triage-${hashIds(ids)}-${ids.length}`;
  }, [subset]);

  const [result, setResult] = useState<ClassifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailById = useMemo(() => {
    const map = new Map<string, EmailRow>();
    for (const e of emails) map.set(e.id, e);
    return map;
  }, [emails]);

  const generate = useCallback(
    async (force = false) => {
      if (subset.length === 0) {
        setResult(null);
        return;
      }
      if (!force) {
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            setResult(JSON.parse(cached) as ClassifyResult);
            return;
          }
        } catch {
          /* ignore */
        }
      }
      setLoading(true);
      setError(null);
      try {
        const prompt = buildClassificationPrompt(subset, selfAddress);
        const raw = await fetchAiChatSimpleContent([
          {
            role: "system",
            content:
              "Eres un clasificador estricto de correos. Respondes EXCLUSIVAMENTE con JSON válido siguiendo el esquema indicado. Sin markdown, sin texto previo ni posterior.",
          },
          { role: "user", content: prompt },
        ]);
        const parsed = parseClassification(raw);
        if (!parsed) {
          throw new Error("La IA devolvió un formato no esperado.");
        }
        setResult(parsed);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(parsed));
        } catch {
          /* ignore */
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "No se pudo clasificar el inbox");
      } finally {
        setLoading(false);
      }
    },
    [subset, cacheKey, selfAddress],
  );

  /** Al abrir el panel o cambiar la vista: solo hidratar desde caché local. La IA no se llama hasta que el usuario pulse «Analizar». */
  useEffect(() => {
    if (!open) return;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        setResult(JSON.parse(cached) as ClassifyResult);
        setError(null);
        return;
      }
    } catch {
      /* ignore */
    }
    setResult(null);
  }, [open, cacheKey]);

  if (!open) return null;

  const sectionsToRender = CATEGORY_ORDER.map((cat) => {
    const items = (result?.categories?.[cat] ?? []).filter((it) => emailById.has(it.id));
    return { cat, items };
  }).filter((s) => s.items.length > 0);

  return (
    <aside
      className={cn(
        "shrink-0 flex flex-col border-l bg-card",
        "w-full sm:w-[380px] lg:w-[400px] min-w-0",
      )}
      style={{ borderColor: "hsl(var(--border))" }}
    >
      <div className="shrink-0 flex items-center justify-between border-b border-border/70 px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-tight text-foreground leading-tight">
              Triaje IA del inbox
            </p>
            <p className="text-[10.5px] text-muted-foreground truncate leading-tight">
              {folderLabel ? `${folderLabel} · ` : ""}
              {result
                ? `Triaje de ${subset.length} correo${subset.length === 1 ? "" : "s"}`
                : `Hasta ${subset.length} correo${subset.length === 1 ? "" : "s"} en vista (IA bajo demanda)`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => void generate(true)}
            title="Regenerar clasificación"
            disabled={loading || subset.length === 0 || !result}
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Cerrar triaje IA">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-5">
          {/* Resumen del inbox */}
          {result?.summary ? (
            <section>
              <h3 className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-primary mb-2">
                <Sparkles className="h-3 w-3" />
                Resumen
              </h3>
              <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-sm leading-relaxed">
                <KawiilAiMarkdown className="text-sm leading-relaxed">
                  {result.summary}
                </KawiilAiMarkdown>
              </div>
            </section>
          ) : null}

          {/* Estado de carga / error / vacío */}
          {error ? (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
              {error}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-2 h-7 text-[11px]"
                onClick={() => void generate(true)}
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                Reintentar
              </Button>
            </div>
          ) : null}

          {!result && loading ? (
            <p className="text-xs text-muted-foreground inline-flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Analizando los últimos {subset.length} correos…
            </p>
          ) : null}

          {!result && !loading && !error && subset.length > 0 ? (
            <div className="rounded-xl border border-border/60 bg-muted/20 px-3 py-3 space-y-2">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Clasifica hasta {subset.length} correos visibles y genera un resumen corto del estado del inbox. Solo se
                usa IA cuando pulsas el botón (o si ya existe un triaje guardado en este equipo).
              </p>
              <Button
                type="button"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => void generate(false)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Analizar bandeja con IA
              </Button>
            </div>
          ) : null}

          {!result && !loading && subset.length === 0 ? (
            <p className="text-xs text-muted-foreground">No hay correos visibles para clasificar.</p>
          ) : null}

          {/* Secciones por categoría */}
          {sectionsToRender.length === 0 && result ? (
            <p className="text-xs text-muted-foreground">
              La IA no detectó correos accionables en esta vista.
            </p>
          ) : null}

          {sectionsToRender.map(({ cat, items }) => {
            const meta = META[cat];
            const Icon = meta.icon;
            return (
              <section key={cat}>
                <h3
                  className={cn(
                    "inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] mb-2",
                    meta.text,
                  )}
                >
                  <Icon className="h-3 w-3" />
                  {meta.label}
                  <span className="ml-1 rounded-full bg-foreground/5 px-1.5 py-0.5 text-[9.5px] font-semibold text-muted-foreground">
                    {items.length}
                  </span>
                </h3>
                <div className="space-y-2">
                  {items.slice(0, 6).map((it) => {
                    const e = emailById.get(it.id)!;
                    return (
                      <button
                        key={it.id}
                        type="button"
                        onClick={() => {
                          onOpenEmail(e);
                          toast.success("Abriendo correo");
                        }}
                        className={cn(
                          "block w-full text-left rounded-xl border px-3 py-2 transition-colors",
                          meta.ring,
                          meta.bg,
                          "hover:bg-accent/40",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="text-[11px] font-semibold text-foreground/90 truncate">
                            {senderLabel(e)}
                          </span>
                          {!e.isRead ? (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="No leído" />
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-xs font-medium text-foreground line-clamp-1">
                          {e.subject || "(sin asunto)"}
                        </p>
                        {it.reason ? (
                          <p className={cn("mt-1 text-[11px] line-clamp-2", meta.text)}>
                            {it.reason}
                          </p>
                        ) : null}
                        <span className="mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-semibold text-muted-foreground hover:text-foreground">
                          Abrir <ArrowRight className="h-3 w-3" />
                        </span>
                      </button>
                    );
                  })}
                  {items.length > 6 ? (
                    <p className="text-[10.5px] text-muted-foreground pl-1">
                      +{items.length - 6} más en esta categoría
                    </p>
                  ) : null}
                </div>
              </section>
            );
          })}

          <p className="pt-1 text-[10.5px] text-muted-foreground">
            La clasificación se guarda en este navegador; usa actualizar tras mover o leer correos (vuelve a consumir IA).
          </p>
        </div>
      </ScrollArea>
    </aside>
  );
}
