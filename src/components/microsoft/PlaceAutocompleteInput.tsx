import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { MapPin, Loader2 } from "lucide-react";
import { usePlacesAutocomplete } from "@/hooks/useTravelTime";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

/**
 * Input con autocompletado de Google Places. Muestra sugerencias a partir de
 * 3 caracteres; al elegir una, escribe la dirección completa. Si Places no está
 * disponible, funciona como campo de texto normal (sin sugerencias).
 */
export function PlaceAutocompleteInput({ value, onChange, placeholder, className, id }: Props) {
  const [term, setTerm] = useState(value);
  const [debounced, setDebounced] = useState(value);
  const [open, setOpen] = useState(false);
  const justPicked = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Mantener sincronizado si el valor cambia desde afuera.
  useEffect(() => { setTerm(value); }, [value]);

  // Debounce del término antes de consultar.
  useEffect(() => {
    if (justPicked.current) { justPicked.current = false; return; }
    const t = setTimeout(() => setDebounced(term), 300);
    return () => clearTimeout(t);
  }, [term]);

  const { data, isFetching } = usePlacesAutocomplete(debounced);
  const predictions = data?.predictions ?? [];
  const placesError = data?.error;

  // Cerrar al hacer clic fuera.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pick = (description: string) => {
    justPicked.current = true;
    setTerm(description);
    onChange(description);
    setOpen(false);
  };

  const showList = open && debounced.trim().length >= 3 && predictions.length > 0;
  // Diagnóstico: solo cuando hay término suficiente, no está cargando, no hay
  // sugerencias y el servicio reportó un error.
  const enoughChars = open && debounced.trim().length >= 3;
  const showSearching = enoughChars && isFetching;
  // Siempre mostramos un texto cuando terminó la búsqueda y no hubo resultados,
  // con el motivo si el servicio lo reportó (diagnóstico).
  const showEmpty = enoughChars && !isFetching && predictions.length === 0;
  const emptyLabel = placesError === "maps_not_configured"
    ? "Google Maps no está configurado en el servidor."
    : placesError === "places_not_enabled"
      ? "Places API no está habilitada o la key no la permite."
      : placesError
        ? `Sin sugerencias (${placesError}${data?.detail ? `: ${data.detail}` : ""}).`
        : `Sin resultados para «${debounced.trim()}».`;

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <Input
          id={id}
          value={term}
          placeholder={placeholder}
          onChange={(e) => { setTerm(e.target.value); onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          autoComplete="off"
        />
        {isFetching && <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
      </div>
      {showSearching && (
        <p className="mt-1 text-[11px] text-muted-foreground">Buscando lugares…</p>
      )}
      {showEmpty && (
        <p className="mt-1 text-[11px] text-muted-foreground">{emptyLabel}</p>
      )}
      {showList && (
        <ul className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-md border border-border bg-popover shadow-lg py-1 text-sm">
          {predictions.map((p, i) => (
            <li key={p.placeId ?? i}>
              <button
                type="button"
                className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent"
                onClick={() => pick(p.description)}
              >
                <MapPin className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block font-medium text-foreground truncate">{p.mainText || p.description}</span>
                  {p.secondaryText && <span className="block text-xs text-muted-foreground truncate">{p.secondaryText}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
