import { ReactNode, useState, useEffect, useMemo } from "react";
import { NewTaskModalContext } from "@/contexts/NewTaskModalContext";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { AppSidebar } from "@/components/AppSidebar";
import { FloatingAIChat } from "@/components/FloatingAIChat";
import { AppTopbar } from "@/components/layout/AppTopbar";
import { GlobalCommandPalette } from "@/components/search/GlobalCommandPalette";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTasksRealtime } from "@/hooks/useTasksRealtime";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { useNotificationDelivery } from "@/hooks/useNotificationDelivery";
import { OPEN_NEW_TASK_MODAL_EVENT, openNewTaskModal } from "@/lib/openNewTaskModal";
import { cn } from "@/lib/utils";

type AppLayoutProps = {
  children: ReactNode;
  /** Contenido a ancho completo (p. ej. cliente Slack) */
  contentMaxWidth?: "default" | "full";
};

export function AppLayout({ children, contentMaxWidth = "default" }: AppLayoutProps) {
  const isMobile = useIsMobile();
  const isFullWidth = contentMaxWidth === "full";
  useTasksRealtime();
  useActivityTracker();
  useNotificationDelivery();

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

  return (
    <NewTaskModalContext.Provider value={newTaskModalValue}>
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
              : `max-w-7xl mx-auto ${isMobile ? "p-4" : "p-6"}`
          }`}
        >
          {children}
        </div>
      </main>
      <FloatingAIChat />
    </div>
    <TaskFormDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} />
    <GlobalCommandPalette />
    </NewTaskModalContext.Provider>
  );
}
