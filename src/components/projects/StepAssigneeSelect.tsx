import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProfiles } from "@/hooks/useTasks";
import { User } from "lucide-react";

interface Props {
  value: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
}

export function StepAssigneeSelect({ value, onChange, disabled }: Props) {
  const { data: profiles = [] } = useProfiles();

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
        <User className="h-3 w-3" /> Responsable
      </label>
      <Select
        value={value || "__none__"}
        onValueChange={(v) => onChange(v === "__none__" ? null : v)}
        disabled={disabled}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder="Sin asignar" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Sin asignar</SelectItem>
          {profiles.map((p) => (
            <SelectItem key={p.user_id} value={p.user_id}>
              {p.full_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function useProfileName(userId: string | null | undefined): string | null {
  const { data: profiles = [] } = useProfiles();
  if (!userId) return null;
  return profiles.find((p) => p.user_id === userId)?.full_name || null;
}
