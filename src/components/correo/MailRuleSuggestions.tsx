import { useMemo, useState, useCallback } from "react";
import { Sparkles, X, ArrowRight } from "lucide-react";
import { useListMailRules } from "@/hooks/useMicrosoft";

const DISMISS_KEY = "kawiil-mail-rule-suggestions-dismissed";
const MIN_COUNT = 4; // a partir de cuántos correos del mismo remitente sugerir una regla

function readDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) || "[]")); } catch { return new Set(); }
}
function writeDismissed(s: Set<string>) {
  try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...s])); } catch { /* ignore */ }
}

interface Props {
  /** Correos actualmente cargados (para detectar remitentes frecuentes). */
  emails: Record<string, unknown>[];
  /** Abre el diálogo de crear regla prellenado con ese remitente. */
  onCreateRule: (senderEmail: string, senderName: string) => void;
}

/**
 * Propone reglas aprendiendo de los patrones: si llegan muchos correos del mismo
 * remitente y no hay una regla para él, sugiere crearla (estilo Spark/Superhuman).
 */
export function MailRuleSuggestions({ emails, onCreateRule }: Props) {
  const { data: rules = [] } = useListMailRules();
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());

  const ruledSenders = useMemo(
    () => new Set(rules.map((r) => (r.sender_email || "").toLowerCase())),
    [rules],
  );

  const suggestion = useMemo(() => {
    const counts = new Map<string, { count: number; name: string }>();
    for (const e of emails) {
      const from = (e.from as { emailAddress?: { address?: string; name?: string } } | undefined)?.emailAddress;
      const addr = (from?.address || "").toLowerCase();
      if (!addr) continue;
      const prev = counts.get(addr) || { count: 0, name: from?.name || addr };
      counts.set(addr, { count: prev.count + 1, name: prev.name });
    }
    // El remitente más frecuente que supere el umbral, sin regla y sin haber sido descartado.
    let best: { addr: string; name: string; count: number } | null = null;
    for (const [addr, { count, name }] of counts) {
      if (count < MIN_COUNT || ruledSenders.has(addr) || dismissed.has(addr)) continue;
      if (!best || count > best.count) best = { addr, name, count };
    }
    return best;
  }, [emails, ruledSenders, dismissed]);

  const dismiss = useCallback((addr: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(addr);
      writeDismissed(next);
      return next;
    });
  }, []);

  if (!suggestion) return null;

  return (
    <div className="flex items-center gap-2.5 px-3 py-2 mx-3 my-2 rounded-lg border border-primary/20 bg-primary/5 shrink-0">
      <Sparkles className="w-4 h-4 text-primary shrink-0" />
      <p className="text-[12px] text-foreground flex-1 min-w-0">
        Recibes <span className="font-semibold">{suggestion.count}</span> correos de{" "}
        <span className="font-semibold truncate">{suggestion.name}</span>.{" "}
        <span className="text-muted-foreground">¿Crear una regla para moverlos solos?</span>
      </p>
      <button
        onClick={() => { onCreateRule(suggestion.addr, suggestion.name); dismiss(suggestion.addr); }}
        className="h-7 flex items-center gap-1 px-2.5 rounded-md bg-primary text-primary-foreground text-[11.5px] font-semibold hover:bg-primary/90 transition-colors shrink-0"
      >
        Crear regla <ArrowRight className="w-3 h-3" />
      </button>
      <button
        onClick={() => dismiss(suggestion.addr)}
        title="Ignorar sugerencia"
        className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
