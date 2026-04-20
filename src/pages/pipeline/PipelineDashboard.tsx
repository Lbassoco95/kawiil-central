import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  usePipelineStats,
  usePipelineStages,
  usePipelineLeads,
  useCreateLead,
  useLeadActivitiesFeed,
  aggregateStageValues,
  type Lead,
  type LeadActivityFeedItem,
} from "@/hooks/usePipeline";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plus,
  Settings as SettingsIcon,
  Flame,
  AlertTriangle,
  Target,
  Lightbulb,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Mail,
  Phone,
  MoveRight,
  UserPlus,
  StickyNote,
  Calendar,
  MessageCircle,
  Activity as ActivityIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  formatMxn,
  formatMxnShort,
  flagForCountry,
  relativeTime,
  initialsFromName,
  avatarBgFromName,
  scoreDotColor,
} from "@/lib/pipelineFormat";

interface KpiTileProps {
  label: string;
  value: string;
  delta?: { value: string; direction: "up" | "down" | "flat" };
  spark?: number[];
  tone?: "default" | "primary" | "success" | "destructive" | "warning";
}

const TONE_DELTA: Record<NonNullable<KpiTileProps["tone"]>, string> = {
  default: "text-muted-foreground",
  primary: "text-primary",
  success: "text-emerald-600",
  destructive: "text-destructive",
  warning: "text-amber-600",
};

function Sparkline({ values, tone }: { values: number[]; tone: NonNullable<KpiTileProps["tone"]> }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const w = 80;
  const h = 22;
  const step = w / (values.length - 1);
  const pts = values
    .map((v, i) => `${i * step},${h - ((v - min) / range) * h}`)
    .join(" ");
  const stroke =
    tone === "success"
      ? "hsl(var(--success, 142 76% 36%))"
      : tone === "destructive"
        ? "hsl(var(--destructive))"
        : tone === "warning"
          ? "hsl(var(--warning, 38 92% 50%))"
          : tone === "primary"
            ? "hsl(var(--primary))"
            : "hsl(var(--muted-foreground) / 0.6)";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="opacity-80">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KpiTile({ label, value, delta, spark, tone = "default" }: KpiTileProps) {
  const Arrow =
    delta?.direction === "up" ? TrendingUp : delta?.direction === "down" ? TrendingDown : Minus;
  return (
    <div className="rounded-2xl border border-border/60 bg-card px-4 py-3 shadow-sm">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className="text-2xl font-bold tabular-nums text-foreground leading-none">{value}</p>
        {spark && spark.length >= 2 ? <Sparkline values={spark} tone={tone} /> : null}
      </div>
      {delta ? (
        <p className={`mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium ${TONE_DELTA[tone]}`}>
          <Arrow className="h-3 w-3" />
          {delta.value}
        </p>
      ) : null}
    </div>
  );
}

interface AlertCardProps {
  tone: "destructive" | "success" | "warning";
  eyebrow: string;
  body: React.ReactNode;
  ctaLabel: string;
  to?: string;
  onClick?: () => void;
}

function AlertCard({ tone, eyebrow, body, ctaLabel, to, onClick }: AlertCardProps) {
  const accent =
    tone === "destructive"
      ? { bar: "hsl(var(--destructive))", icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/5" }
      : tone === "success"
        ? { bar: "hsl(142 76% 36%)", icon: Target, color: "text-emerald-600", bg: "bg-emerald-500/5" }
        : { bar: "hsl(38 92% 50%)", icon: Lightbulb, color: "text-amber-600", bg: "bg-amber-500/5" };
  const Icon = accent.icon;
  const cta = (
    <span className={`mt-2 inline-flex items-center gap-1 text-xs font-semibold ${accent.color} hover:underline`}>
      {ctaLabel} <ArrowRight className="h-3 w-3" />
    </span>
  );
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-border/60 ${accent.bg} px-4 py-3 shadow-sm`}
    >
      <span aria-hidden className="absolute left-0 top-0 h-full w-1 rounded-l-2xl" style={{ background: accent.bar }} />
      <div className="pl-2">
        <div className={`inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] ${accent.color}`}>
          <Icon className="h-3 w-3" />
          {eyebrow}
        </div>
        <div className="mt-1.5 text-sm leading-relaxed text-foreground">{body}</div>
        {to ? (
          <Link to={to} className="block">
            {cta}
          </Link>
        ) : (
          <button type="button" onClick={onClick} className="block text-left">
            {cta}
          </button>
        )}
      </div>
    </div>
  );
}

function NewLeadDialog() {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const createLead = useCreateLead();
  const { data: stages = [] } = usePipelineStages();
  const firstStage = stages.find((s) => !s.is_terminal) ?? stages[0];

  const handleCreate = async () => {
    if (!fullName.trim() || !firstStage) {
      toast.error("Falta nombre o no hay etapas configuradas");
      return;
    }
    try {
      await createLead.mutateAsync({
        full_name: fullName.trim(),
        company_name: company.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
        stage_id: firstStage.id,
        is_active: true,
        priority: "medium",
        score: 0,
      } as Parameters<typeof createLead.mutateAsync>[0]);
      toast.success("Lead creado");
      setOpen(false);
      setFullName("");
      setCompany("");
      setEmail("");
      setPhone("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo crear el lead");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-white/95 text-primary hover:bg-white border-0 shadow-sm font-semibold">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Nuevo lead
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crear lead</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="lead-full-name">Nombre completo *</Label>
            <Input id="lead-full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lead-company">Empresa</Label>
            <Input id="lead-company" value={company} onChange={(e) => setCompany(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="lead-email">Email</Label>
              <Input id="lead-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lead-phone">Teléfono</Label>
              <Input id="lead-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button onClick={handleCreate} disabled={createLead.isPending || !fullName.trim()}>
            Crear
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Hot leads card ──────────────────────────────────────────────────────────

function Top5HotLeadsCard({ leads, stageNameById }: { leads: Lead[]; stageNameById: (id: string) => string }) {
  const hot = useMemo(() => {
    return [...leads]
      .filter((l) => {
        const urgency = (l as Record<string, unknown>).urgency as string | undefined;
        const isUrgent = urgency === "immediate" || l.priority === "urgent" || l.priority === "high";
        return isUrgent || (l.score ?? 0) >= 80;
      })
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 5);
  }, [leads]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold inline-flex items-center gap-2">
          <Flame className="h-4 w-4 text-orange-500" />
          Top 5 calientes
        </CardTitle>
        <p className="text-xs text-muted-foreground font-normal">Score IA + actividad reciente</p>
      </CardHeader>
      <CardContent className="pt-0">
        {hot.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Sin leads calientes por ahora.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {hot.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-2.5">
                <span
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ backgroundColor: avatarBgFromName(l.full_name) }}
                  aria-hidden
                >
                  {initialsFromName(l.full_name)}
                </span>
                <Link
                  to={`/pipeline/leads/${l.id}`}
                  className="min-w-0 flex-1 group"
                >
                  <p className="truncate text-sm font-semibold group-hover:underline">{l.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[l.country_name ?? l.country_code, stageNameById(l.stage_id)].filter(Boolean).join(" · ")}
                  </p>
                </Link>
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] font-semibold tabular-nums"
                  style={{ color: scoreDotColor(l.score) }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: scoreDotColor(l.score) }} aria-hidden />
                  {l.score ?? 0}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Countries card ──────────────────────────────────────────────────────────

function LeadsByCountryCard({ leads }: { leads: Lead[] }) {
  const rows = useMemo(() => {
    const map = new Map<string, { name: string; code: string; count: number }>();
    for (const l of leads) {
      const code = l.country_code || l.country_name || "??";
      const name = l.country_name || l.country_code || "Otro";
      const key = code.toUpperCase();
      const entry = map.get(key) ?? { name, code: key, count: 0 };
      entry.count += 1;
      map.set(key, entry);
    }
    return Array.from(map.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [leads]);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold inline-flex items-center gap-2">
          <span aria-hidden>🌎</span>
          Origen por país
        </CardTitle>
        <p className="text-xs text-muted-foreground font-normal">Leads activos por origen geográfico</p>
      </CardHeader>
      <CardContent className="pt-0">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Sin datos de país aún.</p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li key={r.code} className="flex items-center gap-2">
                <span className="w-[120px] shrink-0 truncate text-xs text-muted-foreground">
                  <span className="mr-1.5" aria-hidden>{flagForCountry(r.code)}</span>
                  {r.name}
                </span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary/80 transition-all"
                    style={{ width: `${(r.count / max) * 100}%` }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums">{r.count}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Activity feed card ──────────────────────────────────────────────────────

const ACTIVITY_ICON: Record<string, typeof Mail> = {
  email_sent: Mail,
  email_received: Mail,
  email_reply: Mail,
  call_logged: Phone,
  call: Phone,
  whatsapp: MessageCircle,
  stage_change: MoveRight,
  lead_created: UserPlus,
  note_added: StickyNote,
  meeting_scheduled: Calendar,
};

function describeActivity(item: LeadActivityFeedItem): string {
  const name = item.lead?.full_name || "Lead";
  switch (item.type) {
    case "email_reply":
      return `${name} respondió tu correo`;
    case "email_received":
      return `${name} te escribió`;
    case "email_sent":
      return `Enviaste correo a ${name}`;
    case "call_logged":
    case "call":
      return `Llamada con ${name}`;
    case "whatsapp":
      return `WhatsApp con ${name}`;
    case "stage_change":
      return `${name} cambió de etapa`;
    case "lead_created":
      return `Nuevo lead: ${name}`;
    case "note_added":
      return `Nota en ${name}`;
    case "meeting_scheduled":
      return `Reunión agendada con ${name}`;
    default:
      return `${name} · ${item.type.replace(/_/g, " ")}`;
  }
}

function RecentActivityCard() {
  const { data: feed = [], isLoading } = useLeadActivitiesFeed(10);
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold inline-flex items-center gap-2">
          <ActivityIcon className="h-4 w-4 text-primary" />
          Actividad reciente
        </CardTitle>
        <p className="text-xs text-muted-foreground font-normal">Últimos eventos del pipeline</p>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : feed.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Sin actividad reciente.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {feed.map((item) => {
              const Icon = ACTIVITY_ICON[item.type] ?? ActivityIcon;
              return (
                <li key={item.id} className="flex items-start gap-3 py-2.5">
                  <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <Link
                    to={`/pipeline/leads/${item.lead_id}`}
                    className="min-w-0 flex-1 group"
                  >
                    <p className="text-sm leading-tight group-hover:underline">
                      {describeActivity(item)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{relativeTime(item.created_at)}</p>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Probabilidades por slug ─────────────────────────────────────────────────

const STAGE_PROBABILITY: Record<string, number> = {
  registrado: 0.1,
  contactado: 0.25,
  calificado: 0.4,
  propuesta: 0.55,
  negociacion: 0.7,
  convertido: 1,
  frio: 0.05,
  perdido: 0,
};

export default function PipelineDashboard() {
  const navigate = useNavigate();
  const { data: stats, isLoading: statsLoading } = usePipelineStats(null, null);
  const { data: stages = [], isLoading: stagesLoading } = usePipelineStages();
  const { data: leads = [], isLoading: leadsLoading } = usePipelineLeads(true);

  const isLoading = statsLoading || stagesLoading || leadsLoading;

  const stageAgg = useMemo(() => aggregateStageValues(leads), [leads]);
  const stageById = useMemo(() => new Map(stages.map((s) => [s.id, s] as const)), [stages]);
  const stageNameById = (id: string) => stageById.get(id)?.name ?? "—";

  // ─── Hero KPIs ───────────────────────────────────────────────
  const heroKpis = useMemo(() => {
    const active = leads.length;
    const calientes = leads.filter((l) => {
      const urgency = (l as Record<string, unknown>).urgency as string | undefined;
      return urgency === "immediate" || l.priority === "urgent" || l.priority === "high";
    }).length;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const inActiveStage = leads.filter((l) => {
      const stage = stageById.get(l.stage_id);
      return stage && !stage.is_terminal;
    });
    const fresh = inActiveStage.filter((l) => {
      const last = (l as Record<string, unknown>).last_activity_at as string | null | undefined;
      if (!last) return false;
      return new Date(last).getTime() >= sevenDaysAgo;
    }).length;
    const salud = inActiveStage.length > 0 ? Math.round((fresh / inActiveStage.length) * 100) : 0;
    const pipelineMxn = leads.reduce((acc, l) => {
      const stage = stageById.get(l.stage_id);
      if (!stage || stage.is_terminal) return acc;
      const v = (l as Lead & { estimated_value?: number | null }).estimated_value;
      return acc + (v ? Number(v) : 0);
    }, 0);
    return { active, calientes, salud, pipelineMxn };
  }, [leads, stageById]);

  // ─── Alert cards ─────────────────────────────────────────────
  const alerts = useMemo(() => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const staleHot = leads.filter((l) => {
      const stage = stageById.get(l.stage_id);
      if (stage?.is_terminal) return false;
      const last = (l as Record<string, unknown>).last_activity_at as string | null | undefined;
      if (!last) return true;
      const isHot =
        (l as Record<string, unknown>).urgency === "immediate" ||
        l.priority === "urgent" ||
        l.priority === "high";
      return isHot && new Date(last).getTime() < sevenDaysAgo;
    });
    const staleHotExample = staleHot[0];

    const responded = leads.filter((l) => {
      const updated = (l as Record<string, unknown>).updated_at as string | undefined;
      if (!updated) return false;
      const last24h = Date.now() - 24 * 60 * 60 * 1000;
      const stage = stageById.get(l.stage_id);
      return new Date(updated).getTime() >= last24h && !stage?.is_terminal && (l.score ?? 0) >= 50;
    });
    const opportunity = responded[0];

    const sequenceCandidates = leads.filter((l) => {
      const stage = stageById.get(l.stage_id);
      const slug = stage?.slug;
      return slug === "registrado" || slug === "contactado";
    });

    return { staleHot, staleHotExample, opportunity, sequenceCandidates };
  }, [leads, stageById]);

  // ─── KPI tiles ───────────────────────────────────────────────
  const kpiTiles = useMemo<KpiTileProps[]>(() => {
    const newLeads = Number(stats?.new_leads ?? 0);
    const emailReply = (stats?.email_reply as Record<string, unknown> | undefined) ?? {};
    const replyRate = Number(emailReply.reply_rate ?? 0);
    const histogram = (Array.isArray(emailReply.histogram) ? emailReply.histogram : []) as Array<{
      label?: string;
      count?: number;
    }>;
    const sparkReplies = histogram.map((h) => Number(h.count) || 0);

    // Tasa de cierre: convertidos / total (mismo cálculo que antes pero por slug).
    const convertidoStage = stages.find((s) => s.slug === "convertido");
    const convertidos = convertidoStage
      ? leads.filter((l) => l.stage_id === convertidoStage.id).length
      : 0;
    const closeRate = leads.length > 0 ? convertidos / leads.length : 0;

    // Ciclo promedio: días entre created_at y updated_at de leads en "convertido".
    const closedLeads = convertidoStage
      ? leads.filter((l) => l.stage_id === convertidoStage.id)
      : [];
    let avgCycle = 0;
    if (closedLeads.length > 0) {
      const totalDays = closedLeads.reduce((acc, l) => {
        const created = new Date(l.created_at).getTime();
        const updated = new Date((l as Record<string, unknown>).updated_at as string).getTime();
        if (!Number.isFinite(created) || !Number.isFinite(updated)) return acc;
        return acc + Math.max(0, (updated - created) / (24 * 60 * 60 * 1000));
      }, 0);
      avgCycle = totalDays / closedLeads.length;
    }

    // Ingresos proyectados: suma de estimated_value × probabilidad por etapa (solo etapas activas).
    const projected = leads.reduce((acc, l) => {
      const stage = stageById.get(l.stage_id);
      if (!stage || stage.is_terminal) return acc;
      const prob = STAGE_PROBABILITY[stage.slug] ?? 0;
      const v = (l as Lead & { estimated_value?: number | null }).estimated_value;
      return acc + (v ? Number(v) * prob : 0);
    }, 0);

    return [
      {
        label: "Leads nuevos (30d)",
        value: newLeads.toLocaleString("es-MX"),
        delta:
          newLeads > 0
            ? { value: `${newLeads} en periodo`, direction: "up" }
            : { value: "sin cambios", direction: "flat" },
        tone: "success",
      },
      {
        label: "Tasa de respuesta",
        value: `${(replyRate * 100).toFixed(1)}%`,
        spark: sparkReplies,
        tone: "primary",
        delta:
          replyRate > 0
            ? { value: `${(replyRate * 100).toFixed(1)}% respuestas`, direction: "up" }
            : { value: "sin respuestas", direction: "flat" },
      },
      {
        label: "Tasa de cierre",
        value: `${(closeRate * 100).toFixed(1)}%`,
        tone: closeRate > 0 ? "success" : "default",
        delta:
          closeRate > 0
            ? { value: `${convertidos} convertidos`, direction: "up" }
            : { value: "sin cierres", direction: "flat" },
      },
      {
        label: "Ciclo promedio",
        value: avgCycle > 0 ? `${avgCycle.toFixed(0)}d` : "—",
        tone: avgCycle > 0 && avgCycle < 30 ? "success" : avgCycle >= 30 ? "warning" : "default",
        delta:
          avgCycle > 0
            ? { value: avgCycle < 30 ? "rápido" : "más de 30d", direction: avgCycle < 30 ? "up" : "down" }
            : { value: "sin cierres aún", direction: "flat" },
      },
      {
        label: "Ingresos proyectados",
        value: formatMxn(projected),
        tone: projected > 0 ? "success" : "default",
        delta:
          projected > 0
            ? { value: "según probabilidad", direction: "up" }
            : { value: "agrega montos", direction: "flat" },
      },
    ];
  }, [stats, stages, leads, stageById]);

  // ─── Funnel + Velocity (v2.5) ────────────────────────────────
  const funnelData = useMemo(() => {
    const activeStages = stages
      .filter((s) => !s.is_terminal)
      .sort((a, b) => a.position - b.position);
    return activeStages.map((s, idx) => {
      const count = stageAgg.get(s.id)?.count ?? 0;
      const prevCount = idx === 0 ? count : stageAgg.get(activeStages[idx - 1].id)?.count ?? 0;
      const passThrough = idx === 0 ? 100 : prevCount > 0 ? Math.round((count / prevCount) * 100) : 0;
      return { name: s.name, count, color: s.color, passThrough };
    });
  }, [stages, stageAgg]);
  const maxFunnel = Math.max(1, ...funnelData.map((f) => f.count));

  const velocityData = useMemo(() => {
    const activeStages = stages
      .filter((s) => !s.is_terminal)
      .sort((a, b) => a.position - b.position);
    const pairs: Array<{ label: string; days: number; color: string }> = [];
    for (let i = 0; i < activeStages.length - 1; i++) {
      const from = activeStages[i];
      const to = activeStages[i + 1];
      const inTarget = leads.filter((l) => l.stage_id === to.id);
      if (inTarget.length === 0) {
        pairs.push({ label: `${from.name} → ${to.name}`, days: 0, color: to.color });
        continue;
      }
      const totalDays = inTarget.reduce((acc, l) => {
        const created = new Date(l.created_at).getTime();
        const updated = new Date((l as Record<string, unknown>).updated_at as string).getTime();
        if (!Number.isFinite(created) || !Number.isFinite(updated)) return acc;
        return acc + Math.max(0, (updated - created) / (24 * 60 * 60 * 1000));
      }, 0);
      pairs.push({
        label: `${from.name} → ${to.name}`,
        days: totalDays / inTarget.length,
        color: to.color,
      });
    }
    return pairs;
  }, [stages, leads]);
  const maxVelocity = Math.max(1, ...velocityData.map((v) => v.days));
  const totalCycle = velocityData.reduce((acc, v) => acc + v.days, 0);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[180px] w-full" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-[120px]" />
          <Skeleton className="h-[120px]" />
          <Skeleton className="h-[120px]" />
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Hero ejecutivo: Sala de control comercial — paleta Kawiil AI v2.4 */}
      <header
        className="relative overflow-hidden rounded-2xl px-5 py-5 sm:px-7 sm:py-6 text-primary-foreground shadow-md"
        style={{
          background:
            "radial-gradient(ellipse 600px 220px at 0% 0%, hsl(200 100% 60% / 0.95), transparent 70%), " +
            "radial-gradient(ellipse 500px 180px at 100% 100%, hsl(220 100% 55% / 0.9), transparent 70%), " +
            "linear-gradient(135deg, hsl(200 100% 50%), hsl(220 100% 50%))",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent, transparent 18px, rgba(255,255,255,0.05) 18px, rgba(255,255,255,0.05) 36px)",
          }}
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
                Sala de control comercial
              </h1>
              <span className="rounded-full border border-white/40 bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                v2.5
              </span>
            </div>
            <p className="mt-1 text-sm sm:text-base text-white/85 max-w-2xl">
              Tu embudo, en vivo. Kawiil AI ya filtró lo urgente por ti.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/pipeline/settings")}
              className="border-white/30 bg-white/10 text-white hover:bg-white/20 backdrop-blur"
            >
              <SettingsIcon className="mr-1.5 h-3.5 w-3.5" />
              Tweaks
            </Button>
            <NewLeadDialog />
          </div>
        </div>

        {/* Hero KPIs */}
        <div className="relative mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-2xl sm:text-3xl font-bold text-white tabular-nums">
              {heroKpis.active.toLocaleString("es-MX")}
            </p>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/75 mt-0.5">
              Leads activos
            </p>
          </div>
          <div>
            <p className="text-2xl sm:text-3xl font-bold text-white tabular-nums">
              {formatMxnShort(heroKpis.pipelineMxn)}
            </p>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/75 mt-0.5">
              Pipeline MXN
            </p>
          </div>
          <div>
            <p className="text-2xl sm:text-3xl font-bold text-white tabular-nums inline-flex items-center gap-1.5">
              {heroKpis.calientes.toLocaleString("es-MX")}
              {heroKpis.calientes > 0 ? <Flame className="h-5 w-5 text-orange-300" /> : null}
            </p>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/75 mt-0.5">
              Calientes
            </p>
          </div>
          <div>
            <p className="text-2xl sm:text-3xl font-bold text-white tabular-nums">
              {heroKpis.salud}%
            </p>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/75 mt-0.5">
              Salud del embudo
            </p>
          </div>
        </div>
      </header>

      {/* 3 alert cards */}
      <div className="grid gap-3 md:grid-cols-3">
        {alerts.staleHot.length > 0 ? (
          <AlertCard
            tone="destructive"
            eyebrow="En riesgo"
            body={
              <>
                <strong>{alerts.staleHot.length} lead{alerts.staleHot.length === 1 ? "" : "s"} caliente{alerts.staleHot.length === 1 ? "" : "s"}</strong>{" "}
                lleva{alerts.staleHot.length === 1 ? "" : "n"} 7+ días sin respuesta.
                {alerts.staleHotExample ? (
                  <>
                    {" "}
                    {alerts.staleHotExample.full_name}
                    {alerts.staleHotExample.company_name ? ` (${alerts.staleHotExample.company_name})` : ""} es la prioridad.
                  </>
                ) : null}
              </>
            }
            ctaLabel="Ver leads en riesgo"
            to="/pipeline/list?filter=stale"
          />
        ) : (
          <AlertCard
            tone="success"
            eyebrow="Sin riesgos"
            body="Todos tus leads calientes tienen actividad en los últimos 7 días."
            ctaLabel="Ver tablero"
            to="/pipeline"
          />
        )}

        {alerts.opportunity ? (
          <AlertCard
            tone="success"
            eyebrow="Oportunidad"
            body={
              <>
                <strong>{alerts.opportunity.full_name}</strong> tuvo actividad reciente con score{" "}
                {alerts.opportunity.score ?? 0}. Llamar hoy mejora la probabilidad de cierre.
              </>
            }
            ctaLabel="Abrir lead"
            to={`/pipeline/leads/${alerts.opportunity.id}`}
          />
        ) : (
          <AlertCard
            tone="success"
            eyebrow="Oportunidad"
            body="Sin oportunidades destacadas en las últimas 24h. Revisa los leads con mayor score."
            ctaLabel="Ver lista"
            to="/pipeline/list"
          />
        )}

        {alerts.sequenceCandidates.length > 0 ? (
          <AlertCard
            tone="warning"
            eyebrow="Acción sugerida"
            body={
              <>
                <strong>{alerts.sequenceCandidates.length} lead{alerts.sequenceCandidates.length === 1 ? "" : "s"}</strong> en etapas tempranas listos para una secuencia de seguimiento.
              </>
            }
            ctaLabel="Ejecutar secuencia"
            to="/pipeline/sequences"
          />
        ) : (
          <AlertCard
            tone="warning"
            eyebrow="Acción sugerida"
            body="Sin candidatos para secuencias automáticas en este momento."
            ctaLabel="Ver plantillas"
            to="/pipeline/templates"
          />
        )}
      </div>

      {/* 5 KPI tiles */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
        {kpiTiles.map((k) => (
          <KpiTile key={k.label} {...k} />
        ))}
      </div>

      {/* Embudo + Velocidad */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Embudo de conversión</CardTitle>
            <p className="text-xs text-muted-foreground font-normal">Leads activos por etapa y tasa de paso</p>
          </CardHeader>
          <CardContent>
            {funnelData.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin etapas configuradas.</p>
            ) : (
              <div className="space-y-2">
                {funnelData.map((f, i) => (
                  <div key={f.name} className="flex items-center gap-3">
                    <span className="text-xs w-[140px] text-right shrink-0 truncate text-muted-foreground">{f.name}</span>
                    <div className="flex-1 h-7 relative">
                      <div
                        className="h-full rounded-md transition-all flex items-center justify-end pr-2.5"
                        style={{
                          width: `${Math.max(8, (f.count / maxFunnel) * 100)}%`,
                          backgroundColor: f.color,
                          opacity: 0.9,
                        }}
                      >
                        <span className="text-xs font-semibold text-white tabular-nums">{f.count}</span>
                      </div>
                    </div>
                    <span className="w-16 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
                      {i === 0 ? "100%" : `${f.passThrough}% →`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Velocidad por etapa</CardTitle>
            <p className="text-xs text-muted-foreground font-normal">Días promedio antes de avanzar</p>
          </CardHeader>
          <CardContent>
            {velocityData.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sin datos suficientes.</p>
            ) : (
              <>
                <div className="space-y-2">
                  {velocityData.map((v) => (
                    <div key={v.label} className="flex items-center gap-3">
                      <span className="text-xs w-[160px] text-right shrink-0 truncate text-muted-foreground">{v.label}</span>
                      <div className="flex-1 h-7 relative">
                        <div
                          className="h-full rounded-md transition-all flex items-center justify-end pr-2.5"
                          style={{
                            width: `${Math.max(8, (v.days / maxVelocity) * 100)}%`,
                            backgroundColor: v.color,
                            opacity: 0.85,
                          }}
                        >
                          <span className="text-xs font-semibold text-white tabular-nums">
                            {v.days >= 1 ? `${v.days.toFixed(1)}d` : "<1d"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex items-center justify-between rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    <ActivityIcon className="h-3 w-3" />
                    Ciclo total promedio
                  </span>
                  <span className="text-lg font-bold tabular-nums text-primary">
                    {totalCycle > 0 ? `${totalCycle.toFixed(1)}d` : "—"}
                  </span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Fila inferior v2.5: Top5 · Paises · Actividad reciente */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Top5HotLeadsCard leads={leads} stageNameById={stageNameById} />
        <LeadsByCountryCard leads={leads} />
        <RecentActivityCard />
      </div>
    </div>
  );
}
