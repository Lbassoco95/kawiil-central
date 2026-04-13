import { AppSidebar } from "@/components/AppSidebar";
import { FloatingAIChat } from "@/components/FloatingAIChat";
import { GlobalAISearch } from "@/components/shared/GlobalAISearch";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EmailView } from "@/components/microsoft/EmailView";
import { MicrosoftConnectCard } from "@/components/microsoft/MicrosoftConnectCard";
import { useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTasksRealtime } from "@/hooks/useTasksRealtime";
import { nowMX } from "@/lib/dateUtils";
import { Clock } from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

const Microsoft365Correo = () => {
  const { isConnected, isLoading, connect, isConnecting, profile } = useMicrosoftConnection();
  const isMobile = useIsMobile();
  useTasksRealtime();

  const [currentTime, setCurrentTime] = useState(() => nowMX());
  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(nowMX()), 30000);
    return () => clearInterval(interval);
  }, []);

  // Full-bleed layout — no AppLayout wrapper to avoid max-w-7xl and padding
  return (
    <div className="flex min-h-screen w-full bg-background relative">
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-1/4 -right-1/4 w-[600px] h-[600px] rounded-full bg-primary/[0.03] blur-3xl" />
        <div className="absolute -bottom-1/4 -left-1/4 w-[500px] h-[500px] rounded-full bg-accent/[0.03] blur-3xl" />
      </div>
      <AppSidebar />
      <main className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden w-full h-screen">
        {/* Cabecera: búsqueda en bloque aparte para alinear con el área de correo */}
        <div
          className={cn(
            "shrink-0 border-b border-border/70 bg-card shadow-sm backdrop-blur-md",
            isMobile ? "px-4 pt-12 pb-2" : "px-4 py-3",
          )}
        >
          {!isMobile && (
            <div className="mb-2 w-full max-w-2xl">
              <GlobalAISearch className="w-full max-w-full shrink-0 flex-none" />
            </div>
          )}
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="text-sm font-medium text-foreground">Correo</h1>
              {profile && (
                <span className="truncate text-xs text-muted-foreground">
                  · {profile.displayName || profile.mail || ""}
                </span>
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-2 sm:gap-3">
              <Clock className="hidden h-3.5 w-3.5 text-muted-foreground sm:block" />
              <p className="hidden text-xs font-medium capitalize text-foreground sm:block">
                {currentTime.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
              </p>
              <span className="text-xs text-muted-foreground">
                {currentTime.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false })} hrs
              </span>
            </div>
          </div>
        </div>

        {/* Content — fills remaining space */}
        <div className="flex-1 min-h-0">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="space-y-3 w-full max-w-md px-6">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex gap-3 animate-pulse">
                    <div className="h-10 w-10 rounded-full bg-secondary/40 shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 bg-secondary/40 rounded w-3/4" />
                      <div className="h-3 bg-secondary/30 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : !isConnected ? (
            <div className="p-6 animate-scale-in">
              <MicrosoftConnectCard onConnect={connect} isConnecting={isConnecting} />
            </div>
          ) : (
            <ErrorBoundary>
              <div className="h-full min-h-0 min-w-0 w-full animate-fade-in">
                <EmailView />
              </div>
            </ErrorBoundary>
          )}
        </div>
      </main>
      <FloatingAIChat />
    </div>
  );
};

export default Microsoft365Correo;
