import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { PageHeader, type PageHeaderStat } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Scale, Calendar, AlertTriangle, Clock, Gavel, Search } from "lucide-react";
import { isPast, isToday, isBefore, addDays } from "date-fns";
import { formatMX } from "@/lib/dateUtils";
import { useProfiles } from "@/hooks/useTasks";
import {
  useLitigationAgenda,
  type LitigioAgendaItem,
} from "@/hooks/useLitigationAgenda";
import {
  LAWSUIT_TYPES,
  LAWSUIT_TYPE_LABELS,
  LAWSUIT_JURISDICTIONS,
  DEADLINE_TYPE_LABELS,
  getJurisdictionLabel,
  getInstanciaLabel,
} from "@/lib/lawsuitStageCatalog";

const ALL = "all";

export default function Litigio() {
  const navigate = useNavigate();
  const { cases, agendaItems, isLoading } = useLitigationAgenda();
  const { data: profiles = [] } = useProfiles();

  const profileMap = useMemo(
    () => new Map(profiles.map((p) => [p.user_id, p])),
    [profiles],
  );

  const [search, setSearch] = useState("");
  const [ramaFilter, setRamaFilter] = useState(ALL);
  const [materiaFilter, setMateriaFilter] = useState(ALL);
  const [responsableFilter, setResponsableFilter] = useState(ALL);

  // Responsables que aparecen en algún juicio (para el filtro).
  const responsableOptions = useMemo(() => {
    const ids = new Set<string>();
    cases.forEach((c) => c.responsibleUserId && ids.add(c.responsibleUserId));
    return [...ids]
      .map((id) => ({ id, name: profileMap.get(id)?.full_name || "Sin nombre" }))
      .sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [cases, profileMap]);

  const matchesFilters = (
    item: { jurisdiction: string | null; materia: string; responsibleUserId?: string | null; assigned_to?: string | null },
    text: string,
  ) => {
    if (ramaFilter !== ALL && item.jurisdiction !== ramaFilter) return false;
    if (materiaFilter !== ALL && item.materia !== materiaFilter) return false;
    if (responsableFilter !== ALL) {
      const owner = item.assigned_to || item.responsibleUserId;
      if (owner !== responsableFilter) return false;
    }
    if (search.trim() && !text.toLowerCase().includes(search.trim().toLowerCase())) return false;
    return true;
  };

  // Términos/audiencias pendientes que pasan filtros.
  const pendingItems = useMemo(() => {
    return agendaItems
      .filter((it) => !it.completed && it.date)
      .filter((it) =>
        matchesFilters(it, `${it.title} ${it.projectName} ${it.clientName ?? ""}`),
      )
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agendaItems, ramaFilter, materiaFilter, responsableFilter, search]);

  const now = new Date();
  const in7 = addDays(now, 7);

  const buckets = useMemo(() => {
    const vencidos: LitigioAgendaItem[] = [];
    const hoy: LitigioAgendaItem[] = [];
    const semana: LitigioAgendaItem[] = [];
    const proximos: LitigioAgendaItem[] = [];
    for (const it of pendingItems) {
      const d = new Date(it.date);
      if (isToday(d)) hoy.push(it);
      else if (isPast(d)) vencidos.push(it);
      else if (isBefore(d, in7) || +d === +in7) semana.push(it);
      else proximos.push(it);
    }
    return { vencidos, hoy, semana, proximos };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingItems]);

  const activeCases = cases.filter((c) => c.status === "activo");

  const stats: Array<PageHeaderStat | null> = [
    { label: "Juicios activos", value: activeCases.length, tone: "primary" },
    { label: "Vencidos", value: buckets.vencidos.length, tone: buckets.vencidos.length > 0 ? "warning" : "default" },
    { label: "Hoy", value: buckets.hoy.length, tone: buckets.hoy.length > 0 ? "warning" : "default" },
    { label: "Esta semana", value: buckets.semana.length, tone: "default" },
  ];

  const goToCase = (projectId: string) => navigate(`/proyectos/${projectId}?tab=juicio`);

  const AgendaRow = ({ it }: { it: LitigioAgendaItem }) => {
    const d = new Date(it.date);
    const overdue = isPast(d) && !isToday(d);
    const urgent = !overdue && isBefore(d, addDays(now, 3));
    const owner = it.assigned_to || it.responsibleUserId;
    const ownerProfile = owner ? profileMap.get(owner) : undefined;
    return (
      <button
        onClick={() => goToCase(it.projectId)}
        className={`w-full text-left rounded-md border px-3 py-2.5 hover:bg-muted/50 transition-colors ${
          overdue ? "border-destructive/60 bg-destructive/5" : urgent ? "border-yellow-500/60 bg-yellow-50 dark:bg-yellow-900/10" : "border-border/60"
        }`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{it.title}</span>
          <Badge variant="outline" className="text-[10px]">
            {DEADLINE_TYPE_LABELS[it.type] || it.type}
          </Badge>
          {it.jurisdiction && (
            <Badge variant="secondary" className="text-[10px]">{getJurisdictionLabel(it.jurisdiction)}</Badge>
          )}
          <span className={`ml-auto text-xs flex items-center gap-1 ${overdue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
            {overdue ? <AlertTriangle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
            {formatMX(d, "dd MMM yyyy")}{it.time ? ` · ${it.time}` : ""}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
          <Gavel className="h-3 w-3 shrink-0" />
          <span className="truncate">{it.projectName}</span>
          {it.clientName && <span className="shrink-0">· {it.clientName}</span>}
          {ownerProfile && (
            <span className="ml-auto flex items-center gap-1 shrink-0">
              <UserAvatar name={ownerProfile.full_name} avatarUrl={ownerProfile.avatar_url} size="xs" />
              {ownerProfile.full_name}
            </span>
          )}
        </div>
      </button>
    );
  };

  const Section = ({ title, items, tone }: { title: string; items: LitigioAgendaItem[]; tone?: "danger" | "warning" }) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-2">
        <h3 className={`text-sm font-medium flex items-center gap-2 ${tone === "danger" ? "text-destructive" : tone === "warning" ? "text-yellow-700 dark:text-yellow-500" : "text-muted-foreground"}`}>
          {title} <span className="text-xs font-normal">({items.length})</span>
        </h3>
        <div className="space-y-1.5">
          {items.map((it) => <AgendaRow key={`${it.projectId}_${it.id}`} it={it} />)}
        </div>
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <PageHeader
          variant="hero"
          title="Litigio"
          description="Agenda de audiencias y términos de todos los juicios, por rama y responsable."
          icon={<Scale className="h-6 w-6" />}
          breadcrumb={["Kawiil OS", "Trabajo", "Litigio"]}
          stats={stats}
        />

        {/* Filtros */}
        <Card>
          <CardContent className="p-3 flex flex-col md:flex-row gap-2 md:items-center">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8 h-9"
                placeholder="Buscar por término, juicio o cliente..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={ramaFilter} onValueChange={setRamaFilter}>
              <SelectTrigger className="w-full md:w-[180px] h-9"><SelectValue placeholder="Rama" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas las ramas</SelectItem>
                {LAWSUIT_JURISDICTIONS.map((j) => <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={materiaFilter} onValueChange={setMateriaFilter}>
              <SelectTrigger className="w-full md:w-[160px] h-9"><SelectValue placeholder="Materia" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas las materias</SelectItem>
                {LAWSUIT_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={responsableFilter} onValueChange={setResponsableFilter}>
              <SelectTrigger className="w-full md:w-[180px] h-9"><SelectValue placeholder="Responsable" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos los responsables</SelectItem>
                {responsableOptions.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Agenda */}
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-5">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">Agenda procesal</h2>
            </div>
            {isLoading ? (
              <p className="text-sm text-muted-foreground py-8 text-center">Cargando...</p>
            ) : pendingItems.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-lg">
                Sin términos ni audiencias pendientes con los filtros actuales.
              </p>
            ) : (
              <div className="space-y-5">
                <Section title="Vencidos" items={buckets.vencidos} tone="danger" />
                <Section title="Hoy" items={buckets.hoy} tone="warning" />
                <Section title="Esta semana" items={buckets.semana} />
                <Section title="Próximos" items={buckets.proximos} />
              </div>
            )}
          </div>

          {/* Juicios activos */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Gavel className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-base font-semibold">Juicios activos</h2>
            </div>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground">
                  {activeCases.length} expediente(s)
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 max-h-[560px] overflow-y-auto">
                {activeCases.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">Sin juicios activos.</p>
                ) : (
                  activeCases
                    .filter((c) => matchesFilters(c, `${c.name} ${c.clientName ?? ""}`))
                    .map((c) => {
                      const owner = c.responsibleUserId ? profileMap.get(c.responsibleUserId) : undefined;
                      const nextDeadline = agendaItems
                        .filter((it) => it.projectId === c.id && !it.completed && it.date)
                        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];
                      return (
                        <button
                          key={c.id}
                          onClick={() => goToCase(c.id)}
                          className="w-full text-left rounded-md border border-border/60 px-3 py-2 hover:bg-muted/50 transition-colors"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium truncate">{c.name}</span>
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap text-[11px] text-muted-foreground">
                            {c.jurisdiction && <Badge variant="secondary" className="text-[10px]">{getJurisdictionLabel(c.jurisdiction)}</Badge>}
                            {c.materia && <Badge variant="outline" className="text-[10px]">{LAWSUIT_TYPE_LABELS[c.materia] || c.materia}</Badge>}
                            <span>{getInstanciaLabel(c.instancia)}</span>
                            <span className="ml-auto">{c.stagesDone}/{c.stagesTotal} etapas</span>
                          </div>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            {owner && (
                              <span className="flex items-center gap-1">
                                <UserAvatar name={owner.full_name} avatarUrl={owner.avatar_url} size="xs" />
                                {owner.full_name}
                              </span>
                            )}
                            {nextDeadline && (
                              <span className={`ml-auto flex items-center gap-1 ${isPast(new Date(nextDeadline.date)) && !isToday(new Date(nextDeadline.date)) ? "text-destructive" : ""}`}>
                                <Clock className="h-3 w-3" /> {formatMX(new Date(nextDeadline.date), "dd MMM")}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
