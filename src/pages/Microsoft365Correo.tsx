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
import { Loader2, Clock } from "lucide-react";
import { useState, useEffect } from "react";

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
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <main className="flex-1 flex flex-col overflow-hidden w-full h-screen">
        {/* Compact header */}
        <div className={`shrink-0 bg-background/80 backdrop-blur-sm border-b border-border/50 ${isMobile ? "px-4 pt-12 pb-2" : "px-4 py-1.5"}`}>
          <div className="flex items-center gap-3">
            {!isMobile && <GlobalAISearch />}
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold text-foreground">Correo</h1>
              {profile && (
                <span className="text-xs text-muted-foreground">
                  · {profile.displayName || profile.mail || ""}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 ml-auto">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-medium text-foreground capitalize">
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
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !isConnected ? (
            <div className="p-6">
              <MicrosoftConnectCard onConnect={connect} isConnecting={isConnecting} />
            </div>
          ) : (
            <ErrorBoundary>
              <EmailView />
            </ErrorBoundary>
          )}
        </div>
      </main>
      <FloatingAIChat />
    </div>
  );
};

export default Microsoft365Correo;
