import { Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChatProgressStep {
  phase: string;
  message: string;
}

export function ChatProcessingPanel({
  steps,
  active = true,
  className,
}: {
  steps: ChatProgressStep[];
  active?: boolean;
  className?: string;
}) {
  if (steps.length === 0) return null;
  return (
    <div
      className={cn(
        "rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 max-w-[85%]",
        className
      )}
    >
      <p className="text-[11px] font-medium text-foreground mb-2 flex items-center gap-2">
        {active ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
            Procesando tu solicitud
          </>
        ) : (
          <>
            <Check className="h-3.5 w-3.5 text-primary shrink-0" />
            Actividad completada
          </>
        )}
      </p>
      <ol className="space-y-1.5 text-[11px] text-muted-foreground list-none">
        {steps.map((s, i) => {
          const isLast = i === steps.length - 1;
          return (
            <li key={`${s.phase}-${i}`} className="flex gap-2 items-start">
              <span
                className={cn(
                  "shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-medium",
                  isLast && active
                    ? "bg-primary/20 text-primary"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {isLast && active ? "…" : "✓"}
              </span>
              <span className={cn(isLast && active && "text-foreground/90")}>{s.message}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
