import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type CvdMode = "off" | "deuteranopia" | "protanopia" | "tritanopia";

export const CVD_STORAGE_KEY = "kawiil-cvd-mode";

const VALID_MODES: readonly CvdMode[] = [
  "off",
  "deuteranopia",
  "protanopia",
  "tritanopia",
];

interface AccessibilityContextValue {
  cvdMode: CvdMode;
  setCvdMode: (mode: CvdMode) => void;
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(
  null,
);

function readInitialMode(): CvdMode {
  if (typeof window === "undefined") return "off";
  try {
    const raw = window.localStorage.getItem(CVD_STORAGE_KEY);
    if (raw && (VALID_MODES as readonly string[]).includes(raw)) {
      return raw as CvdMode;
    }
    // Fallback: si el script inline ya aplico un data-cvd valido, respetarlo.
    const attr = document.documentElement.dataset.cvd;
    if (attr && (VALID_MODES as readonly string[]).includes(attr)) {
      return attr as CvdMode;
    }
  } catch {
    // localStorage puede estar deshabilitado; seguimos con "off".
  }
  return "off";
}

function applyCvdAttribute(mode: CvdMode) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "off") {
    delete root.dataset.cvd;
  } else {
    root.dataset.cvd = mode;
  }
}

interface AccessibilityProviderProps {
  children: ReactNode;
}

export function AccessibilityProvider({ children }: AccessibilityProviderProps) {
  const [cvdMode, setCvdModeState] = useState<CvdMode>(() => readInitialMode());

  useEffect(() => {
    applyCvdAttribute(cvdMode);
    try {
      if (cvdMode === "off") {
        window.localStorage.removeItem(CVD_STORAGE_KEY);
      } else {
        window.localStorage.setItem(CVD_STORAGE_KEY, cvdMode);
      }
    } catch {
      // Ignorar errores de almacenamiento (modo privado, quota, etc.).
    }
  }, [cvdMode]);

  // Sincronizar entre pestanas del mismo origen.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key !== CVD_STORAGE_KEY) return;
      const next = event.newValue;
      if (!next) {
        setCvdModeState("off");
        return;
      }
      if ((VALID_MODES as readonly string[]).includes(next)) {
        setCvdModeState(next as CvdMode);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setCvdMode = useCallback((mode: CvdMode) => {
    setCvdModeState(mode);
  }, []);

  const value = useMemo(
    () => ({ cvdMode, setCvdMode }),
    [cvdMode, setCvdMode],
  );

  return (
    <AccessibilityContext.Provider value={value}>
      {children}
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility(): AccessibilityContextValue {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) {
    throw new Error(
      "useAccessibility debe usarse dentro de <AccessibilityProvider>",
    );
  }
  return ctx;
}
