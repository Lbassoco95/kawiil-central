import { Button } from "@/components/ui/button";
import { Check, Circle, CheckCircle2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatMX } from "@/lib/dateUtils";
import { onboardingProgress } from "@/lib/onboarding";
import { useOnboardingItems, useToggleOnboardingItem, useStartOnboarding } from "@/hooks/useOnboarding";

interface Props {
  userId: string;
  /** Muestra el botón "Iniciar bienvenida" cuando aún no hay checklist (solo G4). */
  showStart?: boolean;
}

export function WelcomeChecklist({ userId, showStart }: Props) {
  const { data: items = [], isLoading } = useOnboardingItems(userId);
  const toggle = useToggleOnboardingItem();
  const start = useStartOnboarding();
  const p = onboardingProgress(items);

  if (isLoading) return null;

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-4 text-center">
        <p className="text-sm text-muted-foreground">Aún no hay lista de bienvenida.</p>
        {showStart && (
          <Button size="sm" className="mt-2" onClick={() => start.mutate(userId)} disabled={start.isPending}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Iniciar bienvenida
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{p.done}/{p.total} completados</span>
        <span>{p.pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${p.pct}%` }} />
      </div>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              onClick={() => toggle.mutate({ item: it, done: !it.done })}
              className="flex w-full items-start gap-2 rounded-md p-1.5 text-left hover:bg-muted/50"
            >
              {it.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
              )}
              <span className="min-w-0 flex-1">
                <span className={cn("text-sm", it.done && "text-muted-foreground line-through")}>{it.label}</span>
                {it.done && it.done_at && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">· {formatMX(it.done_at, "dd MMM")}</span>
                )}
              </span>
              {it.done && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
