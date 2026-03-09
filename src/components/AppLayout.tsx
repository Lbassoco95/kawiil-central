import { ReactNode } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { FloatingAIChat } from "@/components/FloatingAIChat";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTasksRealtime } from "@/hooks/useTasksRealtime";

export function AppLayout({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  useTasksRealtime();
  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-auto w-full">
        <div className={`max-w-7xl mx-auto animate-fade-in ${isMobile ? "p-4 pt-14" : "p-6"}`}>
          {children}
        </div>
      </main>
      <FloatingAIChat />
    </div>
  );
}
