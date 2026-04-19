import { useMemo, useRef, useState } from "react";
import { Plus, Loader2, AtSign, Hash, AlertTriangle, Calendar as CalIcon, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCreateTask, useProfiles } from "@/hooks/useTasks";
import { useClients } from "@/hooks/useClients";
import { useAuth } from "@/contexts/AuthContext";
import { nowMX, toDateStringMX } from "@/lib/dateUtils";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface QuickCreateInputProps {
  area?: string;
  projectId?: string;
  placeholder?: string;
  onCreated?: () => void;
}

const PRIORITY_TOKENS = ["urgente", "alta", "media", "baja"] as const;

const DOW_ES: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miércoles: 3,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sábado: 6,
  sabado: 6,
};

function nextWeekday(target: number, from: Date): Date {
  const d = new Date(from);
  const diff = (target - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  return d;
}

type Parsed = {
  cleanTitle: string;
  priority: string | null;
  assignedToId: string | null;
  assignedToLabel: string | null;
  clientId: string | null;
  clientLabel: string | null;
  dueDate: string | null;
  dueLabel: string | null;
  unresolvedTokens: { type: "asignado" | "cliente"; raw: string }[];
};

function parseInput(
  raw: string,
  profiles: { user_id: string; full_name: string | null; email: string | null }[],
  clients: { id: string; name: string }[],
): Parsed {
  let text = raw;
  let priority: string | null = null;
  let assignedToId: string | null = null;
  let assignedToLabel: string | null = null;
  let clientId: string | null = null;
  let clientLabel: string | null = null;
  let dueDate: string | null = null;
  let dueLabel: string | null = null;
  const unresolvedTokens: Parsed["unresolvedTokens"] = [];

  // !prioridad
  const priRe = /(^|\s)!(\w+)/i;
  const priMatch = text.match(priRe);
  if (priMatch) {
    const candidate = priMatch[2].toLowerCase();
    if ((PRIORITY_TOKENS as readonly string[]).includes(candidate)) {
      priority = candidate;
      text = text.replace(priMatch[0], priMatch[1]).replace(/\s+/g, " ");
    }
  }

  // @asignado (1-2 palabras)
  const atRe = /(^|\s)@([\p{L}][\p{L}.'-]+(?:\s+[\p{L}][\p{L}.'-]+)?)/u;
  const atMatch = text.match(atRe);
  if (atMatch) {
    const guess = atMatch[2].trim().toLowerCase();
    const found =
      profiles.find((p) => (p.full_name || "").toLowerCase().startsWith(guess)) ||
      profiles.find((p) =>
        (p.full_name || "").toLowerCase().split(" ").some((part) => part.startsWith(guess)),
      ) ||
      profiles.find((p) => (p.email || "").toLowerCase().startsWith(guess));
    if (found) {
      assignedToId = found.user_id;
      assignedToLabel = found.full_name || found.email;
    } else {
      unresolvedTokens.push({ type: "asignado", raw: atMatch[2] });
    }
    text = text.replace(atMatch[0], atMatch[1]).replace(/\s+/g, " ");
  }

  // #cliente (1-3 palabras)
  const hashRe = /(^|\s)#([\p{L}0-9][\p{L}0-9.&'-]+(?:\s+[\p{L}0-9][\p{L}0-9.&'-]+){0,2})/u;
  const hashMatch = text.match(hashRe);
  if (hashMatch) {
    const guess = hashMatch[2].trim().toLowerCase();
    const found =
      clients.find((c) => c.name.toLowerCase().startsWith(guess)) ||
      clients.find((c) => c.name.toLowerCase().includes(guess));
    if (found) {
      clientId = found.id;
      clientLabel = found.name;
    } else {
      unresolvedTokens.push({ type: "cliente", raw: hashMatch[2] });
    }
    text = text.replace(hashMatch[0], hashMatch[1]).replace(/\s+/g, " ");
  }

  // /fecha
  const slashRe = /(^|\s)\/([\w-]+)/i;
  const slashMatch = text.match(slashRe);
  if (slashMatch) {
    const token = slashMatch[2].toLowerCase();
    const today = nowMX();
    if (token === "hoy") {
      dueDate = toDateStringMX(today);
      dueLabel = "Hoy";
    } else if (token === "manana" || token === "mañana") {
      const t = new Date(today);
      t.setDate(t.getDate() + 1);
      dueDate = toDateStringMX(t);
      dueLabel = "Mañana";
    } else if (DOW_ES[token] !== undefined) {
      const t = nextWeekday(DOW_ES[token], today);
      dueDate = toDateStringMX(t);
      dueLabel = token.charAt(0).toUpperCase() + token.slice(1);
    } else {
      // dd-mm or dd-mm-yyyy or dd/mm
      const dm = token.match(/^(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?$/);
      if (dm) {
        const day = parseInt(dm[1], 10);
        const month = parseInt(dm[2], 10);
        let year = dm[3] ? parseInt(dm[3], 10) : today.getFullYear();
        if (year < 100) year += 2000;
        const candidate = new Date(year, month - 1, day);
        if (!isNaN(candidate.getTime())) {
          dueDate = toDateStringMX(candidate);
          dueLabel = candidate.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
        }
      }
    }
    if (dueDate) {
      text = text.replace(slashMatch[0], slashMatch[1]).replace(/\s+/g, " ");
    }
  }

  return {
    cleanTitle: text.trim(),
    priority,
    assignedToId,
    assignedToLabel,
    clientId,
    clientLabel,
    dueDate,
    dueLabel,
    unresolvedTokens,
  };
}

export function QuickCreateInput({ area, projectId, placeholder, onCreated }: QuickCreateInputProps) {
  const { user } = useAuth();
  const { data: profiles = [] } = useProfiles();
  const { data: clients = [] } = useClients();

  const [value, setValue] = useState("");
  const [creating, setCreating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const createTask = useCreateTask();

  const profileRows = useMemo(
    () =>
      profiles.map((p) => ({
        user_id: p.user_id,
        full_name: p.full_name,
        email: p.email,
      })),
    [profiles],
  );
  const clientRows = useMemo(
    () => (clients as any[]).map((c) => ({ id: c.id, name: c.name })),
    [clients],
  );

  const parsed = useMemo(
    () => parseInput(value, profileRows, clientRows),
    [value, profileRows, clientRows],
  );

  const handleSubmit = async () => {
    const title = parsed.cleanTitle.trim();
    if (!title) return;
    setCreating(true);
    try {
      await createTask.mutateAsync({
        title,
        priority: parsed.priority || "media",
        due_date: parsed.dueDate || undefined,
        assigned_to: parsed.assignedToId || user?.id,
        client_id: parsed.clientId || undefined,
        project_id: projectId,
        area,
        status: "pendiente",
      });
      setValue("");
      onCreated?.();
      inputRef.current?.focus();
    } catch (e: any) {
      toast.error("Error al crear tarea: " + e.message);
    } finally {
      setCreating(false);
    }
  };

  const hasTokens =
    parsed.priority ||
    parsed.assignedToLabel ||
    parsed.clientLabel ||
    parsed.dueLabel ||
    parsed.unresolvedTokens.length > 0;

  return (
    <div className="space-y-2">
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <Plus className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={
              placeholder ||
              "Tarea rápida — usa @persona  #cliente  !prioridad  /fecha (Enter)"
            }
            className="pl-8 h-9 text-sm"
            disabled={creating}
          />
        </div>
        {parsed.cleanTitle && (
          <Button size="sm" onClick={handleSubmit} disabled={creating} className="shrink-0 h-9">
            {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Crear"}
          </Button>
        )}
      </div>

      {hasTokens && (
        <div className="flex flex-wrap items-center gap-1.5 px-1">
          {parsed.assignedToLabel && (
            <TokenChip icon={AtSign} label="Asignado" value={parsed.assignedToLabel} tone="primary" />
          )}
          {parsed.clientLabel && (
            <TokenChip icon={Hash} label="Cliente" value={parsed.clientLabel} tone="accent" />
          )}
          {parsed.priority && (
            <TokenChip
              icon={AlertTriangle}
              label="Prioridad"
              value={parsed.priority}
              tone={parsed.priority === "urgente" || parsed.priority === "alta" ? "danger" : "muted"}
            />
          )}
          {parsed.dueLabel && (
            <TokenChip icon={CalIcon} label="Vence" value={parsed.dueLabel} tone="warning" />
          )}
          {parsed.unresolvedTokens.map((tok, i) => (
            <Badge
              key={i}
              variant="outline"
              className="gap-1 text-[10.5px] border-dashed text-muted-foreground"
            >
              <X className="h-2.5 w-2.5" />
              No reconocido: {tok.type === "asignado" ? "@" : "#"}
              {tok.raw}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function TokenChip({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof AtSign;
  label: string;
  value: string;
  tone: "primary" | "accent" | "warning" | "danger" | "muted";
}) {
  const toneClass = {
    primary: "bg-primary/10 text-primary border-primary/20",
    accent: "bg-accent/10 text-accent border-accent/20",
    warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
    danger: "bg-destructive/10 text-destructive border-destructive/20",
    muted: "bg-muted text-muted-foreground border-border/60",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-medium",
        toneClass,
      )}
    >
      <Icon className="h-2.5 w-2.5" />
      <span className="opacity-70">{label}:</span>
      <span className="font-semibold">{value}</span>
    </span>
  );
}
