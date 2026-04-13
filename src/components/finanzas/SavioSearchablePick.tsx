import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type SavioSearchablePickOption = {
  id: string;
  /** Primera línea (nombre legible). */
  label: string;
  /** Segunda línea opcional (monto, estado, etc.). */
  subtitle?: string;
};

interface SavioSearchablePickProps {
  options: SavioSearchablePickOption[];
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}

export function SavioSearchablePick({
  options,
  value,
  onChange,
  placeholder = "Buscar y elegir…",
  searchPlaceholder = "Buscar…",
  emptyText = "Sin coincidencias.",
  disabled,
  className,
}: SavioSearchablePickProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("h-10 w-full justify-between font-normal text-left", className)}
        >
          <span className="truncate block text-left">
            {selected ? (
              <span className="flex flex-col items-start gap-0.5">
                <span className="text-sm">{selected.label}</span>
                {selected.subtitle ? (
                  <span className="text-[11px] text-muted-foreground font-normal">{selected.subtitle}</span>
                ) : null}
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => (
                <CommandItem
                  key={opt.id}
                  value={`${opt.label} ${opt.subtitle ?? ""} ${opt.id}`}
                  className="items-start"
                  onSelect={() => {
                    onChange(opt.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === opt.id ? "opacity-100" : "opacity-0")} />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate">{opt.label}</span>
                    {opt.subtitle ? (
                      <span className="text-[11px] text-muted-foreground truncate">{opt.subtitle}</span>
                    ) : null}
                    <span className="text-[10px] font-mono text-muted-foreground/80 truncate">ID: {opt.id}</span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
