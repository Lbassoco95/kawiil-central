import { ReactNode, useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { NewTaskModalContext } from "@/contexts/NewTaskModalContext";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";
import { AppSidebar } from "@/components/AppSidebar";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { FloatingAIChat } from "@/components/FloatingAIChat";
import { GlobalAISearch } from "@/components/shared/GlobalAISearch";
import { useIsMobile } from "@/hooks/use-mobile";
import { useTasksRealtime } from "@/hooks/useTasksRealtime";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { nowMX } from "@/lib/dateUtils";
import { OPEN_NEW_TASK_MODAL_EVENT, openNewTaskModal } from "@/lib/openNewTaskModal";
import { Clock } from "lucide-react";

export function AppLayout({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const qc = useQueryClient();
  useTasksRealtime();
  useActivityTracker();

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel(`notifications-rt-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as { title?: string; body?: string | null };
          qc.invalidateQueries({ queryKey: ["user-notifications", user.id] });
          qc.invalidateQueries({ queryKey: ["unread-notifications-count", user.id] });
          if (row?.title) {
            toast.info(row.title, { description: row.body || undefined });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, qc]);

  const [currentTime, setCurrentTime] = useState(() => nowMX());

  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const newTaskModalValue = useMemo(() => ({ openNewTask: openNewTaskModal }), []);

  useEffect(() => {
    const interval = setInterval(() => setCurrentTime(nowMX()), 30000);
    return () => clearInterval(interval);
  }, []);

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
    <div className="flex min-h-screen w-full bg-background relative">
      {/* Ambient gradient mesh */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-1/4 -right-1/4 w-[600px] h-[600px] rounded-full bg-primary/[0.03] blur-3xl" />
        <div className="absolute -bottom-1/4 -left-1/4 w-[500px] h-[500px] rounded-full bg-accent/[0.03] blur-3xl" />
      </div>
      <AppSidebar />
      <main className="flex-1 overflow-auto w-full relative z-10">
        {/* Global date/time bar */}
        <div className={`sticky top-0 z-30 bg-background/80 backdrop-blur-sm border-b border-border/50 ${isMobile ? "px-4 pt-12 pb-2" : "px-6 py-2"}`}>
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            {!isMobile && <GlobalAISearch />}
            <div className="flex items-center gap-3 ml-auto">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs sm:text-sm font-medium text-foreground capitalize">
                {currentTime.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" })}
              </p>
              <span className="text-xs text-muted-foreground">
                {currentTime.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false })} hrs
              </span>
            </div>
          </div>
        </div>
        <div className={`max-w-7xl mx-auto animate-fade-in ${isMobile ? "p-4" : "p-6"}`}>
          {children}
        </div>
      </main>
      <FloatingAIChat />
    </div>
    <TaskFormDialog open={newTaskOpen} onOpenChange={setNewTaskOpen} />
    </NewTaskModalContext.Provider>
  );
}
