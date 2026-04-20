import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { leadMatchesPipelineSearch } from "@/lib/pipelineSearch";
import {
  usePipelineStages,
  usePipelineLeads,
  downloadLeadsCsv,
  type Lead,
} from "@/hooks/usePipeline";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Flame, Download, Filter, X } from "lucide-react";
import {
  formatMxnShort,
  flagForCountry,
  relativeTime,
  initialsFromName,
  avatarBgFromName,
  scoreDotColor,
  stageBadgeStyle,
} from "@/lib/pipelineFormat";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type PillFilter = "all" | "hot" | "risk";

function FilterPill({
  active,
  onClick,
  children,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  tone: "primary" | "hot" | "warning";
}) {
  const activeCls =
    tone === "hot"
      ? "bg-orange-500 text-white"
      : tone === "warning"
        ? "bg-amber-500 text-white"
        : "bg-foreground text-background";
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        active
          ? activeCls
          : "border-border/60 bg-card text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      )}
    >
      {children}
      {typeof count === "number" ? (
        <span
          className={cn(
            "inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums leading-[16px]",
            active ? "bg-white/25" : "bg-muted/70",
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}

export default function PipelineList() {
  const { data: stages = [], isLoading: sl } = usePipelineStages();
  const { data: leads = [], isLoading: ll } = usePipelineLeads(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get("q") ?? "";

  const [pill, setPill] = useState<PillFilter>(
    searchParams.get("filter") === "stale" ? "risk" : "all",
  );
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  // Filtros "Más filtros"
  const [priority, setPriority] = useState<string>("all");
  const [urgencyFilter, setUrgencyFilter] = useState<string>("all");
  const [visaFilter, setVisaFilter] = useState<string>("all");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s] as const)), [stages]);
  const stageName = (id: string) => stageById.get(id)?.name ?? "—";

  const clearSearchParam = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("q");
    setSearchParams(next, { replace: true });
  };

  const countryOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const l of leads) {
      const code = (l.country_code || l.country_name || "").toUpperCase();
      if (!code) continue;
      set.set(code, l.country_name || code);
    }
    return Array.from(set.entries()).sort((a, b) => a[1].localeCompare(b[1], "es"));
  }, [leads]);

  const filtered = useMemo(() => {
    let rows: Lead[] = leads.filter((l) => leadMatchesPipelineSearch(l, q));
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    if (pill === "hot") {
      rows = rows.filter((l) => {
        const urgency = (l as Record<string, unknown>).urgency as string | undefined;
        return (
          urgency === "immediate" ||
          l.priority === "urgent" ||
          l.priority === "high" ||
          (l.score ?? 0) >= 80
        );
      });
    } else if (pill === "risk") {
      rows = rows.filter((l) => {
        const stage = stageById.get(l.stage_id);
        if (stage?.is_terminal) return false;
        const last = (l as Record<string, unknown>).last_activity_at as string | null | undefined;
        if (!last) return true;
        return new Date(last).getTime() < sevenDaysAgo;
      });
    }

    if (stageFilter !== "all") rows = rows.filter((l) => l.stage_id === stageFilter);
    if (countryFilter !== "all") {
      rows = rows.filter(
        (l) => (l.country_code || l.country_name || "").toUpperCase() === countryFilter,
      );
    }
    if (priority !== "all") rows = rows.filter((l) => l.priority === priority);
    if (urgencyFilter !== "all") {
      rows = rows.filter(
        (l) => ((l as Record<string, unknown>).urgency as string | undefined) === urgencyFilter,
      );
    }
    if (visaFilter !== "all") {
      rows = rows.filter((l) => {
        const needs = (l as Record<string, unknown>).needs_visa as boolean | null | undefined;
        return visaFilter === "yes" ? needs === true : needs !== true;
      });
    }
    return rows;
  }, [leads, q, pill, stageById, stageFilter, countryFilter, priority, urgencyFilter, visaFilter]);

  const counts = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return {
      all: leads.length,
      hot: leads.filter((l) => {
        const urgency = (l as Record<string, unknown>).urgency as string | undefined;
        return (
          urgency === "immediate" ||
          l.priority === "urgent" ||
          l.priority === "high" ||
          (l.score ?? 0) >= 80
        );
      }).length,
      risk: leads.filter((l) => {
        const stage = stageById.get(l.stage_id);
        if (stage?.is_terminal) return false;
        const last = (l as Record<string, unknown>).last_activity_at as string | null | undefined;
        if (!last) return true;
        return new Date(last).getTime() < sevenDaysAgo;
      }).length,
    };
  }, [leads, stageById]);

  const handleExport = () => {
    if (filtered.length === 0) {
      toast.info("Nada que exportar con estos filtros");
      return;
    }
    try {
      downloadLeadsCsv(filtered, stageName);
      toast.success(`Exportados ${filtered.length} leads`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo exportar");
    }
  };

  const activeAdvancedCount =
    (priority !== "all" ? 1 : 0) + (urgencyFilter !== "all" ? 1 : 0) + (visaFilter !== "all" ? 1 : 0);

  if (sl || ll) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterPill active={pill === "all"} onClick={() => setPill("all")} count={counts.all} tone="primary">
            Todos
          </FilterPill>
          <FilterPill active={pill === "hot"} onClick={() => setPill("hot")} count={counts.hot} tone="hot">
            <Flame className="h-3 w-3" /> Calientes
          </FilterPill>
          <FilterPill active={pill === "risk"} onClick={() => setPill("risk")} count={counts.risk} tone="warning">
            En riesgo
          </FilterPill>

          <Select value={stageFilter} onValueChange={setStageFilter}>
            <SelectTrigger className="h-8 w-auto min-w-[140px] text-xs">
              <SelectValue placeholder="Por etapa" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las etapas</SelectItem>
              {stages.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={countryFilter} onValueChange={setCountryFilter}>
            <SelectTrigger className="h-8 w-auto min-w-[140px] text-xs">
              <SelectValue placeholder="Por país" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los países</SelectItem>
              {countryOptions.map(([code, name]) => (
                <SelectItem key={code} value={code}>
                  {flagForCountry(code)} {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Popover open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <PopoverTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 text-xs">
                <Filter className="h-3 w-3 mr-1" />
                Más filtros
                {activeAdvancedCount > 0 ? (
                  <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
                    {activeAdvancedCount}
                  </span>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3" align="start">
              <div>
                <Label className="text-xs">Prioridad</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="urgent">Urgente</SelectItem>
                    <SelectItem value="high">Alta</SelectItem>
                    <SelectItem value="medium">Media</SelectItem>
                    <SelectItem value="low">Baja</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Urgencia</Label>
                <Select value={urgencyFilter} onValueChange={setUrgencyFilter}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="immediate">Inmediata</SelectItem>
                    <SelectItem value="short_term">Corto plazo</SelectItem>
                    <SelectItem value="mid_term">Mediano plazo</SelectItem>
                    <SelectItem value="long_term">Largo plazo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Requiere visa</Label>
                <Select value={visaFilter} onValueChange={setVisaFilter}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="yes">Sí</SelectItem>
                    <SelectItem value="no">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {activeAdvancedCount > 0 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full text-xs"
                  onClick={() => {
                    setPriority("all");
                    setUrgencyFilter("all");
                    setVisaFilter("all");
                  }}
                >
                  <X className="h-3 w-3 mr-1" />
                  Limpiar filtros avanzados
                </Button>
              ) : null}
            </PopoverContent>
          </Popover>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleExport}>
            <Download className="h-3.5 w-3.5 mr-1" />
            Exportar CSV
          </Button>
        </div>
      </div>

      {q.trim() ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <p>
            Búsqueda activa: <strong>{q}</strong> · {filtered.length} resultado(s)
          </p>
          <Button size="sm" variant="ghost" onClick={clearSearchParam} className="h-6 text-xs">
            <X className="h-3 w-3 mr-1" /> Limpiar
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{filtered.length} lead(s)</p>
      )}

      {/* Tabla */}
      <div className="rounded-lg border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="uppercase text-[10px] tracking-[0.1em] text-muted-foreground">Lead</TableHead>
              <TableHead className="uppercase text-[10px] tracking-[0.1em] text-muted-foreground">Empresa</TableHead>
              <TableHead className="uppercase text-[10px] tracking-[0.1em] text-muted-foreground">Score</TableHead>
              <TableHead className="uppercase text-[10px] tracking-[0.1em] text-muted-foreground">Etapa</TableHead>
              <TableHead className="uppercase text-[10px] tracking-[0.1em] text-muted-foreground">Monto</TableHead>
              <TableHead className="uppercase text-[10px] tracking-[0.1em] text-muted-foreground">País</TableHead>
              <TableHead className="uppercase text-[10px] tracking-[0.1em] text-muted-foreground">Última actividad</TableHead>
              <TableHead className="uppercase text-[10px] tracking-[0.1em] text-muted-foreground">Campaña</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((l) => {
              const stage = stageById.get(l.stage_id);
              const any = l as Lead & { estimated_value?: number | null; last_activity_at?: string | null };
              const last = any.last_activity_at ?? (l as Record<string, unknown>).updated_at as string | undefined;
              return (
                <TableRow key={l.id} className="hover:bg-muted/40">
                  <TableCell>
                    <Link to={`/pipeline/leads/${l.id}`} className="inline-flex items-center gap-2 group">
                      <span
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                        style={{ backgroundColor: avatarBgFromName(l.full_name) }}
                        aria-hidden
                      >
                        {initialsFromName(l.full_name)}
                      </span>
                      <span className="font-semibold group-hover:underline">{l.full_name}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{l.company_name || "—"}</TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold tabular-nums">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: scoreDotColor(l.score) }}
                        aria-hidden
                      />
                      {l.score ?? 0}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                      style={stageBadgeStyle(stage)}
                    >
                      {stage?.name ?? "—"}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm tabular-nums font-semibold">
                    {any.estimated_value
                      ? `${formatMxnShort(Number(any.estimated_value))} MXN`
                      : <span className="text-muted-foreground font-normal">—</span>}
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden>{flagForCountry(l.country_code)}</span>
                      <span className="text-muted-foreground">{l.country_name || l.country_code || "—"}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{relativeTime(last)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                    {l.campaign_name || "—"}
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">
                  Sin leads que cumplan con los filtros.
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
