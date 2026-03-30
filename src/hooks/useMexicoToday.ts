import { useState, useEffect } from "react";
import { nowMX } from "@/lib/dateUtils";

/**
 * Fecha/hora en zona CDMX que se actualiza cada minuto y al volver a la pestaña.
 * Evita que el dashboard quede con el día “congelado” del primer render (useMemo vacío).
 */
export function useMexicoToday(): Date {
  const [today, setToday] = useState(() => nowMX());

  useEffect(() => {
    const sync = () => setToday(nowMX());
    const id = window.setInterval(sync, 60_000);
    const onVis = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return today;
}
