import { useEffect, useMemo, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useRealtimeStatus, realtimeStatusLabel } from "@/lib/realtimeStatusStore";
import { cn } from "@/lib/utils";

/**
 * Punto de estado en el topbar que reemplaza al toast efímero "Avisos en vivo desconectados…".
 * Solo se muestra cuando hay sesión y la salud no es óptima; en estado SUBSCRIBED queda oculto
 * para no añadir ruido visual cuando todo funciona.
 */
export function RealtimeStatusIndicator() {
  const status = useRealtimeStatus();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (status.status === "subscribed" || status.status === "idle") return;
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, [status.status]);

  const ageLabel = useMemo(() => {
    if (!status.lastSubscribedAt) return "—";
    const ms = Math.max(0, now - status.lastSubscribedAt);
    const s = Math.floor(ms / 1000);
    if (s < 60) return `hace ${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `hace ${m} min`;
    const h = Math.floor(m / 60);
    return `hace ${h} h`;
  }, [now, status.lastSubscribedAt]);

  if (status.status === "idle" || status.status === "subscribed") return null;

  const isDown = status.status === "down";
  const Icon = isDown ? WifiOff : RefreshCw;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={realtimeStatusLabel(status.status)}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium",
            isDown
              ? "border-rose-300/60 bg-rose-50 text-rose-700 dark:border-rose-700/40 dark:bg-rose-950/40 dark:text-rose-300"
              : "border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-700/40 dark:bg-amber-950/40 dark:text-amber-300",
          )}
        >
          <span className="relative inline-flex h-2 w-2">
            <span
              className={cn(
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                isDown ? "bg-rose-500" : "bg-amber-500",
              )}
            />
            <span
              className={cn(
                "relative inline-flex h-2 w-2 rounded-full",
                isDown ? "bg-rose-600" : "bg-amber-500",
              )}
            />
          </span>
          <Icon className={cn("h-3 w-3", !isDown && "animate-spin")} />
          <span className="hidden sm:inline">
            {isDown ? "Sin avisos en vivo" : "Reconectando"}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[260px] text-xs">
        <p className="font-medium">{realtimeStatusLabel(status.status)}</p>
        <p className="mt-1 text-muted-foreground">
          Último OK {ageLabel}
          {status.lastErrorReason ? ` · motivo: ${status.lastErrorReason}` : ""}
        </p>
        <p className="mt-1 text-muted-foreground">
          Mientras tanto, los badges del sidebar se actualizan por refetch periódico (~30 s).
        </p>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Variante "punto" minimalista para añadir junto a otros iconos del topbar.
 * Devuelve null en estados saludables.
 */
export function RealtimeStatusDot({ className }: { className?: string }) {
  const status = useRealtimeStatus();
  if (status.status === "subscribed" || status.status === "idle") return null;
  const isDown = status.status === "down";
  return (
    <span
      title={realtimeStatusLabel(status.status)}
      aria-label={realtimeStatusLabel(status.status)}
      className={cn(
        "inline-flex h-2 w-2 rounded-full",
        isDown ? "bg-rose-500" : "bg-amber-500 animate-pulse",
        className,
      )}
    />
  );
}
