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
  variant = "default",
}: {
  steps: ChatProgressStep[];
  active?: boolean;
  className?: string;
  /** `compact`: menos padding y alturas, para el widget flotante. */
  variant?: "default" | "compact";
}) {
  const [headOpen, setHeadOpen] = useState(false);
  const compact = variant === "compact";

  if (steps.length === 0) return null;

  const collapse = steps.length > COLLAPSE_WHEN_STEPS_EXCEED;
  const head = collapse ? steps.slice(0, -TAIL_VISIBLE) : [];
  const tail = collapse ? steps.slice(-TAIL_VISIBLE) : steps;

  const listMaxHead = compact ? "max-h-24" : "max-h-32";
  const listMaxMain = compact ? "max-h-32" : "max-h-44";
  const stepText = compact ? "text-[10px]" : "text-[11px]";

  return (
    <div
      className={cn(
        "border border-primary/20 bg-primary/5 max-w-[85%]",
        compact ? "rounded-xl px-3 py-2" : "rounded-2xl px-4 py-3",
        className,
      )}
    >
      <p
        className={cn(
          "font-medium text-foreground flex items-center gap-2",
          compact ? "text-[10px] mb-1.5" : "text-[11px] mb-2",
        )}
      >
        {active ? (
          <>
            <Loader2 className={cn("animate-spin text-primary shrink-0", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
            Procesando tu solicitud
          </>
        ) : (
          <>
            <Check className={cn("text-primary shrink-0", compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
            Actividad completada
          </>
        )}
      </p>

      {collapse ? (
        <div className="space-y-1">
          <Collapsible open={headOpen} onOpenChange={setHeadOpen}>
            <CollapsibleTrigger
              className={cn(
                "flex w-full items-center justify-between gap-2 rounded-md py-1.5 text-left text-muted-foreground hover:text-foreground/90",
                compact ? "text-[9px]" : "text-[10px]",
              )}
              type="button"
            >
              <span>+{head.length} paso(s) anterior(es)</span>
              <ChevronDown
                className={cn("h-3.5 w-3.5 shrink-0 transition-transform", headOpen && "rotate-180")}
              />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ol
                className={cn(
                  "mb-1 space-y-1 overflow-y-auto pl-0 text-muted-foreground list-none border-l border-border/50 ml-1 pl-2",
                  listMaxHead,
                  stepText,
                )}
              >
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

          <ol
            className={cn(
              "space-y-1 overflow-y-auto text-muted-foreground list-none",
              listMaxMain,
              stepText,
            )}
          >
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
        <ol
          className={cn(
            "space-y-1 overflow-y-auto text-muted-foreground list-none",
            listMaxMain,
            stepText,
          )}
        >
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
