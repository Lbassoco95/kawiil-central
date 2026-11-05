import { useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const NEW = "__nuevo__";
const NONE = "__ninguno__";

/**
 * Selector de rubro con opción de crear uno nuevo (carpas, mobiliario, etc.).
 * `noneLabel` agrega una opción "sin rubro" (valor "").
 */
export function RubroSelect({
  value, onChange, options, noneLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  noneLabel?: string;
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");

  const commit = () => {
    const v = draft.trim();
    if (v) onChange(v);
    setCreating(false);
    setDraft("");
  };

  if (creating) {
    return (
      <Input
        autoFocus placeholder="Nombre del rubro (ej: Carpas)"
        value={draft} onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { setCreating(false); setDraft(""); }
        }}
      />
    );
  }

  // Si el valor actual no está en la lista (rubro recién escrito), se muestra igual.
  const all = value && !options.some((o) => o.value === value)
    ? [...options, { value, label: value }] : options;

  return (
    <Select
      value={value || (noneLabel ? NONE : "")}
      onValueChange={(v) => {
        if (v === NEW) setCreating(true);
        else onChange(v === NONE ? "" : v);
      }}
    >
      <SelectTrigger><SelectValue placeholder="Selecciona un rubro" /></SelectTrigger>
      <SelectContent>
        {noneLabel && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
        {all.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        <SelectItem value={NEW}>＋ Nuevo rubro…</SelectItem>
      </SelectContent>
    </Select>
  );
}
