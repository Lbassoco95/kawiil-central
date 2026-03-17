import { useState, useRef, useCallback, useEffect, memo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Play, Pause, Timer } from "lucide-react";
import { cn } from "@/lib/utils";

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatTimeCompact(totalSeconds: number): string {
  if (totalSeconds === 0) return "";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface StepTimerBadgeProps {
  savedSeconds: number;
  timerRunning: boolean;
  displaySeconds: number;
}

/** Compact badge shown in collapsed row header */
export const StepTimerBadge = memo(function StepTimerBadge({ savedSeconds, timerRunning, displaySeconds }: StepTimerBadgeProps) {
  if (savedSeconds === 0 && !timerRunning) return null;
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] sm:text-xs gap-1 font-mono hidden sm:inline-flex",
        timerRunning && "border-primary text-primary animate-pulse"
      )}
    >
      <Timer className="h-3 w-3" />
      {timerRunning ? formatTime(displaySeconds) : formatTimeCompact(savedSeconds)}
    </Badge>
  );
});

interface StepTimerControlProps {
  initialSeconds: number;
  onStop: (totalSeconds: number) => void;
}

/** Full timer control shown in expanded step body. Manages its own interval state. */
export function StepTimerControl({ initialSeconds, onStop }: StepTimerControlProps) {
  const [timerRunning, setTimerRunning] = useState(false);
  const [displaySeconds, setDisplaySeconds] = useState(initialSeconds);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const baseSecondsRef = useRef<number>(initialSeconds);

  // Sync when parent value changes (e.g. after save) but only when not running
  useEffect(() => {
    if (!timerRunning) {
      baseSecondsRef.current = initialSeconds;
      setDisplaySeconds(initialSeconds);
    }
  }, [initialSeconds, timerRunning]);

  const startTimer = useCallback(() => {
    if (timerRunning) return;
    baseSecondsRef.current = displaySeconds;
    startTimeRef.current = Date.now();
    setTimerRunning(true);
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setDisplaySeconds(baseSecondsRef.current + elapsed);
    }, 1000);
  }, [timerRunning, displaySeconds]);

  const stopTimer = useCallback(() => {
    if (!timerRunning) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setTimerRunning(false);
    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const total = baseSecondsRef.current + elapsed;
    baseSecondsRef.current = total;
    setDisplaySeconds(total);
    onStop(total);
  }, [timerRunning, onStop]);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  return (
    <div className="flex items-center gap-3 rounded-md border border-border/50 bg-background px-3 py-2">
      <Timer className="h-4 w-4 text-muted-foreground" />
      <span className="font-mono text-sm font-medium flex-1">{formatTime(displaySeconds)}</span>
      <Button
        variant={timerRunning ? "destructive" : "default"}
        size="sm"
        className="h-7 text-xs gap-1"
        onClick={timerRunning ? stopTimer : startTimer}
      >
        {timerRunning ? <><Pause className="h-3 w-3" />Pausar</> : <><Play className="h-3 w-3" />Iniciar</>}
      </Button>
    </div>
  );
}
