import { useState, useRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X, User, ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Profile {
  user_id: string;
  full_name: string;
}

/** Single value: pick a user or type a name */
export function UserOrTextSingle({
  value,
  onChange,
  profiles = [],
  placeholder = "Escribir nombre o seleccionar usuario...",
}: {
  value: string;
  onChange: (val: string) => void;
  profiles: Profile[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const filtered = profiles.filter((p) =>
    p.full_name.toLowerCase().includes(value.toLowerCase())
  );

  return (
    <div className="relative">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && filtered.length > 0 && value.length > 0 && (
        <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-md max-h-40 overflow-y-auto">
          {filtered.map((p) => (
            <button
              key={p.user_id}
              type="button"
              className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(p.full_name);
                setOpen(false);
              }}
            >
              <User className="h-3 w-3 text-muted-foreground shrink-0" />
              {p.full_name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Multi value: add users from dropdown or type custom names */
export function UserOrTextMulti({
  values,
  onChange,
  profiles = [],
  placeholder = "Nombre o seleccionar usuario...",
  hint,
}: {
  values: string[];
  onChange: (vals: string[]) => void;
  profiles: Profile[];
  placeholder?: string;
  hint?: string;
}) {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const addValue = (name: string) => {
    const trimmed = name.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInput("");
    setShowSuggestions(false);
  };

  const filtered = profiles.filter(
    (p) =>
      p.full_name.toLowerCase().includes(input.toLowerCase()) &&
      !values.includes(p.full_name)
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((name, idx) => (
          <Badge key={idx} variant="secondary" className="text-xs gap-1">
            {name}
            <X
              className="h-3 w-3 cursor-pointer hover:text-destructive"
              onClick={() => onChange(values.filter((_, i) => i !== idx))}
            />
          </Badge>
        ))}
      </div>
      <div className="relative">
        <div className="flex gap-2">
          <Input
            placeholder={placeholder}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setShowSuggestions(true);
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && input.trim()) {
                e.preventDefault();
                addValue(input);
              }
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!input.trim()}
            onClick={() => addValue(input)}
          >
            Agregar
          </Button>
        </div>
        {showSuggestions && filtered.length > 0 && (
          <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-md max-h-40 overflow-y-auto">
            {filtered.map((p) => (
              <button
                key={p.user_id}
                type="button"
                className="flex items-center gap-2 w-full px-3 py-2 text-sm hover:bg-accent text-left"
                onMouseDown={(e) => {
                  e.preventDefault();
                  addValue(p.full_name);
                }}
              >
                <User className="h-3 w-3 text-muted-foreground shrink-0" />
                {p.full_name}
              </button>
            ))}
          </div>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
