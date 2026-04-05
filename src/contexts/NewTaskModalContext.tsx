import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { TaskFormDialog } from "@/components/tasks/TaskFormDialog";

type Ctx = { openNewTask: () => void };

const NewTaskModalContext = createContext<Ctx>({ openNewTask: () => {} });

export function useNewTaskModal() {
  return useContext(NewTaskModalContext);
}

export function NewTaskModalHost({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openNewTask = useCallback(() => setOpen(true), []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "n") return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  return (
    <NewTaskModalContext.Provider value={{ openNewTask }}>
      {children}
      <TaskFormDialog open={open} onOpenChange={setOpen} />
    </NewTaskModalContext.Provider>
  );
}
