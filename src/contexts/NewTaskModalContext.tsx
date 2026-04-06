import { createContext, useContext } from "react";

type Ctx = { openNewTask: () => void };

export const NewTaskModalContext = createContext<Ctx>({ openNewTask: () => {} });

export function useNewTaskModal() {
  return useContext(NewTaskModalContext);
}
