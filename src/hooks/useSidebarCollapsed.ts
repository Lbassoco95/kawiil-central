import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "kawiil-sb-collapsed";

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Persist sidebar collapse state in localStorage so it survives reloads
 * and stays in sync between tabs.
 */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsedState] = useState<boolean>(readInitial);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setCollapsedState(e.newValue === "1");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setCollapsed = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setCollapsedState((prev) => {
      const next = typeof value === "function" ? (value as (p: boolean) => boolean)(prev) : value;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggle = useCallback(() => setCollapsed((p) => !p), [setCollapsed]);

  return { collapsed, setCollapsed, toggle };
}
