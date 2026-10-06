import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callApi, PortalApiError } from "../lib/api";

export type CatalogHit = { clave: string; descripcion: string; score?: number };

type Props = {
  clientId: string;
  catalog: "c_ClaveProdServ" | "c_ClaveUnidad";
  label: string;
  value: string;
  descripcionHint?: string;
  onPick: (hit: CatalogHit) => void;
  onChange: (clave: string) => void;
  id?: string;
  mono?: boolean;
  maxLength?: number;
};

/**
 * Escribe un concepto aproximado → sugiere clave SAT desde sat_catalog_entries.
 */
export default function CatalogSuggest({
  clientId, catalog, label, value, descripcionHint, onPick, onChange, id, mono, maxLength,
}: Props) {
  const [q, setQ] = useState(descripcionHint ?? "");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (descripcionHint && descripcionHint !== q) setQ(descripcionHint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descripcionHint]);

  useEffect(() => {
    const term = (q || value).trim();
    if (term.length < 2 || !clientId) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const r = await callApi<{ results: CatalogHit[] }>("catalogos.buscar", {
            client_id: clientId, catalog, q: term, limit: 8,
          });
          setHits(r.results ?? []);
          setErr(null);
        } catch (e) {
          setHits([]);
          setErr(e instanceof PortalApiError ? e.message : "No se pudo buscar en el catálogo.");
        }
      })();
    }, 280);
    return () => window.clearTimeout(t);
  }, [q, value, clientId, catalog]);

  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className={mono ? "kw-mono" : undefined}
        maxLength={maxLength}
        value={value}
        onChange={(e) => {
          const v = maxLength === 8 ? e.target.value.replace(/\D/g, "") : e.target.value;
          onChange(v);
          setQ(v);
        }}
        placeholder={catalog === "c_ClaveProdServ" ? "Escribe concepto o clave" : "Unidad SAT"}
        autoComplete="off"
      />
      {catalog === "c_ClaveProdServ" && (
        <Input
          aria-label="Buscar por descripción"
          placeholder="O busca por texto: consultoría, contabilidad…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="mt-1"
        />
      )}
      {hits.length > 0 && (
        <ul className="max-h-40 overflow-auto rounded-md border bg-background text-sm" role="listbox">
          {hits.map((h) => (
            <li key={h.clave}>
              <button
                type="button"
                className="flex w-full gap-2 px-2 py-1.5 text-left hover:bg-muted"
                onClick={() => {
                  onPick(h);
                  setQ(h.descripcion);
                  setHits([]);
                }}
              >
                <span className="kw-mono shrink-0">{h.clave}</span>
                <span className="text-muted-foreground">{h.descripcion}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="text-xs text-muted-foreground">{err}</p>}
    </div>
  );
}
