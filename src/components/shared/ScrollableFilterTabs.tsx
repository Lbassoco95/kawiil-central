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
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all whitespace-nowrap",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              )}
            >
              {opt.label}
              {opt.count !== undefined && (
                <span className={cn(
                  "text-[10px] tabular-nums",
                  isActive ? "text-muted-foreground" : "opacity-50"
                )}>
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
