import { useState } from "react";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export interface ChatProgressStep {
  phase: string;
  message: string;
}

const TAIL_VISIBLE = 4;
/** A partir de este número de pasos, los primeros se pliegan. */
const COLLAPSE_WHEN_STEPS_EXCEED = 6;

function StepLine({
  message,
  done,
  active,
}: {
  message: string;
  done: boolean;
  active: boolean;
}) {
  return (
    <li className="flex gap-2 items-start">
      <span
        className={cn(
          "shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-medium",
          active
            ? "bg-primary/20 text-primary"
            : "bg-muted text-muted-foreground",
        )}
      >
        {active && !done ? "…" : "✓"}
      </span>
      <span className={cn(active && !done && "text-foreground/90")}>{message}</span>
    </li>
  );
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
  const [headOpen, setHeadOpen] = useState(false);

  if (steps.length === 0) return null;

  const collapse = steps.length > COLLAPSE_WHEN_STEPS_EXCEED;
  const head = collapse ? steps.slice(0, -TAIL_VISIBLE) : [];
  const tail = collapse ? steps.slice(-TAIL_VISIBLE) : steps;

  return (
    <div
      className={cn(
        "rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 max-w-[85%]",
        className,
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

      {collapse ? (
        <div className="space-y-1">
          <Collapsible open={headOpen} onOpenChange={setHeadOpen}>
            <CollapsibleTrigger
              className="flex w-full items-center justify-between gap-2 rounded-md py-1.5 text-left text-[10px] text-muted-foreground hover:text-foreground/90"
              type="button"
            >
              <span>+{head.length} paso(s) anterior(es)</span>
              <ChevronDown
                className={cn("h-3.5 w-3.5 shrink-0 transition-transform", headOpen && "rotate-180")}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ol className="mb-1 max-h-32 space-y-1.5 overflow-y-auto pl-0 text-[11px] text-muted-foreground list-none border-l border-border/50 ml-1 pl-2">
                {head.map((s, i) => (
                  <StepLine
                    key={`h-${i}-${s.phase}`}
                    message={s.message}
                    done
                    active={false}
                  />
                ))}
              </ol>
            </CollapsibleContent>
          </Collapsible>

          <ol className="max-h-44 space-y-1.5 overflow-y-auto text-[11px] text-muted-foreground list-none">
            {tail.map((s, i) => {
              const globalLast = i === tail.length - 1;
              return (
                <StepLine
                  key={`t-${i}-${s.phase}`}
                  message={s.message}
                  done={!active || !globalLast}
                  active={active && globalLast}
                />
              );
            })}
          </ol>
        </div>
      ) : (
        <ol className="max-h-44 space-y-1.5 overflow-y-auto text-[11px] text-muted-foreground list-none">
          {steps.map((s, i) => {
            const isLast = i === steps.length - 1;
            return (
              <li key={`${s.phase}-${i}`} className="flex gap-2 items-start">
                <span
                  className={cn(
                    "shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-medium",
                    isLast && active
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {isLast && active ? "…" : "✓"}
                </span>
                <span className={cn(isLast && active && "text-foreground/90")}>{s.message}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
