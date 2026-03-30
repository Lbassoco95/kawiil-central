import { cn } from "@/lib/utils";

interface FilterOption {
  value: string;
  label: string;
  count?: number;
}

interface ScrollableFilterTabsProps {
  options: FilterOption[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function ScrollableFilterTabs({ options, value, onChange, className }: ScrollableFilterTabsProps) {
  return (
    <div className={cn("overflow-x-auto scrollbar-hide -mx-1 px-1", className)}>
      <div className="inline-flex items-center gap-1 bg-muted/60 rounded-lg p-1 min-w-max">
        {options.map((opt) => {
          const isActive = value === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={cn(
                "tab-pill inline-flex items-center gap-1.5 whitespace-nowrap",
                isActive ? "tab-pill-active" : "tab-pill-inactive"
              )}
            >
              {opt.label}
              {opt.count !== undefined && (
                <span
                  className={cn(
                    "text-[10px] tabular-nums",
                    isActive ? "text-primary-foreground/75" : "opacity-50"
                  )}
                >
                  {opt.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
