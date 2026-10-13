import { useState, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

export interface SearchableOption {
  value: string;
  label: string;
  /** Encabezado de sección (p. ej. "Grupo: X"). Las secciones salen en el orden en que aparecen;
   *  las opciones sin sección van primero. Cada sección se ordena alfabéticamente. */
  group?: string;
}
type Option = SearchableOption;

interface Props {
  options: Option[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
  /** If provided, shows a clearable "none" option at top with this label */
  emptyLabel?: string;
}

export function SearchableSelect({
  options,
  value,
  onValueChange,
  placeholder = "Seleccionar...",
  searchPlaceholder = "Buscar...",
  className,
  disabled,
  emptyLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const sorted = useMemo(() => {
    const seen: string[] = [];
    for (const o of options) {
      const g = o.group ?? "";
      if (!seen.includes(g)) seen.push(g);
    }
    const order = ["", ...seen.filter((g) => g !== "")];
    return order.flatMap((g) =>
      options.filter((o) => (o.group ?? "") === g).sort((a, b) => a.label.localeCompare(b.label, "es")),
    );
  }, [options]);

  const filtered = useMemo(
    () =>
      search
        ? sorted.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
        : sorted,
    [sorted, search]
  );

  const selectedLabel = options.find((o) => o.value === value)?.label;

  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", !value && "text-muted-foreground", className)}
        >
          <span className="truncate">{selectedLabel || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="flex items-center border-b px-3 py-2">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          <div className="p-1">
            {emptyLabel && !search && (
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer text-muted-foreground",
                  !value && "bg-accent"
                )}
                onClick={() => {
                  onValueChange("");
                  setOpen(false);
                  setSearch("");
                }}
              >
                <Check className={cn("h-4 w-4 shrink-0", !value ? "opacity-100" : "opacity-0")} />
                {emptyLabel}
              </button>
            )}
            {filtered.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">Sin resultados</p>
            )}
            {filtered.map((option, i) => (
              <div key={`${option.group ?? ""}|${option.value}`}>
                {option.group && option.group !== filtered[i - 1]?.group && (
                  <p className="px-2 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {option.group}
                  </p>
                )}
              <button
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer",
                  value === option.value && "bg-accent"
                )}
                onClick={() => {
                  onValueChange(option.value);
                  setOpen(false);
                  setSearch("");
                }}
              >
                <Check className={cn("h-4 w-4 shrink-0", value === option.value ? "opacity-100" : "opacity-0")} />
                {option.label}
              </button>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
