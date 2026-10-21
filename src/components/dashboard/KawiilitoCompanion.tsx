import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { kawiilitoState, type KawiilitoInput, type KawiilitoPose } from "@/lib/kawiilito";

const SEEN_KEY = "kawiilito-seen-day";
const CELEBRATE_MS = 4500;

function readSeenDay(): string | null {
  try {
    return window.localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeenDay(day: string) {
  try {
    window.localStorage.setItem(SEEN_KEY, day);
  } catch {
    /* sin almacenamiento: el saludo se repetirá, no pasa nada */
  }
}

type Props = Omit<KawiilitoInput, "firstVisitToday"> & {
  /** YYYY-MM-DD CDMX, para saludar una sola vez al día. */
  todayKey: string;
};

/**
 * Kawiilito junto al briefing: vigila el seguimiento y habla con una línea breve.
 * Cuando completas una tarea celebra unos segundos.
 */
export function KawiilitoCompanion({ todayKey, ...input }: Props) {
  const [firstVisit] = useState(() => readSeenDay() !== todayKey);
  const [greeted, setGreeted] = useState(false);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);
  const prevCompleted = useRef(input.completedToday);

  // El saludo dura lo que tarda el briefing en estar listo; después pasa al seguimiento.
  useEffect(() => {
    if (!firstVisit || input.generating) return;
    const id = window.setTimeout(() => {
      writeSeenDay(todayKey);
      setGreeted(true);
    }, 6000);
    return () => window.clearTimeout(id);
  }, [firstVisit, input.generating, todayKey]);

  // Una tarea más completada → celebración breve.
  useEffect(() => {
    if (input.completedToday > prevCompleted.current) {
      setCelebrating(true);
      const id = window.setTimeout(() => setCelebrating(false), CELEBRATE_MS);
      prevCompleted.current = input.completedToday;
      return () => window.clearTimeout(id);
    }
    prevCompleted.current = input.completedToday;
  }, [input.completedToday]);

  const state = celebrating
    ? { pose: "celebra" as KawiilitoPose, line: "¡Una menos! Va quedando todo en orden.", href: undefined, key: "celebra:tarea" }
    : kawiilitoState({ ...input, firstVisitToday: firstVisit && !greeted });

  if (dismissedKey === state.key) return null;

  return (
    <div className="kawiilito" role="status" aria-live="polite">
      <div className="kawiilito-bubble" key={state.key}>
        {state.href ? (
          <>
            {state.line} <Link to={state.href}>Ver juntas</Link>
          </>
        ) : (
          state.line
        )}
        <button
          type="button"
          className="kawiilito-close"
          aria-label="Ocultar mensaje de Kawiilito"
          onClick={() => setDismissedKey(state.key)}
        >
          <X className="inline h-3 w-3" />
        </button>
      </div>
      <img
        className="kawiilito-img"
        src={`/images/kawiilito/${state.pose}.webp`}
        alt="Kawiilito"
        width={68}
        draggable={false}
      />
    </div>
  );
}
