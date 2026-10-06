import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { callApi, PortalApiError } from "../lib/api";
import { isDesignPreview } from "../lib/designPreview";
import { suggestSatCatalogLocal } from "../lib/satCatalogLocal";

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
 * Escribe un concepto aproximado → sugiere clave SAT
 * (RPC portal_sat_catalog_suggest o índice local en /diseno).
 */
export default function CatalogSuggest({
  clientId, catalog, label, value, descripcionHint, onPick, onChange, id, mono, maxLength,
}: Props) {
  const design = isDesignPreview();
  const [q, setQ] = useState(descripcionHint ?? "");
  const [hits, setHits] = useState<CatalogHit[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (descripcionHint && descripcionHint !== q) setQ(descripcionHint);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descripcionHint]);

  useEffect(() => {
    const term = (q || value).trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }

    if (design || !clientId) {
      setHits(suggestSatCatalogLocal(catalog, term, 8));
      setErr(null);
      return;
    }

    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const r = await callApi<{ results: CatalogHit[] }>("catalogos.buscar", {
            client_id: clientId, catalog, q: term, limit: 8,
          });
          const apiHits = r.results ?? [];
          setHits(apiHits.length > 0 ? apiHits : suggestSatCatalogLocal(catalog, term, 8));
          setErr(null);
        } catch (e) {
          setHits(suggestSatCatalogLocal(catalog, term, 8));
          setErr(e instanceof PortalApiError ? e.message : "Catálogo remoto no disponible; mostrando sugerencias locales.");
        }
      })();
    }, 280);
    return () => window.clearTimeout(t);
  }, [q, value, clientId, catalog, design]);

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
        placeholder={catalog === "c_ClaveProdServ" ? "Clave o escribe algo aproximado…" : "Unidad SAT"}
        autoComplete="off"
      />
      {catalog === "c_ClaveProdServ" && (
        <Input
          aria-label="Buscar concepto aproximado"
          placeholder="Texto aproximado: conta, consultoría, nómina…"
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
      {catalog === "c_ClaveProdServ" && (
        <p className="text-xs text-muted-foreground">
          Búsqueda aproximada: no hace falta la clave exacta; escribe el concepto en lenguaje natural.
        </p>
      )}
    </div>
  );
}
