import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useComplianceEntityTypes } from "@/hooks/useCompliance";
import { Skeleton } from "@/components/ui/skeleton";

interface ComplianceEntitySelectorProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function ComplianceEntitySelector({ selectedIds, onChange }: ComplianceEntitySelectorProps) {
  const { data: entityTypes, isLoading } = useComplianceEntityTypes();

  if (isLoading) return <Skeleton className="h-32 w-full" />;

  const cnbvTypes = (entityTypes || []).filter((t) => t.group_name === "CNBV");
  const avTypes = (entityTypes || []).filter((t) => t.group_name === "ACTIVIDAD_VULNERABLE");

  const toggle = (id: string) => {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((i) => i !== id) : [...selectedIds, id]
    );
  };

  return (
    <div className="space-y-4">
      {/* CNBV Group */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Grupo A — CNBV / CONDUSEF
        </h4>
        <div className="space-y-1.5">
          {cnbvTypes.map((et) => (
            <label
              key={et.id}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <Checkbox
                checked={selectedIds.includes(et.id)}
                onCheckedChange={() => toggle(et.id)}
              />
              <span>{et.name}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Actividades Vulnerables Group */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Grupo B — Actividades Vulnerables
        </h4>
        <div className="space-y-1.5">
          {avTypes.map((et) => (
            <label
              key={et.id}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-muted/50 transition-colors"
            >
              <Checkbox
                checked={selectedIds.includes(et.id)}
                onCheckedChange={() => toggle(et.id)}
              />
              <span>{et.name}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
