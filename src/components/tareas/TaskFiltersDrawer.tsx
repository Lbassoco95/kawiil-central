import { useEffect, useMemo, useState } from "react";
import { Filter, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClients } from "@/hooks/useClients";
import { useProjects } from "@/hooks/useProjects";
import { useProfiles } from "@/hooks/useTasks";
import { useAreaOptions } from "@/hooks/useAreaOptions";
import { cn } from "@/lib/utils";

export type TaskAdvancedFilters = {
  clientId?: string | null;
  projectId?: string | null;
  assignedTo?: string | null;
  area?: string | null;
  priority?: string | null;
};

const STORAGE_KEY = "kawiil-tareas-filters";

const EMPTY: TaskAdvancedFilters = {
  clientId: null,
  projectId: null,
  assignedTo: null,
  area: null,
  priority: null,
};

function readStored(): TaskAdvancedFilters {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw);
    return { ...EMPTY, ...parsed };
  } catch {
    return EMPTY;
  }
}

export function useTaskAdvancedFilters() {
  const [filters, setFiltersState] = useState<TaskAdvancedFilters>(readStored);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
    } catch {
      /* ignore */
    }
  }, [filters]);

  const activeCount = useMemo(
    () => Object.values(filters).filter((v) => v !== null && v !== undefined && v !== "").length,
    [filters],
  );

  return {
    filters,
    setFilters: setFiltersState,
    clear: () => setFiltersState(EMPTY),
    activeCount,
  };
}

interface TaskFiltersDrawerProps {
  filters: TaskAdvancedFilters;
  onChange: (next: TaskAdvancedFilters) => void;
  onClear: () => void;
  activeCount: number;
}

export function TaskFiltersDrawer({ filters, onChange, onClear, activeCount }: TaskFiltersDrawerProps) {
  const [open, setOpen] = useState(false);
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const { data: profiles = [] } = useProfiles();
  const { areaOptions } = useAreaOptions();

  const [clientSearch, setClientSearch] = useState("");
  const [projectSearch, setProjectSearch] = useState("");

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    return q ? (clients as any[]).filter((c) => c.name?.toLowerCase().includes(q)) : (clients as any[]);
  }, [clients, clientSearch]);

  const filteredProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    return q ? (projects as any[]).filter((p) => p.name?.toLowerCase().includes(q)) : (projects as any[]);
  }, [projects, projectSearch]);

  const update = (patch: Partial<TaskAdvancedFilters>) => onChange({ ...filters, ...patch });

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          Filtros
          {activeCount > 0 && (
            <Badge
              variant="secondary"
              className="h-4 min-w-4 px-1 text-[10px] tabular-nums bg-primary/15 text-primary border-0"
            >
              {activeCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="mb-4">
          <SheetTitle className="flex items-center justify-between">
            <span>Filtros avanzados</span>
            {activeCount > 0 && (
              <button
                type="button"
                onClick={onClear}
                className="text-xs font-normal text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <X className="h-3 w-3" /> Limpiar ({activeCount})
              </button>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-5">
          {/* Cliente */}
          <FilterBlock label="Cliente" cleared={!filters.clientId}>
            <Input
              placeholder="Buscar cliente..."
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              className="h-8 text-xs mb-2"
            />
            <div className="max-h-44 overflow-y-auto rounded-md border border-border/60">
              <button
                type="button"
                onClick={() => update({ clientId: null })}
                className={cn(
                  "block w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted",
                  !filters.clientId && "bg-primary/10 text-primary",
                )}
              >
                Todos los clientes
              </button>
              {filteredClients.slice(0, 50).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => update({ clientId: c.id })}
                  className={cn(
                    "block w-full text-left px-2.5 py-1.5 text-xs truncate hover:bg-muted",
                    filters.clientId === c.id && "bg-primary/10 text-primary font-medium",
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </FilterBlock>

          {/* Proyecto */}
          <FilterBlock label="Proyecto" cleared={!filters.projectId}>
            <Input
              placeholder="Buscar proyecto..."
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
              className="h-8 text-xs mb-2"
            />
            <div className="max-h-44 overflow-y-auto rounded-md border border-border/60">
              <button
                type="button"
                onClick={() => update({ projectId: null })}
                className={cn(
                  "block w-full text-left px-2.5 py-1.5 text-xs hover:bg-muted",
                  !filters.projectId && "bg-primary/10 text-primary",
                )}
              >
                Todos los proyectos
              </button>
              {filteredProjects.slice(0, 50).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => update({ projectId: p.id })}
                  className={cn(
                    "block w-full text-left px-2.5 py-1.5 text-xs truncate hover:bg-muted",
                    filters.projectId === p.id && "bg-primary/10 text-primary font-medium",
                  )}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </FilterBlock>

          {/* Asignado */}
          <FilterBlock label="Asignado a" cleared={!filters.assignedTo}>
            <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pr-1">
              <button
                type="button"
                onClick={() => update({ assignedTo: null })}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-xs text-left",
                  !filters.assignedTo
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/60 text-muted-foreground hover:bg-muted",
                )}
              >
                Cualquiera
              </button>
              {profiles.map((p) => (
                <button
                  key={p.user_id}
                  type="button"
                  onClick={() => update({ assignedTo: p.user_id })}
                  className={cn(
                    "rounded-md border px-2 py-1.5 text-xs text-left truncate",
                    filters.assignedTo === p.user_id
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border/60 text-muted-foreground hover:bg-muted",
                  )}
                >
                  {p.full_name || p.email}
                </button>
              ))}
            </div>
          </FilterBlock>

          {/* Área */}
          <FilterBlock label="Área / Célula" cleared={!filters.area}>
            <Select
              value={filters.area ?? "todas"}
              onValueChange={(v) => update({ area: v === "todas" ? null : v })}
            >
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Todas las áreas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las áreas</SelectItem>
                {areaOptions.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterBlock>

          {/* Prioridad */}
          <FilterBlock label="Prioridad" cleared={!filters.priority}>
            <div className="flex flex-wrap gap-1.5">
              {[
                { value: "urgente", label: "Urgente", color: "border-destructive/40 text-destructive" },
                { value: "alta", label: "Alta", color: "border-amber-500/40 text-amber-600 dark:text-amber-400" },
                { value: "media", label: "Media", color: "border-sky-500/40 text-sky-600 dark:text-sky-400" },
                { value: "baja", label: "Baja", color: "border-muted-foreground/40 text-muted-foreground" },
              ].map((p) => {
                const active = filters.priority === p.value;
                return (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => update({ priority: active ? null : p.value })}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                      active ? p.color + " bg-current/10" : "border-border/60 text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
          </FilterBlock>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FilterBlock({
  label,
  cleared,
  children,
}: {
  label: string;
  cleared: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {!cleared && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
      </div>
      {children}
    </div>
  );
}
