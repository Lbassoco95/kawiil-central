import { ReactNode, useState, useEffect, useMemo } from "react";
import { NewTaskModalContext } from "@/contexts/NewTaskModalContext";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { AppSidebar } from "@/components/AppSidebar";
import { FloatingAIChat } from "@/components/FloatingAIChat";
import { ChatProvider } from "@/hooks/useChat";
import { AppTopbar } from "@/components/layout/AppTopbar";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { GlobalCommandPalette } from "@/components/search/GlobalCommandPalette";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTasksRealtime } from "@/hooks/useTasksRealtime";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { useNotificationDelivery } from "@/hooks/useNotificationDelivery";
import { useGlobalSlackReadSync } from "@/hooks/useGlobalSlackReadSync";
import { useAutoSyncMicrosoftPhoto } from "@/hooks/useMicrosoft";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { OPEN_NEW_TASK_MODAL_EVENT, openNewTaskModal } from "@/lib/openNewTaskModal";
import { cn } from "@/lib/utils";

type AppLayoutProps = {
  children: ReactNode;
  /** Contenido a ancho completo (p. ej. cliente Slack) */
  contentMaxWidth?: "default" | "full";
  /**
   * `none` = sin sidebar/topbar/chat (proyección de juntas a pantalla completa).
   * Sigue montando providers y trackers de la app.
   */
  chrome?: "default" | "none";
};

export function AppLayout({
  children,
  contentMaxWidth = "default",
  chrome = "default",
}: AppLayoutProps) {
  const isMobile = useIsMobile();
  const isFullWidth = contentMaxWidth === "full";
  const hideChrome = chrome === "none";
  useTasksRealtime();
  useActivityTracker();
  useNotificationDelivery();
  useGlobalSlackReadSync();
  useAutoSyncMicrosoftPhoto();
  useDocumentTitle();

  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const newTaskModalValue = useMemo(() => ({ openNewTask: openNewTaskModal }), []);

  useEffect(() => {
    const onOpenEvent = () => setNewTaskOpen(true);
    window.addEventListener(OPEN_NEW_TASK_MODAL_EVENT, onOpenEvent);
    return () => window.removeEventListener(OPEN_NEW_TASK_MODAL_EVENT, onOpenEvent);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "n") return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
      e.preventDefault();
      window.dispatchEvent(new CustomEvent(OPEN_NEW_TASK_MODAL_EVENT));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  if (hideChrome) {
    return (
      <NewTaskModalContext.Provider value={newTaskModalValue}>
        <ChatProvider>
          <div className="fixed inset-0 z-[80] flex h-svh max-h-svh w-full flex-col overflow-hidden bg-background">
            <main className="relative z-10 min-h-0 flex-1 overflow-auto">
              {children}
            </main>
          </div>
          <TaskFormDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} />
          <GlobalCommandPalette />
        </ChatProvider>
      </NewTaskModalContext.Provider>
    );
  }

  return (
    <NewTaskModalContext.Provider value={newTaskModalValue}>
    <ChatProvider>
    <div
      className={cn(
        "flex w-full bg-background relative",
        isFullWidth ? "h-svh max-h-svh min-h-0 overflow-hidden" : "min-h-screen",
      )}
    >
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-1/4 -right-1/4 w-[600px] h-[600px] rounded-full bg-primary/[0.03] blur-3xl" />
        <div className="absolute -bottom-1/4 -left-1/4 w-[500px] h-[500px] rounded-full bg-accent/[0.03] blur-3xl" />
      </div>
      <AppSidebar />
      <main
        className={`flex-1 w-full relative z-10 min-h-0 ${
          isFullWidth ? "flex flex-col overflow-hidden" : "overflow-auto"
        }`}
      >
        <AppTopbar isFullWidth={isFullWidth} />
        <div
          className={`animate-fade-in ${
            isFullWidth
              ? `w-full max-w-none flex-1 min-h-0 flex flex-col overflow-hidden ${isMobile ? "px-0 pb-0 pt-0" : "px-0 pb-0"}`
              : `max-w-7xl mx-auto ${isMobile ? "px-4 pt-4 pb-24" : "p-6"}`
          }`}
        >
          {children}
        </div>
      </main>
      <FloatingAIChat />
      {isMobile && !isFullWidth && <MobileBottomNav />}
    </div>
    <TaskFormDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} />
    <GlobalCommandPalette />
    </ChatProvider>
    </NewTaskModalContext.Provider>
  );
}
