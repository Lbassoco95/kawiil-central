import { ReactNode, useState, useEffect } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { FloatingAIChat } from "@/components/FloatingAIChat";
import { GlobalAISearch } from "@/components/shared/GlobalAISearch";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTasksRealtime } from "@/hooks/useTasksRealtime";
import { nowMX } from "@/lib/dateUtils";
import { Clock } from "lucide-react";

export function AppLayout({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  useTasksRealtime();

  const [currentTime, setCurrentTime] = useState(() => nowMX());

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(nowMX()), 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-auto w-full">
        {/* Global date/time bar */}
        <div className={`sticky top-0 z-30 bg-background/80 backdrop-blur-sm border-b border-border/50 ${isMobile ? "px-4 pt-12 pb-2" : "px-6 py-2"}`}>
          <div className="max-w-7xl mx-auto flex items-center justify-end gap-3">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <p className="text-xs sm:text-sm font-medium text-foreground capitalize">
              {currentTime.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <span className="text-xs text-muted-foreground">
              {currentTime.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false })} hrs
            </span>
          </div>
        </div>
        <div className={`max-w-7xl mx-auto animate-fade-in ${isMobile ? "p-4" : "p-6"}`}>
          {children}
        </div>
      </main>
      <FloatingAIChat />
    </div>
  );
}
